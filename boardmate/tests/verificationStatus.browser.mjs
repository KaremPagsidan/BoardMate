import { localBrowserStyles } from './localBrowserStyles.mjs';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';

// Uses installed Chrome and Node's native CDP/WebSocket support; no test dependencies.
const browserPath = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const profile = await mkdtemp(join(tmpdir(), 'boardmate-responsive-'));
const server = await createServer({ plugins: [await localBrowserStyles()], cacheDir: join(profile, 'vite-cache'), server: { host: '127.0.0.1', port: 5179, strictPort: true } });
await server.listen();
const browser = spawn(browserPath, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let socket;
try {
  let targets;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { const debugPort = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0].trim(); targets = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json(); break; } catch { await pause(100); }
  }
  assert.ok(targets, 'Chrome debugging endpoint is available');
  socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
  await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
  let id = 0;
  const pending = new Map();
  const browserErrors = [];
  const loadingErrors = [];
  socket.addEventListener('message', event => {
    const result = JSON.parse(event.data);
    if (result.method === 'Network.loadingFailed') loadingErrors.push(result.params.errorText);
    if (result.method === 'Network.responseReceived' && result.params.response.status >= 400) loadingErrors.push(`${result.params.response.status}: ${result.params.response.url}`);
    if (result.method === 'Runtime.exceptionThrown') browserErrors.push(result.params.exceptionDetails.exception?.description || result.params.exceptionDetails.text);
    if (result.id) { pending.get(result.id)?.(result); pending.delete(result.id); }
  });
  const command = (method, params = {}) => new Promise((resolve, reject) => {
    const request = ++id;
    pending.set(request, result => result.error ? reject(new Error(JSON.stringify(result.error))) : resolve(result.result));
    socket.send(JSON.stringify({ id: request, method, params }));
  });
  const evaluate = async expression => {
    const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  await command('Runtime.enable');
  await command('Network.enable');
  async function openVerificationSettings() {
    await until(`Boolean(document.querySelector('[aria-label="Open menu"]'))`);
    await evaluate(`document.querySelector('[aria-label="Open menu"]').click()`);
    await until(`Boolean([...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Settings & Privacy'))`);
    await evaluate(`[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Settings & Privacy').click()`);
    await until(`Boolean(document.querySelector('#account-settings-verification'))`);
    await evaluate(`document.querySelector('#account-settings-verification').click()`);
    await until(`Boolean(document.querySelector('.verification-status-details,input[type="file"]'))`);
  }
  await command('Page.navigate',{url:'http://127.0.0.1:5179/tests/verificationStatus.html'});
  async function until(expression){for(let i=0;i<300;i++){if(await evaluate(expression))return;await pause(100);}throw new Error(`Timed out ${expression}; ${await evaluate('document.body.innerText.slice(0,500)')}; ${JSON.stringify(browserErrors)}`);}
  async function openStatus(){
    await openVerificationSettings();
    await until(`Boolean(document.querySelector('.verification-status-details')&&document.querySelector('.verification-status-details').textContent.includes('2026'))`);
  }
  await until(`Boolean(window.showVerificationFixture&&getComputedStyle(document.querySelector('.boardmate-app-shell')).overflow==='hidden')`);
  let checks=0;
  for(const width of [320,375,390,430,1280]){
    await command('Emulation.setDeviceMetricsOverride',{width,height:800,deviceScaleFactor:1,mobile:false});
    for(const role of ['RENTER','LANDLORD'])for(const status of ['pending','approved','rejected']){
      await evaluate(`window.showVerificationFixture(${JSON.stringify(role)},${JSON.stringify(status)})`);
      await until(`document.body.textContent.includes(${JSON.stringify(`Test ${role} ${status}`)})&&!document.querySelector('.verification-status-root')`);
      const original=await evaluate('window.verificationSnapshot()');
      await evaluate('window.verificationCalls=[]');
      await openStatus();
      assert.equal(await evaluate(`Boolean(document.querySelector('input[type="file"],form,video,canvas,[type="submit"]'))`),false,'No upload/camera/submit controls');
      const message=await evaluate(`document.querySelector('.verification-status-message').textContent`);
      assert.match(message,status==='pending'?/under administrator review. Please wait for approval/:status==='approved'?/successfully verified and approved/:/rejected/);
      if(status==='rejected')assert.match(await evaluate(`document.querySelector('dl').textContent`),/ID is unreadable/);
      const bounds=await evaluate(`(()=>{const f=document.querySelector('.boardmate-app-shell').getBoundingClientRect(),c=document.querySelector('.verification-status-card').getBoundingClientRect();return {fits:c.left>=f.left-1&&c.right<=f.right+1,noOverflow:document.documentElement.scrollWidth<=innerWidth&&document.querySelector('.verification-status-root').scrollWidth<=document.querySelector('.verification-status-root').clientWidth};})()`);
      assert.ok(bounds.fits&&bounds.noOverflow,JSON.stringify({width,role,status,bounds}));
      await evaluate(`[...document.querySelectorAll('button')].find(e=>e.textContent==='Refresh status').click()`);
      await until(`Boolean([...document.querySelectorAll('button')].find(e=>e.textContent==='Refresh status'&&!e.disabled))`);
      assert.ok((await evaluate('window.verificationCalls')).every(c=>(c.method==='select'||c.table==='get_boardmate_blocked_users'||c.table==='boardmate_account_preferences')),'Open and refresh perform SELECT only');
      assert.equal(await evaluate('window.verificationSnapshot()'),original,'Original documents and status unchanged');
      await evaluate(`document.querySelector('[aria-label="Back from Settings & Privacy"]').click()`);
      await until(`Boolean(!document.querySelector('.verification-status-root')&&document.querySelector('[aria-label="Open menu"]'))`);
      assert.ok(await evaluate(`document.body.textContent.includes(${JSON.stringify(role==='LANDLORD'?'Owner':'Renter')})`));
      checks++;
    }
  }
  // Legacy submitted statuses lacking paths/revisions must not expose uploads.
  for(const status of ['pending','approved','rejected']){
    await evaluate(`window.showVerificationFixture('RENTER',${JSON.stringify(status)},true)`);
    await openVerificationSettings();
    await until(`Boolean([...document.querySelectorAll('button')].find(e=>e.textContent==='Refresh status'&&!e.disabled))`);
    assert.equal(await evaluate(`Boolean(document.querySelector('input[type="file"],form,video'))`),false);
    assert.match(await evaluate(`document.querySelector('dl').textContent`),/Not recorded/);
  }
  for(const role of ['RENTER','LANDLORD']){
    await evaluate(`window.showVerificationFixture(${JSON.stringify(role)},'not_submitted')`);
    await openVerificationSettings();
    await until(`Boolean(document.querySelector('input[type="file"]'))`);
    assert.equal(await evaluate(`document.querySelectorAll('input[type="file"]').length`),2);
  }
  await command('Page.reload');
  await until(`Boolean(document.querySelector('[aria-label="Open menu"]'))`);
  await evaluate('window.verificationCalls=[]');await openStatus();
  assert.ok((await evaluate('window.verificationCalls')).every(c=>(c.method==='select'||c.table==='get_boardmate_blocked_users'||c.table==='boardmate_account_preferences')));
  assert.deepEqual(browserErrors,[]);
  console.log(`Passed ${checks} status/role/viewport cases, 3 legacy states, both first-time workflows, refresh/reload read-only checks and dashboard return navigation.`);
} finally {
  socket?.close();
  browser.kill();
  await server.close();
  await pause(500);
  await rm(profile, { recursive: true, force: true, maxRetries: 5 }).catch(() => {});
}
