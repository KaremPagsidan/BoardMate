import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = (await readFile(new URL('../src/lib/listingDetails.js', import.meta.url), 'utf8'))
  .replace("import { supabase } from '../supabaseClient';", 'const supabase = globalThis.detailTestClient;')
  .replace("import { fetchListingRatingSummary } from './listingRatings';", 'const fetchListingRatingSummary = globalThis.detailTestRatings;');
globalThis.detailTestClient = { from: () => ({ select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: globalThis.detailTestListing, error: null }; } }) };
globalThis.detailTestRatings = async () => { if (globalThis.detailRatingsUnavailable) throw new Error('Unavailable'); return { 1: { average: 4.5, count: 2 } }; };
const api = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
delete globalThis.detailTestClient;
delete globalThis.detailTestRatings;

test('detail links use the existing entry point and strip auth/search parameters', () => {
  const href = api.listingDetailsHref(12, 'https://example.com/boardmate/?code=private-code#old');
  assert.equal(href, 'https://example.com/boardmate/#listing/12');
  assert.deepEqual(api.readListingRoute(new URL(href).hash), { listingId: '12', handoff: null, account: null });
  assert.equal(api.readListingRoute('#listing/%ZZ'), null);
  assert.equal(api.readListingRoute('#listing/%2Foutside'), null);
  assert.equal(api.readListingRoute('#other-screen'), null);
});

test('gallery retains all additional photos, puts cover first and deduplicates it', () => {
  const cover = 'https://media.example/cover.jpg';
  const photos = Array.from({ length: 12 }, (_, index) => ({ url: `https://media.example/photo-${index}.png`, mimeType: 'image/png', name: `Photo ${index}` }));
  const media = api.listingMedia({ image_url: cover, photos: [...photos, { url: cover, mimeType: 'image/jpeg' }] });
  assert.equal(media.length, 13);
  assert.equal(media[0].url, cover);
  assert.equal(media[0].isCover, true);
  assert.deepEqual(media.slice(1).map(item => item.url), photos.map(item => item.url));
});

test('phone previews retain their viewport while ordinary detail links retain desktop presentation', () => {
  const href = api.listingPreviewHref(12, 'https://example.com/boardmate/?code=private#old');
  assert.equal(href, 'https://example.com/boardmate/#listing/12?viewport=phone');
  assert.deepEqual(api.readListingRoute(new URL(href).hash), { listingId: '12', handoff: null, account: null, viewport: 'phone' });
  assert.equal(api.readListingRoute('#listing/12?viewport=invalid').viewport, undefined);
});

test('gallery supports legacy strings, missing cover, video/audio and malformed entries safely', () => {
  const media = api.listingMedia({ photos: [null, {}, 'https://media.example/photo.png',
    { url: 'https://media.example/tour.mp4', name: 'Tour' }, { url: 'https://media.example/audio.m4a', mimeType: 'audio/mp4' },
    { url: 'javascript:alert(1)' }, { url: 'data:text/html,evil' }, { url: 'https://media.example/file.txt', mimeType: 'text/html' },
  ] });
  assert.equal(media.length, 3);
  assert.equal(media[0].mimeType, 'image/*');
  assert.equal(media[1].mimeType, 'video/*');
  assert.equal(media[2].mimeType, 'audio/mp4');
  assert.deepEqual(api.listingMedia({ image_url: null, photos: null }), []);
});

test('detail loading fetches saved listing galleries and real rating summaries', async () => {
  globalThis.detailTestListing = { id: 1, title: 'Owner listing', photos: [{ url: 'https://media.example/extra.jpg' }] };
  const details = await api.fetchListingDetails(1);
  assert.equal(details.media.length, 1);
  assert.equal(details.rating.average, 4.5);
  assert.equal(details.rating.count, 2);
});

test('rating failures do not hide photos/description; inaccessible listings disclose no data', async () => {
  globalThis.detailRatingsUnavailable = true;
  globalThis.detailTestListing = { id: 1, description: 'Still visible', photos: [{ url: 'https://media.example/extra.jpg' }] };
  const details = await api.fetchListingDetails(1);
  assert.equal(details.description, 'Still visible');
  assert.equal(details.media.length, 1);
  assert.ok(details.ratingError);
  globalThis.detailTestListing = null;
  await assert.rejects(api.fetchListingDetails(1), /unavailable or your account does not have access/);
  delete globalThis.detailRatingsUnavailable;
  delete globalThis.detailTestListing;
});
