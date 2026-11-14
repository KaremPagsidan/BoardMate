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
const server = await createServer({ plugins: [await localBrowserStyles()], cacheDir: join(profile, 'vite-cache'), server: { host: '127.0.0.1', port: 5181, strictPort: true } });
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
  await command('Page.navigate',{url:'http://127.0.0.1:5181/tests/verificationStatus.html'});
  async function until(expression){for(let i=0;i<300;i++){if(await evaluate(expression))return;await pause(100);}throw new Error(`Timed out ${expression}; ${await evaluate(`JSON.stringify({body:document.body.innerText.slice(-1600),invalid:[...document.querySelectorAll('input,select')].filter(e=>!e.validity.valid).map(e=>({name:e.name,value:e.value,message:e.validationMessage})),calls:window.verificationCalls})`)}; ${JSON.stringify(browserErrors)}`);}
  const click=async text=>{await evaluate(`[...document.querySelectorAll('button')].find(e=>e.textContent===${JSON.stringify(text)}).click()`);};
  await until(`Boolean(window.showVerificationFixture&&getComputedStyle(document.querySelector('.boardmate-app-shell')).overflow==='hidden')`);
  let cases=0;
  for(const width of [320,375,390,430,1280]){
   await command('Emulation.setDeviceMetricsOverride',{width,height:800,deviceScaleFactor:1,mobile:false});
   for(const role of ['RENTER','LANDLORD']){
    await evaluate(`window.showVerificationFixture(${JSON.stringify(role)},'rejected')`);
    await openVerificationSettings();
    await until(`Boolean([...document.querySelectorAll('button')].find(e=>e.textContent==='Edit and Resubmit Verification'&&!e.disabled))`);
    const oldHistory=await evaluate('window.historySnapshot()');
    await click('Edit and Resubmit Verification');
    await until(`Boolean(document.querySelector('input[name="full_name"]'))`);
    const bounds=await evaluate(`(()=>{const f=document.querySelector('.boardmate-app-shell').getBoundingClientRect(),c=document.querySelector('.verification-status-card').getBoundingClientRect();return {fits:c.left>=f.left-1&&c.right<=f.right+1,noOverflow:document.documentElement.scrollWidth<=innerWidth&&document.querySelector('.verification-status-root').scrollWidth<=document.querySelector('.verification-status-root').clientWidth};})()`);
    assert.ok(bounds.fits&&bounds.noOverflow,JSON.stringify({width,role,bounds}));
    await evaluate(`(()=>{const e=document.querySelector('[name="full_name"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'Corrected Applicant');e.dispatchEvent(new Event('input',{bubbles:true}));const canvas=document.createElement('canvas');canvas.width=10;canvas.height=10;window.testPngBytes=Uint8Array.from(atob(canvas.toDataURL('image/png').split(',')[1]),c=>c.charCodeAt(0));})()`);
    for(const index of [0,1]){
      await evaluate(`(()=>{const input=document.querySelectorAll('input[type="file"]')[${index}],dt=new DataTransfer();dt.items.add(new File([window.testPngBytes],${index}?'selfie.png':'id.png',{type:'image/png'}));input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
      await until(`Boolean([...document.querySelectorAll('button')].find(e=>e.textContent==='Keep original'))`);
      await click('Keep original');
      await until(`![...document.querySelectorAll('button')].some(e=>e.textContent==='Keep original')`);
    }
    assert.ok(await evaluate(`document.querySelector('.verification-status-root').scrollWidth<=document.querySelector('.verification-status-root').clientWidth`));
    await evaluate('window.verificationCalls=[]');
    await evaluate(`document.querySelector('form').requestSubmit()`);
    await until(`Boolean(document.querySelector('.verification-status-pending'))`);
    assert.equal(await evaluate(`Boolean(document.querySelector('form,input[type="file"]'))`),false);
    assert.equal(await evaluate(`Boolean([...document.querySelectorAll('button')].find(e=>e.textContent==='Edit and Resubmit Verification'))`),false);
    const calls=await evaluate('window.verificationCalls');
    assert.equal(calls.filter(c=>c.table==='resubmit_boardmate_verification').length,1);
    assert.equal(calls.filter(c=>c.method==='storage.upload').length,2);
    assert.ok(calls.filter(c=>c.method==='storage.upload').every(c=>c.options.upsert===false));
    assert.ok(!calls.some(c=>c.method==='storage.remove'));
    const newHistory=await evaluate('window.historySnapshot()');
    assert.deepEqual(JSON.parse(newHistory).slice(1),JSON.parse(oldHistory));
    assert.equal(JSON.parse(newHistory)[0].status,'pending');
    cases++;
   }
  }
  // Deployment mismatch fails closed before exposing upload controls or writing storage.
  await evaluate(`window.correctionsReady=false;window.showVerificationFixture('RENTER','rejected')`);
  await openVerificationSettings();
  await until(`Boolean([...document.querySelectorAll('button')].find(e=>e.textContent==='Edit and Resubmit Verification'&&!e.disabled))`);
  await evaluate('window.verificationCalls=[]');await click('Edit and Resubmit Verification');
  await until(`document.body.textContent.includes('corrections are not available yet')`);
  assert.equal(await evaluate(`Boolean(document.querySelector('input[type="file"]'))`),false);
  assert.ok(!(await evaluate('window.verificationCalls')).some(c=>c.method==='storage.upload'));
  assert.deepEqual(browserErrors,[]);
  console.log(`Passed ${cases} real App correction/resubmission role/viewport cases, unchanged old history, unique replacement paths, Pending transition, and fail-closed missing-migration checks.`);
} finally {
  socket?.close();
  browser.kill();
  await server.close();
  await pause(500);
  await rm(profile, { recursive: true, force: true, maxRetries: 5 }).catch(() => {});
}
