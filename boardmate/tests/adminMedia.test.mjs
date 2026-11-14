import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeAdminMedia } from '../src/lib/adminMedia.js';
const base = 'https://test.supabase.co';
const normalize = photos => normalizeAdminMedia(photos, 'listing-photos', base);
test('existing references normalize to authenticated Storage identifiers, without expired tokens', () => {
  const url = `${base}/storage/v1/object/sign/listing-photos/owner/a%20photo.jpg?token=expired`;
  assert.equal(normalize([url])[0].src, `${base}/storage/v1/object/authenticated/listing-photos/owner/a%20photo.jpg`);
  assert.deepEqual(normalize([{ path: 'owner/a photo.jpg' }]), normalize([url]));
  assert.equal(normalize(JSON.stringify([{ storage_path: 'owner/video.mp4' }]))[0].mimeType, 'video/mp4');
  assert.equal(normalize([{ src: `${base}/storage/v1/object/public/listing-photos/owner/clip.webm` }])[0].mimeType, 'video/webm');
  assert.equal(normalize(['owner/a.jpg', { path: 'owner/a.jpg' }]).length, 1);
});
test('reject unsafe and wrong-bucket references while retaining external images', () => {
  assert.equal(normalize(['javascript:alert(1)', '//evil.example/a', '../secret', null, { url: `${base}/storage/v1/object/public/roommate-post-photos/owner/a.jpg` }]).length, 0);
  assert.equal(normalize(['https://images.example/a.jpg'])[0].src, 'https://images.example/a.jpg');
  assert.equal(normalize([{ path: 'owner/new.mp4', url: 'https://expired.example/old.jpg' }])[0].mimeType, 'video/mp4');
});
