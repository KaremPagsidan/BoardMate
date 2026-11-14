import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { minimumPasswordLength, registrationPasswordError } from '../src/lib/registrationValidation.js';

let server;
let Preview;
let Camera;
before(async () => {
  server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), configFile: false, envDir: false,
    plugins: [react()], server: { middlewareMode: true }, appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] } });
  Preview = (await server.ssrLoadModule('/src/components/VerificationFilePreview.jsx')).default;
  Camera = (await server.ssrLoadModule('/src/components/SelfieCamera.jsx')).default;
});
after(async () => { await server?.close(); });

test('password validation rejects empty and short passwords and accepts the six-character boundary', () => {
  assert.equal(minimumPasswordLength, 6);
  for (const password of ['', 'a', '12345', '      ']) assert.ok(registrationPasswordError(password));
  assert.equal(registrationPasswordError('123456'), '');
  assert.equal(registrationPasswordError('longer password'), '');
  assert.match(registrationPasswordError('short'), /at least 6/);
});

test('selected identity images expose an image preview, zoom dialog and remove action', () => {
  const html = renderToStaticMarkup(createElement(Preview, {
    file: { name: 'id.jpg', type: 'image/jpeg' }, label: 'Government ID', onRemove() {},
  }));
  assert.match(html, /alt="Government ID preview"/);
  assert.match(html, /View \/ Zoom/);
  assert.match(html, /<dialog[^>]*aria-label="Government ID preview"/);
  assert.match(html, /type="range"[^>]*max="3"/);
  assert.match(html, /Remove/);
});

test('PDF documents expose a PDF viewer rather than a broken image thumbnail', () => {
  const html = renderToStaticMarkup(createElement(Preview, { file: { name: 'id.pdf', type: 'application/pdf' }, label: 'ID' }));
  assert.match(html, /View PDF/);
  assert.match(html, /<object[^>]*type="application\/pdf"/);
  assert.doesNotMatch(html, /<img/);
});

test('captured selfies offer preview, retake and remove controls', () => {
  const html = renderToStaticMarkup(createElement(Camera, { captured: { name: 'selfie.jpg', type: 'image/jpeg' }, onCapture() {} }));
  assert.match(html, /alt="Selfie preview"/);
  assert.match(html, /Retake selfie/);
  assert.match(html, /Remove/);
});

test('document mutation controls are disabled during submission', () => {
  const html = renderToStaticMarkup(createElement(Preview, { file: { name: 'selfie.jpg', type: 'image/jpeg' }, label: 'Selfie', disabled: true, onRemove() {}, onRetake() {} }));
  assert.match(html, /<button[^>]*disabled="">Retake selfie/);
  assert.match(html, /<button[^>]*disabled="">Remove/);
});

test('cleared files render no retained preview', () => {
  assert.equal(renderToStaticMarkup(createElement(Preview, { file: null, label: 'ID' })), '');
});
