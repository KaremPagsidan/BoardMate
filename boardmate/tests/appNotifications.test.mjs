import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { duplicateRegistrationMessage } from '../src/lib/registrationErrors.js';

let server;
let Dialog;
before(async () => {
  server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), configFile: false, envDir: false,
    plugins: [react()], server: { middlewareMode: true, hmr: false }, appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] } });
  Dialog = (await server.ssrLoadModule('/src/components/AppDialogProvider.jsx')).AppNoticeDialog;
});
after(async () => { await server?.close(); });

test('email duplicates request a different email address', () => {
  for (const error of [{ code: 'email_exists' }, { message: 'This email address is already registered.' }, { code: '23505', message: 'duplicate key violates unique constraint profiles_email_key' }]) {
    assert.equal(duplicateRegistrationMessage(error), 'This email address is already in use. Please use a different email address.');
  }
});
test('phone duplicates request a different phone number', () => {
  for (const error of [{ code: 'phone_exists' }, { code: '23505', message: 'duplicate key violates unique constraint profiles_phone_key' }]) {
    assert.equal(duplicateRegistrationMessage(error), 'This phone number is already in use. Please use a different phone number.');
  }
});
test('unqualified duplicate accounts get a clear combined contact message', () => {
  assert.match(duplicateRegistrationMessage({ message: 'User already registered' }), /different email address or phone number/);
  assert.match(duplicateRegistrationMessage({ code: 'user_already_exists' }), /already in use/);
});
test('network failures and unrelated uniqueness errors are not misreported as contact conflicts', () => {
  for (const error of [{ message: 'Failed to fetch' }, { code: '23505', message: 'duplicate key violates profiles_pkey' }, null]) assert.equal(duplicateRegistrationMessage(error), null);
});
test('notifications render as labelled in-app dialogs with an acknowledgement action', () => {
  const html = renderToStaticMarkup(createElement(Dialog, { item: { title: 'Account already exists', message: 'Please use a different email address.' }, onAnswer() {} }));
  assert.match(html, /<dialog[^>]*role="alertdialog"/);
  assert.match(html, /aria-labelledby="app-dialog-title"/);
  assert.match(html, /Please use a different email address/);
  assert.match(html, />OK<\/button>/);
  assert.doesNotMatch(html, />Cancel<\/button>/);
});
test('admin confirmations offer separate confirm and cancel actions', () => {
  const html = renderToStaticMarkup(createElement(Dialog, { item: { title: 'Confirm action', message: 'Suspend this account?', confirm: true }, onAnswer() {} }));
  assert.match(html, />Cancel<\/button>/);
  assert.match(html, />Confirm<\/button>/);
});
