import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { createClient } from '@supabase/supabase-js';

// Opt-in real multi-session/Storage API tests. Never reads the app's .env.
// Cloud hosts, HTTPS, redirects, and URLs containing credentials are refused.
const endpoint = process.env.BOARDMATE_TEST_SUPABASE_URL;
const anonymousKey = process.env.BOARDMATE_TEST_SUPABASE_ANON_KEY;
const serviceKey = process.env.BOARDMATE_TEST_SUPABASE_SERVICE_ROLE_KEY;
const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
function assertLocal(value) {
  const url = new URL(value);
  assert.ok(localHosts.has(url.hostname) && url.protocol === 'http:' && !url.username && !url.password,
    'Verification integration tests accept only a disposable loopback HTTP Supabase endpoint.');
}
if (endpoint) assertLocal(endpoint);
const enabled = Boolean(endpoint && anonymousKey && serviceKey);
const skip = enabled ? false : 'Requires explicit BOARDMATE_TEST_* credentials for disposable loopback Supabase; no production access.';
const accounts = [];
let service;
let firstAdmin;
let secondAdmin;
const bucket = 'verification-documents';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64');

function client(key) {
  return createClient(endpoint, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => {
      assertLocal(typeof input === 'string' || input instanceof URL ? String(input) : input.url);
      return fetch(input, { ...init, redirect: 'error' });
    } },
  });
}
function checked(result) {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}
function profile(result) {
  const value = checked(result);
  return Array.isArray(value) ? value[0] : value;
}
async function account(isAdmin = false) {
  const password = `Test-${randomUUID()}-Aa1!`;
  const email = `verification-${randomUUID()}@boardmate.test`;
  const user = checked(await service.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { role: 'RENTER', full_name: 'Local verification test' } })).user;
  accounts.push({ id: user.id, isAdmin });
  if (isAdmin) checked(await service.from('admin_memberships').insert({ user_id: user.id }));
  const session = client(anonymousKey);
  checked(await session.auth.signInWithPassword({ email, password }));
  return { id: user.id, client: session };
}
async function upload(owner, kind = 'government-id') {
  const path = `${owner.id}/${kind}-${randomUUID()}.png`;
  checked(await owner.client.storage.from(bucket).upload(path, png, { contentType: 'image/png', upsert: false }));
  return path;
}
async function submit(owner, idPath, selfiePath, revision = null) {
  return owner.client.rpc('submit_boardmate_verification', { p_id_path: idPath, p_selfie_path: selfiePath, p_expected_revision: revision });
}
async function review(admin, owner, revision, status = 'approved') {
  return admin.client.rpc('review_boardmate_verification', {
    p_user_id: owner.id, p_revision: revision, p_status: status, p_reason: status === 'rejected' ? 'Replace the ID' : null,
  });
}
async function submission() {
  const owner = await account();
  const idPath = await upload(owner);
  const selfiePath = await upload(owner, 'selfie');
  return { owner, idPath, selfiePath, profile: profile(await submit(owner, idPath, selfiePath)) };
}

before(async () => {
  if (!enabled) return;
  service = client(serviceKey);
  firstAdmin = await account(true);
  secondAdmin = await account(true);
});
after(async () => {
  if (!enabled || !service) return;
  // Ordinary test members first, reviewers last; all cleanup uses the local
  // trusted service client, the same exception as scheduled account purging.
  for (const user of [...accounts.filter(value => !value.isAdmin), ...accounts.filter(value => value.isAdmin)]) {
    const objects = checked(await service.storage.from(bucket).list(user.id, { limit: 1000 }));
    if (objects.length) checked(await service.storage.from(bucket).remove(objects.map(value => `${user.id}/${value.name}`)));
    checked(await service.auth.admin.deleteUser(user.id));
  }
});

test('local Supabase: concurrent admin review requests accept exactly one decision', { skip }, async () => {
  const state = await submission();
  const results = await Promise.all([
    review(firstAdmin, state.owner, state.profile.verification_revision),
    review(secondAdmin, state.owner, state.profile.verification_revision, 'rejected'),
  ]);
  assert.equal(results.filter(result => !result.error).length, 1);
  assert.equal(results.filter(result => result.error?.message.includes('Stale')).length, 1);
});

test('local Supabase: concurrent resubmission/review cannot approve an unreviewed replacement', { skip }, async () => {
  const state = await submission();
  const replacement = await upload(state.owner);
  const [saved, decision] = await Promise.all([
    submit(state.owner, replacement, state.selfiePath, state.profile.verification_revision),
    review(firstAdmin, state.owner, state.profile.verification_revision),
  ]);
  const next = profile(saved);
  assert.notEqual(next.verification_revision, state.profile.verification_revision);
  const current = checked(await state.owner.client.from('profiles').select('verification_revision,verification_status').eq('id', state.owner.id).single());
  assert.equal(current.verification_revision, next.verification_revision);
  assert.equal(current.verification_status, 'pending');
  if (decision.error) assert.match(decision.error.message, /Stale/);
});

test('local Supabase: concurrent submissions do not silently overwrite each other or duplicate notifications', { skip }, async () => {
  const owner = await account();
  const paths = [await upload(owner), await upload(owner, 'selfie'), await upload(owner), await upload(owner, 'selfie')];
  const results = await Promise.all([submit(owner, paths[0], paths[1]), submit(owner, paths[2], paths[3])]);
  assert.equal(results.filter(result => !result.error).length, 1);
  assert.equal(results.filter(result => result.error?.message.includes('Verification changed')).length, 1);
  const notices = checked(await firstAdmin.client.from('admin_review_notifications').select('id').eq('notification_key', `profiles:${owner.id}`));
  assert.equal(notices.length, 1);
});

test('local Supabase: Storage blocks overwrite/deletion and unrelated access while temporary cleanup works', { skip }, async () => {
  const state = await submission();
  const outsider = await account();
  const overwritten = await state.owner.client.storage.from(bucket).update(state.idPath, Buffer.from('not the original document'), { contentType: 'image/png' });
  assert.ok(overwritten.error);
  await state.owner.client.storage.from(bucket).remove([state.idPath]);
  const original = checked(await state.owner.client.storage.from(bucket).download(state.idPath));
  assert.deepEqual(Buffer.from(await original.arrayBuffer()), png);
  assert.ok((await outsider.client.storage.from(bucket).download(state.idPath)).error);
  assert.ok((await client(anonymousKey).storage.from(bucket).download(state.idPath)).error);
  checked(await firstAdmin.client.storage.from(bucket).download(state.idPath));
  const temporary = await upload(state.owner);
  checked(await state.owner.client.storage.from(bucket).remove([temporary]));
  assert.ok((await state.owner.client.storage.from(bucket).download(temporary)).error);
});
