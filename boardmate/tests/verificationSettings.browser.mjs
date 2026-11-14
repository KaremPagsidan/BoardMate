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
  async function until(expression){for(let i=0;i<300;i++){if(await evaluate(expression))return;await pause(100);}throw new Error(`Timed out ${expression}; ${await evaluate('document.body.innerText.slice(-1000)')}; ${JSON.stringify(browserErrors)}`);}
  async function clickText(text,scope='document'){
    await evaluate(`(()=>{const root=${scope};const e=[...root.querySelectorAll('button')].find(e=>(e.textContent.trim()===${JSON.stringify(text)}||[...e.querySelectorAll('span')].some(s=>s.textContent.trim()===${JSON.stringify(text)})));if(!e)throw new Error('Missing button '+${JSON.stringify(text)});e.click();})()`);await pause(50);
  }
  async function assertNoBanner(label){
    assert.equal(await evaluate(`Boolean(document.querySelector('.verification-status-root')||/View Verification Status|Account verification pending|Verification needs attention|Your account has been successfully verified and approved|Your account verification is under administrator review/.test(document.body.textContent))`),false,label);
  }
  async function openMenu(){await until(`Boolean(document.querySelector('[aria-label="Open menu"]'))`);await evaluate(`document.querySelector('[aria-label="Open menu"]').click()`);await until(`Boolean(document.querySelector('nav[aria-label="Account navigation"]'))`);}
  await until(`Boolean(window.showVerificationFixture&&getComputedStyle(document.querySelector('.boardmate-app-shell')).overflow==='hidden')`);
  let cases=0,pageChecks=0;
  for(const width of [320,375,390,430,1280]){
   await command('Emulation.setDeviceMetricsOverride',{width,height:800,deviceScaleFactor:1,mobile:false});
   for(const role of ['RENTER','LANDLORD'])for(const status of ['pending','approved','rejected']){
    await evaluate(`window.showVerificationFixture(${JSON.stringify(role)},${JSON.stringify(status)})`);
    await until(`Boolean(document.querySelector('[aria-label="Open menu"]'))&&document.body.textContent.includes(${JSON.stringify(`Test ${role} ${status}`)})`);
    const original=await evaluate('window.verificationSnapshot()');
    for(const tab of role==='RENTER'?['Home','Favourites','Messages','Profile']:['Home','Listings','Messages','Profile']){
      await clickText(tab,`document.querySelector('.boardmate-mobile-nav')`);await assertNoBanner(`${role} ${status} ${tab} ${width}`);pageChecks++;
    }
    assert.ok(await evaluate(`document.body.textContent.includes('09123456789')`),'Contact number preserved');
    await clickText('Edit details');await until(`Boolean(document.querySelector('input[type="tel"]'))`);
    assert.equal(await evaluate(`document.querySelector('input[type="tel"]').value`),'09123456789');await clickText('Cancel');
    await clickText('Home',`document.querySelector('.boardmate-mobile-nav')`);
    if(role==='RENTER')for(const page of ['Search Accommodations','Roommate Finder']){
      await clickText(page);await assertNoBanner(`${role} ${page}`);pageChecks++;await clickText('Home',`document.querySelector('.boardmate-mobile-nav')`);
    }
    if(status!=='approved'){
      await evaluate(`document.querySelector(${JSON.stringify('[aria-label="'+(role==='RENTER'?'Create roommate post':'Create accommodation listing')+'"]')}).click()`);
      await clickText('UPLOAD');await until(`Boolean(document.querySelector('[role="alertdialog"]'))`);
      assert.match(await evaluate(`document.querySelector('[role="alertdialog"]').textContent`),/Settings & Privacy/);
      assert.ok(!(await evaluate('window.verificationCalls')).some(c=>['resubmit_boardmate_verification','submit_boardmate_verification'].includes(c.table)||c.method==='storage.upload'));
      await clickText('OK');await clickText('Home',`document.querySelector('.boardmate-mobile-nav')`);
    }
    await openVerificationSettings();
    await until(`Boolean([...document.querySelectorAll('button')].find(e=>e.textContent==='Refresh status'&&!e.disabled))`);
    assert.equal(await evaluate(`document.querySelector('#account-settings-verification').getAttribute('aria-selected')`),'true');
    assert.equal(await evaluate(`Boolean(document.querySelector('#account-settings-phone'))||/Verify phone number|SMS verification code|Send verification code/.test(document.body.textContent)`),false);
    assert.equal(await evaluate(`Boolean(document.querySelector('#account-panel-verification input[type="file"]'))`),false);
    assert.equal(await evaluate(`Boolean([...document.querySelectorAll('button')].find(e=>e.textContent==='Edit and Resubmit Verification'))`),status==='rejected');
    const fit=await evaluate(`(()=>{const p=document.querySelector('.bm-portal-page-content'),f=document.querySelector('.boardmate-app-shell').getBoundingClientRect();return document.documentElement.scrollWidth<=innerWidth&&p.scrollWidth<=p.clientWidth+1&&[...document.querySelectorAll('.bm-account-settings-tabs button')].every(e=>{const r=e.getBoundingClientRect();return r.left>=f.left&&r.right<=f.right;});})()`);
    assert.ok(fit,`${role} ${status} settings fits ${width}`);
    await clickText('Refresh status');await until(`Boolean([...document.querySelectorAll('button')].find(e=>e.textContent==='Refresh status'&&!e.disabled))`);
    assert.equal(await evaluate('window.verificationSnapshot()'),original);
    await evaluate(`document.querySelector('[aria-label="Back from Settings & Privacy"]').click()`);await assertNoBanner('Dashboard after closing settings');
    await openMenu();await evaluate(`[...document.querySelectorAll('nav[aria-label="Account navigation"] button')].find(e=>e.textContent.includes('Notifications')).click()`);
    await until(`Boolean(document.querySelector('.bm-portal-page-header h1')?.textContent==='Notifications')`);
    await until(`Boolean([...document.querySelectorAll('button')].find(e=>e.textContent.includes('Open Settings & Privacy')))`);
    await evaluate(`[...document.querySelectorAll('button')].find(e=>e.textContent.includes('Open Settings & Privacy')).click()`);
    await until(`Boolean(document.querySelector('#account-settings-verification')?.getAttribute('aria-selected')==='true')`);
    assert.ok(await evaluate(`Boolean(document.querySelector('#account-panel-verification .verification-status-root'))`),'Notification deep link stays in settings');
    assert.equal(await evaluate('window.phoneAuthCalls'),0);cases++;
   }
  }
  assert.deepEqual(browserErrors,[]);
  console.log(`Passed ${cases} Settings/role/status/viewport cases and ${pageChecks} banner-free page checks, notification deep links, contextual restrictions, contact number editing, and removed phone OTP UI.`);
} finally {
  socket?.close();
  browser.kill();
  await server.close();
  await pause(500);
  await rm(profile, { recursive: true, force: true, maxRetries: 5 }).catch(() => {});
}
