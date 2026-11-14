import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registrationErrorMessage } from '../src/lib/registrationErrors.js';
import { registrationBirthDateError } from '../src/lib/registrationValidation.js';
test('registration explains database failures, duplicates and ambiguous network outcomes', () => {
  assert.match(registrationErrorMessage({ message: 'Database error saving new user' }), /administrator.*database/);
  assert.match(registrationErrorMessage({ code: 'email_exists' }), /email.*already in use/);
  assert.match(registrationErrorMessage({ code: 'phone_exists' }), /phone.*already registered/);
  assert.match(registrationErrorMessage({ message: 'Failed to fetch' }), /signing in before registering again/);
  assert.match(registrationErrorMessage({ code: 'signup_disabled' }), /temporarily unavailable/);
});
test('birth date validation rejects impossible and future dates', () => {
  assert.ok(registrationBirthDateError('2001-02-29'));
  assert.ok(registrationBirthDateError('2026-13-10'));
  assert.ok(registrationBirthDateError('2099-01-01', new Date('2026-11-11T12:00:00Z')));
  assert.equal(registrationBirthDateError('2000-02-29'), '');
});

