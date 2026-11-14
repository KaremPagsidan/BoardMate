import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';

// Uses installed Chrome and Node's native CDP/WebSocket support; no test dependencies.
const browserPath = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const profile = await mkdtemp(join(tmpdir(), 'boardmate-responsive-'));
const server = await createServer({ server: { host: '127.0.0.1', port: 5179 } });
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
  socket.addEventListener('message', event => {
    const result = JSON.parse(event.data);
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
  await command('Page.navigate', { url: 'http://127.0.0.1:5179/tests/responsive.html' });
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    ready = await evaluate(`Boolean(window.showFixture && getComputedStyle(document.querySelector('[role="dialog"]')).position === 'fixed')`);
    if (ready) break;
    await pause(250);
  }
  assert.ok(ready, `Fixture and production Tailwind styles loaded: ${JSON.stringify(browserErrors)}; ${await evaluate('document.body?.innerText.slice(0, 500)')}`);
  let checks = 0;
  for (const [width, height] of [[320, 640], [375, 812], [390, 844], [430, 932], [1440, 1000], [1440, 500]]) {
    await command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    for (const kind of ['search', 'results', 'media', 'video', 'audio', 'crop', 'file', 'notice']) {
      await evaluate(`window.showFixture(${JSON.stringify(kind)})`);
      await pause(100);
      if (kind === 'file') {
        await evaluate(`document.querySelector('.verification-file-actions button').click()`);
        await pause(50);
      }
      const bounds = await evaluate(`(() => {
        const frame = document.querySelector('.boardmate-app-shell').getBoundingClientRect();
        const dialog = document.querySelector('[role="dialog"], [role="alertdialog"], dialog[open]');
        const rect = dialog.getBoundingClientRect();
        return { inside: rect.left >= frame.left - 1 && rect.right <= frame.right + 1 && rect.top >= frame.top - 1 && rect.bottom <= frame.bottom + 1,
          noPageOverflow: document.documentElement.scrollWidth <= innerWidth,
          noDialogOverflow: dialog.scrollWidth <= dialog.clientWidth + 1,
          frame: frame.toJSON(), dialog: rect.toJSON() };
      })()`);
      assert.ok(bounds.inside, `${kind} fits frame at ${width}x${height}: ${JSON.stringify(bounds)}`);
      assert.ok(bounds.noPageOverflow && bounds.noDialogOverflow, `${kind} has no horizontal overflow at ${width}x${height}`);
      if (kind === 'video' || kind === 'audio') {
        assert.ok(await evaluate(`Boolean(document.querySelector('.bm-media-stage ${kind}')?.controls)`), `${kind} retains native playback controls`);
      }
      if (kind === 'file') {
        await evaluate(`(() => {
          const input = document.querySelector('.verification-file-zoom input');
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '3');
          input.dispatchEvent(new Event('input', { bubbles: true }));
        })()`);
        await pause(50);
        assert.ok(await evaluate(`(() => { const stage = document.querySelector('.verification-file-canvas'); return stage.scrollWidth > stage.clientWidth && stage.scrollHeight > stage.clientHeight; })()`), 'Native file zoom scrolls in both directions');
        await evaluate(`document.querySelector('.verification-file-dialog header button').click()`);
        assert.equal(await evaluate(`document.querySelector('.verification-file-dialog').open`), false, 'Native file preview closes');
      }
      if (kind === 'media') {
        const zoom = await evaluate(`(() => {
          const stage = document.querySelector('.bm-media-stage');
          const image = stage.querySelector('img');
          const fitted = image.clientWidth <= stage.clientWidth && image.clientHeight <= stage.clientHeight;
          const input = document.querySelector('[aria-label="Image zoom"]');
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '3');
          input.dispatchEvent(new Event('input', { bubbles: true }));
          return fitted;
        })()`);
        assert.ok(zoom, 'Image fits proportionally before zoom');
        await pause(50);
        assert.ok(await evaluate(`document.querySelector('.bm-media-stage').scrollWidth > document.querySelector('.bm-media-stage').clientWidth`), 'Zoomed image can scroll');
        await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
        assert.equal(await evaluate(`Boolean(document.querySelector('.bm-media-backdrop'))`), false, 'Escape closes preview');
      }
      checks++;
    }
    let referenceSearch;
    for (const kind of ['searchbars', 'chat', 'post', 'owner-listing', 'user-listing', 'actions']) {
      await evaluate(`window.showFixture(${JSON.stringify(kind)})`);
      await pause(100);
      assert.ok(await evaluate(`(() => {
        const frame = document.querySelector('.boardmate-app-shell');
        const content = frame.querySelector('.bm-portal-page, .boardmate-user-dashboard');
        return content.scrollWidth <= content.clientWidth + 1 && document.documentElement.scrollWidth <= innerWidth;
      })()`), `${kind} has no horizontal overflow at ${width}x${height}`);
      if (kind === 'searchbars') {
        const styles = await evaluate(`Array.from(document.querySelectorAll('.bm-search-bar'), element => {
          const css = getComputedStyle(element);
          return [element.getBoundingClientRect().height, css.fontSize, css.paddingTop, css.paddingBottom, css.paddingLeft, css.borderRadius];
        })`);
        referenceSearch = styles[0];
        assert.equal(styles.length, 6);
        styles.forEach(style => assert.deepEqual(style, referenceSearch, 'Search controls match the dashboard dimensions'));
      } else if (kind === 'chat') {
        assert.ok(await evaluate(`Array.from(document.querySelectorAll('.bm-uploaded-media, .bm-post-media-image')).every(media => {
          const bounds = media.getBoundingClientRect(), parent = media.parentElement.getBoundingClientRect();
          return bounds.width > 0 && bounds.left >= parent.left - 1 && bounds.right <= parent.right + 1;
        })`), 'Chat and post media stay inside their immediate parent');
        assert.ok(await evaluate(`Array.from(document.querySelectorAll('video')).every(video => video.getBoundingClientRect().height <= 240.5)`), 'Inline videos remain compact');
        assert.equal(await evaluate(`Array.from(document.querySelectorAll('audio')).every(audio => audio.controls && audio.getBoundingClientRect().height <= 44)`), true, 'Audio players keep compact native controls');
        await evaluate(`document.querySelector('video').play()`);
        assert.equal(await evaluate(`document.querySelector('video').paused`), false, 'Uploaded video playback works');
        await evaluate(`document.querySelector('video').pause(); document.querySelector('[aria-label="Open media preview"]').click()`);
        await pause(50);
        assert.ok(await evaluate(`Boolean(document.querySelector('.bm-media-stage video')?.controls)`), 'Chat opens the video preview');
        await evaluate(`document.querySelector('[aria-label="Close preview"]').click()`);
        // Download a real blob without writing outside the temporary test profile.
        await command('Browser.setDownloadBehavior', { behavior: 'deny' });
        await evaluate(`document.querySelector('.bm-post-media figure:last-child .bm-profile-link').click()`);
        await pause(50);
        await evaluate(`Array.from(document.querySelectorAll('.bm-media-dialog button')).find(button => button.textContent.includes('Save to device')).click()`);
        await pause(100);
        assert.equal(await evaluate(`Boolean(document.querySelector('[role="alertdialog"]'))`), false, 'File download completes without an error');
        await evaluate(`document.querySelector('[aria-label="Close preview"]').click()`);
      } else if (kind === 'actions') {
        assert.ok(await evaluate(`getComputedStyle(document.querySelector('.boardmate-renter-actions')).gridTemplateColumns.split(' ').length === 2`), 'Quick Actions have two mobile columns');
      } else {
        assert.equal(await evaluate(`Boolean(document.querySelector('[role="dialog"], [aria-modal="true"]'))`), false, 'Post details are pages with no modal semantics');
        assert.ok(await evaluate(`(() => {
          const content = document.querySelector('.bm-portal-page-content');
          content.scrollTop = 100;
          return content.scrollTop > 0 && Boolean(document.querySelector('.bm-portal-page-header h1'));
        })()`), 'Detail page has a scrollable body and persistent header');
        if (kind === 'post') {
          await evaluate(`document.querySelector('.bm-post-actions button').click()`);
          await pause(50);
          assert.equal(await evaluate(`document.querySelector('.bm-post-actions button').getAttribute('aria-pressed')`), 'true', 'Post like action works');
        } else {
          await evaluate(`document.querySelector('[aria-label="Show Video tour"]').click()`);
          await pause(50);
          assert.ok(await evaluate(`Boolean(document.querySelector('.accommodation-hero video')?.controls)`), 'Listing gallery switches to video');
          await evaluate(`document.querySelector('[aria-label="Show Cover photo"]').click(); document.querySelector('.accommodation-caption button').click()`);
          await pause(50);
          assert.ok(await evaluate(`(() => {
            const frame = document.querySelector('.boardmate-app-shell').getBoundingClientRect();
            const preview = document.querySelector('.bm-media-backdrop').getBoundingClientRect();
            return preview.left >= frame.left && preview.right <= frame.right && preview.top >= frame.top && preview.bottom <= frame.bottom;
          })()`), 'Listing media preview stays in-frame after scrolling');
          await evaluate(`document.querySelector('[aria-label="Close preview"]').click()`);
        }
        await evaluate(`document.querySelector('.bm-portal-page-header button').click()`);
        await pause(50);
        assert.ok(await evaluate(`Boolean(document.querySelector('[aria-labelledby="search-results-title"]'))`), 'Back returns to search');
        const searchStyle = await evaluate(`(() => {
          const element = document.querySelector('.bm-search-bar'), css = getComputedStyle(element);
          return [element.getBoundingClientRect().height, css.fontSize, css.paddingTop, css.paddingBottom, css.paddingLeft, css.borderRadius];
        })()`);
        assert.deepEqual(searchStyle, referenceSearch, 'Search BoardMate matches the dashboard search');
        await evaluate(`document.querySelector('main button').click()`);
        await pause(50);
        assert.ok(await evaluate(`Boolean(document.querySelector('.bm-portal-page'))`), 'Search result opens a dedicated detail page');
      }
      checks++;
    }
  }
  await command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await evaluate(`window.showFixture('desktop-listing')`);
  await pause(100);
  assert.ok(await evaluate(`getComputedStyle(document.querySelector('.listing-layout')).display === 'grid' && getComputedStyle(document.querySelector('.listing-sidebar')).position === 'sticky'`), 'Standalone desktop listing retains its two-column layout');
  await command('Page.navigate', { url: 'http://127.0.0.1:5179/#listing/test-listing?viewport=phone' });
  let routed = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    routed = await evaluate(`Boolean(document.querySelector('.boardmate-app-shell > .listing-detail-root'))`);
    if (routed) break;
    await pause(100);
  }
  assert.ok(routed, 'The actual phone preview route mounts inside the shared frame');
  console.log(`Passed ${checks} responsive cases at 320, 375, 390, 430 and desktop/short frame sizes, including zoom/scroll/Escape.`);
} finally {
  socket?.close();
  browser.kill();
  await server.close();
  await pause(500);
  await rm(profile, { recursive: true, force: true, maxRetries: 5 }).catch(() => {});
}
