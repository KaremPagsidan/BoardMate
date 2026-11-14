import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, test } from 'node:test';

const originalWindow = globalThis.window;
const originalChannel = globalThis.BroadcastChannel;
const channels = new Map();
class TestChannel {
  constructor(name) { this.name = name; this.closed = false; const group = channels.get(name) || new Set(); group.add(this); channels.set(name, group); }
  postMessage(data) {
    for (const target of channels.get(this.name) || []) {
      if (target !== this) queueMicrotask(() => { if (!target.closed) target.onmessage?.({ data }); });
    }
  }
  close() { this.closed = true; channels.get(this.name)?.delete(this); }
}
let reads = 0;
let sessionOwner = 'owner';
let restored = null;
let authListener = null;
const session = { user: { id: 'owner' }, access_token: 'test-access-token', refresh_token: 'test-refresh-token' };
globalThis.window = { location: { origin: 'https://boardmate.example', href: 'https://boardmate.example/' }, setTimeout, clearTimeout, setInterval, clearInterval };
globalThis.BroadcastChannel = TestChannel;
globalThis.listingWindowClient = { auth: {
  getSession: async () => ({ data: { session: ++reads === 1 ? null : { ...session, user: { id: sessionOwner } } }, error: null }),
  setSession: async tokens => { restored = tokens; return { data: { session }, error: null }; },
  onAuthStateChange: callback => {
    authListener = callback;
    return { data: { subscription: { unsubscribe: () => { if (authListener === callback) authListener = null; } } } };
  },
} };
const source = (await readFile(new URL('../src/lib/listingWindow.js', import.meta.url), 'utf8'))
  .replace("import { supabase } from '../supabaseClient';", 'const supabase = globalThis.listingWindowClient;');
const api = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
delete globalThis.listingWindowClient;
after(() => { globalThis.window = originalWindow; globalThis.BroadcastChannel = originalChannel; });

test('new-tab handoff uses an ephemeral channel and keeps credentials out of the URL', async () => {
  reads = 0; restored = null; sessionOwner = 'owner';
  const event = { currentTarget: { href: 'https://boardmate.example/#listing/12' } };
  api.prepareListingWindow(event, 'owner');
  assert.ok(!event.currentTarget.href.includes(session.access_token));
  assert.ok(!event.currentTarget.href.includes(session.refresh_token));
  const query = new URLSearchParams(new URL(event.currentTarget.href).hash.split('?')[1]);
  const result = await api.restoreListingSession({ listingId: '12', account: query.get('account'), handoff: query.get('handoff') }, 100);
  assert.equal(result.user.id, 'owner');
  assert.deepEqual(restored, { access_token: session.access_token, refresh_token: session.refresh_token });
  assert.ok([...channels.values()].every(group => group.size === 0));
});

test('another signed-in account is not handed over for the requested owner', async () => {
  reads = 0; restored = null; sessionOwner = 'different-account';
  const event = { currentTarget: { href: 'https://boardmate.example/#listing/12' } };
  api.prepareListingWindow(event, 'owner');
  const query = new URLSearchParams(new URL(event.currentTarget.href).hash.split('?')[1]);
  const result = await api.restoreListingSession({ account: query.get('account'), handoff: query.get('handoff') }, 30);
  assert.equal(result, null);
  assert.equal(restored, null);
});

test('external links never start a session handoff', () => {
  reads = 0;
  const event = { currentTarget: { href: 'https://outside.example/#listing/12' } };
  api.prepareListingWindow(event, 'owner');
  assert.equal(event.currentTarget.href, 'https://outside.example/#listing/12');
  assert.equal(reads, 0);
});

test('session handoff preserves the phone preview viewport', async () => {
  reads = 0; restored = null; sessionOwner = 'owner';
  const event = { currentTarget: { href: 'https://boardmate.example/#listing/12?viewport=phone' } };
  api.prepareListingWindow(event, 'owner');
  const query = new URLSearchParams(new URL(event.currentTarget.href).hash.split('?')[1]);
  assert.equal(query.get('viewport'), 'phone');
  await api.restoreListingSession({ account: query.get('account'), handoff: query.get('handoff') }, 30);
});

test('unsupported browsers fall back to detail-page sign-in without altering auth storage', async () => {
  reads = 0; restored = null;
  globalThis.BroadcastChannel = undefined;
  const result = await api.restoreListingSession({ account: 'owner', handoff: 'test' });
  assert.equal(result, null);
  assert.equal(restored, null);
  globalThis.BroadcastChannel = TestChannel;
});

test('matching-account refreshes synchronize while other accounts and signed-out tabs stay untouched', async () => {
  api.enableListingSessionSync('owner');
  restored = null;
  authListener('TOKEN_REFRESHED', { ...session, user: { id: 'different-account' }, expires_at: 100 });
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(restored, null);
  const refreshed = { ...session, access_token: 'renewed-access', refresh_token: 'renewed-refresh', expires_at: 200 };
  authListener('TOKEN_REFRESHED', refreshed);
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.deepEqual(restored, { access_token: 'renewed-access', refresh_token: 'renewed-refresh' });
  restored = null;
  authListener('TOKEN_REFRESHED', { ...refreshed, expires_at: 300 });
  authListener('SIGNED_OUT', null);
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(restored, null);
  assert.equal(authListener, null);
});
