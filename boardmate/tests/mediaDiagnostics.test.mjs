import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mediaFailureDetails, reportMediaFailure } from '../src/lib/mediaDiagnostics.js';
test('diagnostics retain request stage/status/code without logging URLs, paths, tokens or server messages', () => {
  const secret = 'PRIVATE_SIGNED_TOKEN';
  const raw = { code: 'PGRST202', status: 404, message: secret, details: secret, url: `https://secret.example?token=${secret}` };
  const location = { bucket: 'listing-photos', path: 'private-user/private-file.jpg' };
  assert.deepEqual(mediaFailureDetails('permission', location, raw), { stage: 'permission', bucket: 'listing-photos', code: 'PGRST202', httpStatus: 404 });
  assert.deepEqual(mediaFailureDetails('download', location, { code: 'AccessDenied', statusCode: '403' }), { stage: 'download', bucket: 'listing-photos', code: 'AccessDenied', httpStatus: 403 });
  const logs = [], warn = console.warn;
  console.warn = (...args) => logs.push(args);
  try {
    reportMediaFailure(raw.url, 'permission', location, raw);
    reportMediaFailure(raw.url, 'permission', location, raw);
    assert.equal(logs.length, 1);
    assert.doesNotMatch(JSON.stringify(logs), /PRIVATE_SIGNED_TOKEN|private-user|private-file|secret.example/);
  } finally { console.warn = warn; }
});
