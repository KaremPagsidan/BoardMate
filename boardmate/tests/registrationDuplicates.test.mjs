import assert from 'node:assert/strict';
import { test } from 'node:test';
import { signUpWithDuplicateValidation } from '../src/lib/registration.js';
const credentials = { email: ' NEW@Example.com ', password: 'secret', options: { data: { role: 'RENTER', phone: '09123456789' } } };
for (const role of ['RENTER', 'LANDLORD']) {
  for (const field of ['email', 'phone']) test(`${role} registration stops before Auth when ${field} exists`, async () => {
    let signups = 0;
    const client = { rpc: async () => ({ data: { email_exists: field === 'email', phone_exists: field === 'phone' }, error: null }), auth: { signUp: async () => { signups++; } } };
    await assert.rejects(signUpWithDuplicateValidation(client, { ...credentials, options: { data: { ...credentials.options.data, role } } }), error => error.code === `${field}_exists`);
    assert.equal(signups, 0);
  });
}
test('successful availability check preserves metadata and normalizes email', async () => {
  const client = { rpc: async (name, args) => { assert.equal(name, 'check_boardmate_registration_duplicates'); assert.equal(args.p_email, 'new@example.com'); return { data: { email_exists: false, phone_exists: false } }; }, auth: { signUp: async args => { assert.equal(args.email, 'new@example.com'); assert.deepEqual(args.options, credentials.options); return { data: { user: { id: 'new' }, session: { access_token: 'signup-session' } }, error: null }; } } };
  assert.equal((await signUpWithDuplicateValidation(client, credentials)).data.user.id, 'new');
});
test('generic Auth failure caused by competing phone signup becomes a specific duplicate error', async () => {
  let checks = 0;
  const client = { rpc: async () => ({ data: { email_exists: false, phone_exists: ++checks > 1 } }), auth: { signUp: async () => ({ error: { message: 'Database error saving new user' } }) } };
  await assert.rejects(signUpWithDuplicateValidation(client, credentials), error => error.code === 'phone_exists');
});
test('failed or malformed availability responses prevent account creation', async () => {
  for (const response of [{ error: { code: 'PGRST202' } }, { data: null }, { data: {} }]) {
    const client = { rpc: async () => response, auth: { signUp: async () => assert.fail('Auth must not run') } };
    await assert.rejects(signUpWithDuplicateValidation(client, credentials), /availability/);
  }
});

test('signup accepts immediate password session and refuses a confirmation-required configuration', async () => {
 const client={rpc:async()=>({data:{email_exists:false,phone_exists:false}}),auth:{signUp:async()=>({data:{user:{id:'new'},session:null}})}};
 await assert.rejects(signUpWithDuplicateValidation(client,credentials),/check signup configuration/);
});
