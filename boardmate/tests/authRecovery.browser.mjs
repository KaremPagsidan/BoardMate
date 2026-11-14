import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';

// Uses installed Chrome and Node's native CDP/WebSocket support; no test dependencies.
const browserPath = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const profile = await mkdtemp(join(tmpdir(), 'boardmate-responsive-'));
const server = await createServer({ cacheDir: join(profile, 'vite-cache'), server: { host: '127.0.0.1', port: 5179, strictPort: true } });
await server.listen();
const browser = spawn(browserPath, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=9237', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let socket;
try {
  let targets;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { targets = await (await fetch('http://127.0.0.1:9237/json')).json(); break; } catch { await pause(100); }
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
  await command('Page.navigate', { url: 'http://127.0.0.1:5179/tests/authRecovery.html' });
  async function until(expression) {
    for(let i=0;i<300;i++){if(await evaluate(expression))return;await pause(100);}
    throw new Error(`Timed out: ${expression}; ${await evaluate('document.body.innerText.slice(0,400)')}; ${JSON.stringify(browserErrors)}; ${JSON.stringify(loadingErrors)}`);
  }
  const fill=async (selector,value)=>{
    await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(e.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`);
  };
  const clickText=async text=>{
    await evaluate(`(()=>{const e=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)});if(!e)throw new Error('Button missing: '+${JSON.stringify(text)});e.click();})()`);await pause(100);
  };
  const fits=async label=>{
    const result=await evaluate(`(()=>{const frame=document.querySelector('.boardmate-app-shell').getBoundingClientRect();return {page:document.documentElement.scrollWidth<=innerWidth,inputs:[...document.querySelectorAll('input,select,form button')].filter(e=>e.getBoundingClientRect().width).every(e=>{const r=e.getBoundingClientRect();return r.left>=frame.left-1&&r.right<=frame.right+1;})};})()`);
    assert.ok(result.page&&result.inputs,`${label}: ${JSON.stringify(result)}`);
  };
  await until(`Boolean(window.showAuthFixture && document.querySelector('#recovery-email') && getComputedStyle(document.querySelector('.boardmate-app-shell')).overflow==='hidden')`);
  let checks=0;
  for(const width of [320,375,390,430]){
    await command('Emulation.setDeviceMetricsOverride',{width,height:720,deviceScaleFactor:1,mobile:false});
    await evaluate(`window.showAuthFixture('recovery')`);await until(`Boolean(document.querySelector('#recovery-email'))`);
    await fits(`Forgot Password ${width}`);checks++;
    await evaluate(`document.querySelector('form').requestSubmit()`);
    await until(`Boolean(document.querySelector('#recovery-code'))`);
    await fits(`OTP ${width}`);checks++;
    assert.ok(await evaluate(`[...document.querySelectorAll('button')].some(e=>e.disabled&&e.textContent.includes('Resend code in'))`));
    await evaluate(`window.clockOffset+=61000`);
    await until(`Boolean([...document.querySelectorAll('button')].find(e=>!e.disabled&&e.textContent==='Resend code'))`);
    await clickText('Resend code');
    await until(`Boolean([...document.querySelectorAll('button')].find(e=>e.disabled&&e.textContent.includes('Resend code in')))`);
    await fill('#recovery-code','999999');await evaluate(`document.querySelector('form').requestSubmit()`);
    await until(`Boolean(document.querySelector('[role="alert"]'))`);
    assert.match(await evaluate(`document.querySelector('[role="alert"]').textContent`),/incorrect or expired/);
    await fill('#recovery-code','012345');await evaluate(`document.querySelector('form').requestSubmit()`);
    await until(`Boolean(document.querySelector('#recovery-password'))`);
    await fits(`Reset ${width}`);checks++;
    assert.equal(await evaluate('window.mainAuthSession()'),null);
    assert.equal(await evaluate(`Object.values(sessionStorage).some(v=>v.includes('mock-recovery-token'))`),false);
    await fill('#recovery-password','new-password');await fill('#recovery-confirm','different-password');
    await evaluate(`document.querySelector('form').requestSubmit()`);
    await until(`Boolean(document.querySelector('[role="alert"]'))`);
    assert.match(await evaluate(`document.querySelector('[role="alert"]').textContent`),/Passwords do not match/);
    await fill('#recovery-confirm','new-password');
    await evaluate(`window.recoveryCompleted='';document.querySelector('form').requestSubmit()`);
    await until(`Boolean(window.recoveryCompleted)`);
    assert.match(await evaluate('window.recoveryCompleted'),/Password updated/);
    for(const mode of ['SIGN UP','LOG IN'])for(const role of ['User / Renter','Owner / Landlord']){
      await evaluate(`window.showAuthFixture('app')`);
      await until(`Boolean(document.querySelector('[aria-label="Tap anywhere to get started"]'))`);
      await evaluate(`document.querySelector('[aria-label="Tap anywhere to get started"]').click()`);
      await until(`Boolean([...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='SIGN UP'))`);
      await clickText(mode);await clickText(role);
      await until(`Boolean(document.querySelector(${JSON.stringify(mode==='SIGN UP'?'input[name="email"]':'input[type="email"]')}))`);
      await fits(`${mode} ${role} ${width}`);checks++;
      assert.equal(await evaluate(`Boolean(document.querySelector('#registration-otp'))`),false);
    }
  }
  await evaluate(`window.recoveryRateLimit=true;window.showAuthFixture('recovery')`);
  await until(`Boolean(document.querySelector('#recovery-email'))`);
  await evaluate(`document.querySelector('form').requestSubmit()`);
  await until(`Boolean(document.querySelector('[role="alert"]'))`);
  assert.match(await evaluate(`document.querySelector('[role="alert"]').textContent`),/Too many requests/);
  assert.ok(await evaluate(`window.authCalls.filter(c=>c.url.includes('/verify')).every(c=>c.body.type==='recovery'&&c.body.email==='member@gmail.com')`));
  assert.ok(await evaluate(`window.authCalls.some(c=>c.method==='PUT'&&c.url.includes('/user')&&c.body.password==='new-password')`));
  assert.deepEqual(browserErrors,[]);
  console.log(`Passed ${checks} auth screen/frame checks at 320/375/390/430px, mocked SDK wrong-code verification, password reset and signout.`);
} finally {
  socket?.close();
  browser.kill();
  await server.close();
  await pause(500);
  await rm(profile, { recursive: true, force: true, maxRetries: 5 }).catch(() => {});
}
