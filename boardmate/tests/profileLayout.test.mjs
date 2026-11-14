import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { collectProfileMedia, profilePostStatus } from '../src/lib/profilePresentation.js';

let server;
let components;
let ConversationMediaPlayer, PortalPage;
before(async () => {
  // Compile/render the actual shared JSX without a browser, application env,
  // authenticated accounts, or any Supabase connection.
  server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), configFile: false, envDir: false, cacheDir: 'node_modules/.vite-profile-tests',
    plugins: [react()], server: { middlewareMode: true }, appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] } });
  components = await server.ssrLoadModule('/src/components/ProfileLayout.jsx');
  ConversationMediaPlayer = (await server.ssrLoadModule('/src/components/ConversationMediaPlayer.jsx')).default;
  PortalPage = (await server.ssrLoadModule('/src/components/PortalPage.jsx')).default;
});
after(async () => { await server?.close(); });

test('message players stay paused and keep native controls separate from preview clicks', () => {
  for (const mimeType of ['video/mp4', 'audio/mpeg']) {
    let previews = 0, stopped = 0;
    const container = ConversationMediaPlayer({ src: 'https://example.com/media', mimeType, onPreview: () => { previews += 1; } });
    const player = container.props.children[0];
    assert.equal(player.props.controls, true); assert.equal(player.props.autoPlay, false); assert.equal(player.props.preload, 'none');
    player.props.onClick({ stopPropagation() { stopped += 1; } });
    assert.equal(stopped, 1); assert.equal(previews, 0);
    container.props.onClick(); assert.equal(previews, 1);
    let paused = 0;
    const other = { pause() { paused += 1; } };
    const active = { closest: () => ({ querySelectorAll: () => [active, other] }) };
    player.props.onPlay({ currentTarget: active }); assert.equal(paused, 1);
    assert.doesNotMatch(renderToStaticMarkup(container), /Preview and save|autoplay/i);
  }
});

test('portal pages render as full page content with back navigation instead of modal semantics', () => {
  const html = renderToStaticMarkup(createElement(PortalPage, { title: 'Settings & Privacy', onBack() {} }, 'Existing settings'));
  assert.match(html, /<main/); assert.match(html, /Back from Settings/); assert.match(html, /Existing settings/);
  assert.doesNotMatch(html, /role="dialog"|aria-modal|backdrop/);
});

test('profile galleries combine saved photos and every uploaded post asset without duplicates', () => {
  const cover = 'https://media.example/cover.jpg';
  const photos = [{ photo_url: 'https://media.example/avatar.jpg', created_at: '2026-11-11T00:00:00Z' }];
  const posts = [{ title: 'Listing', image: cover, photos: [
    { url: cover, mimeType: 'image/jpeg' }, { url: 'https://media.example/extra.png' },
    { url: 'https://media.example/tour.mp4', mimeType: 'video/mp4' }, { url: 'https://media.example/tour.mp3', mimeType: 'audio/mpeg' },
  ] }];
  const result = collectProfileMedia(photos, posts);
  assert.equal(result.length, 5);
  assert.equal(result[0].createdAt, '2026-11-11T00:00:00Z');
  assert.equal(result.filter(item => item.url === cover).length, 1);
  assert.equal(result.filter(item => item.mimeType.startsWith('video/')).length, 1);
  assert.equal(result.filter(item => item.mimeType.startsWith('audio/')).length, 1);
});

test('public-profile media formats and malformed legacy rows normalize safely', () => {
  const result = collectProfileMedia([{ url: 'https://media.example/photo.jpg' }, null, {}], [
    { title: 'Public listing', imageUrl: 'https://media.example/cover.jpg', photos: ['https://media.example/extra.png'] },
    { title: 'Bad data', photos: [{ url: 'javascript:alert(1)' }, { url: 'data:text/html,unsafe' }, { url: 'https://media.example/file', mimeType: 'application/pdf' }] },
  ]);
  assert.equal(result.length, 3);
  assert.deepEqual(collectProfileMedia(null, null), []);
});

test('private verification document paths are never collected into a media gallery', () => {
  const result = collectProfileMedia([], [{ title: 'Profile', id_document_path: 'private/id.pdf', selfie_document_path: 'private/selfie.jpg' }]);
  assert.deepEqual(result, []);
});

test('own-profile header includes a photo-edit action and the existing verification badge', () => {
  const html = renderToStaticMarkup(createElement(components.ProfileHero, {
    name: 'Owner Name', avatar: 'https://media.example/avatar.jpg', role: 'Owner / Landlord', verified: true,
    onPreview() {}, onPhotoChange() {},
  }));
  assert.match(html, /aria-label="Update profile photo"/);
  assert.match(html, /type="file"/);
  assert.match(html, /aria-label="Verified account"/);
  assert.match(html, /aria-label="View profile photo"/);
});

test('public-profile header exposes no photo-edit input', () => {
  const html = renderToStaticMarkup(createElement(components.ProfileHero, { name: 'Member', role: 'Public profile', headingAs: 'h3' }));
  assert.doesNotMatch(html, /type="file"|Update profile photo/);
  assert.match(html, /No profile photo/);
});

test('account details retain long values, semantic labels and missing-value fallbacks', () => {
  const email = `${'long-address-'.repeat(10)}@example.com`;
  const html = renderToStaticMarkup(createElement(components.ProfileDetails, {
    fields: [{ label: 'Email address', value: email }, { label: 'Phone number', value: '' }], onEdit() {},
  }));
  assert.match(html, /<dl/);
  assert.ok(html.includes(email));
  assert.match(html, /<dt>Phone number<\/dt><dd>Not provided<\/dd>/);
  assert.match(html, /Edit details/);
});

test('all media tiles remain present in the gallery with real preview buttons', () => {
  const media = Array.from({ length: 9 }, (_, index) => ({ url: `https://media.example/${index}.jpg`, name: `Photo ${index}`, mimeType: 'image/jpeg' }));
  const html = renderToStaticMarkup(createElement(components.ProfileMediaGallery, { media, onPreview() {} }));
  assert.equal((html.match(/<figure/g) || []).length, 9);
  assert.equal((html.match(/aria-label="Preview Photo/g) || []).length, 9);
});

test('post cards retain complete descriptions/locations and render native video/audio controls', () => {
  const description = `First paragraph\n${'Full description. '.repeat(100)}LAST PARAGRAPH`;
  const location = `Long address ${'Street, District, '.repeat(20)}END OF ADDRESS`;
  const html = renderToStaticMarkup(createElement(components.ProfilePostCard, {
    title: 'My post', description, location, status: 'rejected', reason: 'Update the photos', onPreview() {},
    media: [{ url: 'https://media.example/video.mp4', mimeType: 'video/mp4', name: 'Tour' }, { url: 'https://media.example/audio.mp3', mimeType: 'audio/mpeg', name: 'Audio tour' }],
  }));
  assert.ok(html.includes(description));
  assert.ok(html.includes(location));
  assert.match(html, /<video[^>]*controls/);
  assert.match(html, /<audio[^>]*controls/);
  assert.match(html, /Needs changes/);
  assert.match(html, /Update the photos/);
});

test('post text is escaped rather than interpreted as markup', () => {
  const html = renderToStaticMarkup(createElement(components.ProfilePostCard, { title: '<script>test</script>', description: '<img onerror="bad">' }));
  assert.doesNotMatch(html, /<script>|<img onerror/);
  assert.match(html, /&lt;script&gt;/);
});

test('profile previews have a separate dialog body and accessible close action', () => {
  const html = renderToStaticMarkup(createElement(components.ProfilePreviewDialog, { title: 'Post details', onClose() {}, children: createElement('p', null, 'Full post') }));
  assert.match(html, /role="dialog"/);
  assert.match(html, /aria-label="Close profile preview"/);
  assert.match(html, /class="bm-profile-modal-content"/);
  assert.match(html, /Full post/);
  assert.equal(profilePostStatus('approved'), 'Published');
  assert.equal(profilePostStatus('pending'), 'Pending review');
});
