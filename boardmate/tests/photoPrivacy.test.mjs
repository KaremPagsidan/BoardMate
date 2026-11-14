import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createCroppedImage, fullCrop, moveCrop } from '../src/lib/imageCrop.js';

test('crop export uses the selected original-image coordinates and preserves its aspect ratio', async () => {
  const originalImage = globalThis.Image, originalDocument = globalThis.document;
  let drawn;
  const canvas = { width: 0, height: 0, getContext: () => ({ drawImage: (...args) => { drawn = args; } }), toBlob: callback => callback(new Blob(['pixels'], { type: 'image/png' })) };
  globalThis.Image = class { naturalWidth = 4000; naturalHeight = 3000; async decode() {} };
  globalThis.document = { createElement: () => canvas };
  try {
    const result = await createCroppedImage(new File(['original'], 'photo.jpg'), 'blob:local', { x: .2, y: .1, width: .5, height: .5 });
    assert.deepEqual(drawn.slice(1), [800, 300, 2000, 1500, 0, 0, 2000, 1500]);
    assert.equal(result.type, 'image/png'); assert.equal(result.name, 'photo.png');
  } finally { globalThis.Image = originalImage; globalThis.document = originalDocument; }
});

test('manual crop movement and all eight handles stay within the original image', () => {
  const crop = { x: .2, y: .2, width: .6, height: .6 };
  assert.deepEqual(moveCrop(crop, 'move', 1, -1), { ...crop, x: .4, y: 0 });
  for (const handle of ['nw','n','ne','e','se','s','sw','w']) {
    for (const delta of [-2, -.1, .1, 2]) {
      const next = moveCrop(crop, handle, delta, delta);
      assert.ok(next.x >= 0 && next.y >= 0 && next.width >= .039 && next.height >= .039);
      assert.ok(next.x + next.width <= 1.00001 && next.y + next.height <= 1.00001);
    }
  }
  assert.deepEqual(moveCrop(fullCrop, 'move', 1, 1), fullCrop);
});

test('profile privacy restricts database and Storage access, owner-only changes and deletion', async () => {
  const db = new PGlite();
  const owner = '11111111-1111-4111-8111-111111111111';
  const viewer = '22222222-2222-4222-8222-222222222222';
  const path = `${owner}/photo.jpg`;
  const url = `https://example.supabase.co/storage/v1/object/public/profile-photos/${path}`;
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth; create schema storage;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.sub', true), '')::uuid $$;
      grant usage on schema auth, storage to anon, authenticated;
      create table public.profiles(id uuid primary key, avatar_url text);
      insert into public.profiles values ('${owner}', '${url}'), ('${viewer}', null);
      create table public.profile_photo_gallery(id bigint primary key, user_id uuid, photo_url text, created_at timestamptz default now());
      insert into public.profile_photo_gallery values (1, '${owner}', '${url}');
      alter table public.profile_photo_gallery enable row level security;
      grant select, insert on public.profile_photo_gallery to authenticated;
      create policy own_gallery on public.profile_photo_gallery for select to authenticated using (user_id = auth.uid());
      create policy own_upload on public.profile_photo_gallery for insert to authenticated with check (user_id = auth.uid());
      create table storage.buckets(id text primary key, public boolean);
      insert into storage.buckets values ('profile-photos', true), ('listing-photos', true);
      create table storage.objects(bucket_id text, name text);
      insert into storage.objects values ('profile-photos', '${path}'), ('listing-photos', 'listing.jpg');
      alter table storage.objects enable row level security;
      grant select, delete on storage.objects to authenticated;
      grant select on storage.objects to anon;
      create policy broad_legacy_read on storage.objects for select using (true);
      create policy unrelated_listing_delete on storage.objects for delete using (bucket_id = 'listing-photos');
      create function public.is_boardmate_profile_visible(uuid) returns boolean language sql as $$ select true $$;
      create function public.is_boardmate_account_approved(uuid) returns boolean language sql as $$ select true $$;
      create function public.is_boardmate_blocked_with(uuid) returns boolean language sql as $$ select false $$;
      create function public.get_boardmate_public_profile(p_user_id uuid) returns jsonb
      language sql security definer set search_path = '' as $$
        select jsonb_build_object('photos', (select jsonb_agg(gallery.photo_url)
        from public.profile_photo_gallery gallery where gallery.user_id = profile.id))
        from public.profiles profile where id = p_user_id;
      $$;
    `);
    await db.exec(await readFile(new URL('../supabase/migrations/20261111000004_profile_photo_privacy.sql', import.meta.url), 'utf8'));
    assert.equal((await db.query("select public from storage.buckets where id = 'profile-photos'")).rows[0].public, false);
    const actor = async (id, role = 'authenticated') => { await db.exec('reset role'); await db.query("select set_config('request.sub', $1, false)", [id || '']); await db.exec(`set role ${role}`); };
    const photoVisible = async () => (await db.query("select * from storage.objects where bucket_id = 'profile-photos'")).rows.length;
    await actor(viewer);
    assert.equal(await photoVisible(), 1);
    await assert.rejects(db.query('select public.set_boardmate_photo_visibility(1, false)'), /owner/);
    await assert.rejects(db.query('select public.delete_boardmate_profile_photo(1)'), /owner/);
    assert.equal((await db.query("delete from storage.objects where bucket_id = 'profile-photos' returning name")).rows.length, 0);
    await actor(owner);
    await db.query('select public.set_boardmate_photo_visibility(1, false)');
    assert.equal(await photoVisible(), 1);
    assert.equal((await db.query('select is_public from public.profile_photo_gallery')).rows[0].is_public, false);
    await assert.rejects(db.query('select public.delete_boardmate_profile_photo(1)'), /Remove the stored file/);
    await actor(viewer);
    assert.equal(await photoVisible(), 0);
    const hidden = (await db.query('select public.get_boardmate_public_profile($1) as profile', [owner])).rows[0].profile;
    assert.equal(hidden.photos, null);
    await actor(null, 'anon'); assert.equal(await photoVisible(), 0);
    await actor(owner);
    await db.query('select public.set_boardmate_photo_visibility(1, true)');
    await actor(viewer); assert.equal(await photoVisible(), 1);
    // Broad future gallery policy still cannot disclose a hidden row.
    await actor(owner); await db.query('select public.set_boardmate_photo_visibility(1, false)');
    await db.exec('reset role'); await db.exec('create policy accidental_read on public.profile_photo_gallery for select using (true)');
    await actor(viewer); assert.equal((await db.query('select * from public.profile_photo_gallery')).rows.length, 0);
    await actor(owner);
    await assert.rejects(db.query('insert into public.profile_photo_gallery(id,user_id,photo_url) values (2,$1,$2)', [owner, url.replace(owner, viewer)]), /gallery_owned_path/);
    await db.query("delete from storage.objects where bucket_id = 'profile-photos'");
    await db.query('select public.delete_boardmate_profile_photo(1)');
    assert.equal((await db.query('select * from public.profile_photo_gallery')).rows.length, 0);
    await db.exec('reset role');
    assert.equal((await db.query('select avatar_url from public.profiles where id = $1', [owner])).rows[0].avatar_url, null);
    assert.equal((await db.query('select revision from public.boardmate_visibility_revision')).rows[0].revision, 4);
    assert.equal((await db.query("select * from storage.objects where bucket_id = 'listing-photos'")).rows.length, 1);
    // Listing/post photo controls retain parent rows and unrelated media.
    await db.exec(`
      -- Simulate a database missing the shared helper when migration 00005 runs.
      drop function public.publish_boardmate_visibility_revision() cascade;
      create table public.listings(id bigint primary key, owner_id uuid, title text, image_url text, photos jsonb, is_available boolean, moderation_status text);
      create table public.roommate_posts(id bigint primary key, user_id uuid, heading text, photos jsonb, deleted_at timestamptz, moderation_status text);
      insert into storage.buckets values ('roommate-post-photos', true);
    `);
    const listingPath = `${owner}/listing.jpg`, postPath = `${owner}/roommate.jpg`;
    const listingUrl = url.replace(`profile-photos/${path}`, `listing-photos/${listingPath}`);
    const postUrl = url.replace(`profile-photos/${path}`, `roommate-post-photos/${postPath}`);
    await db.query('insert into storage.objects values ($1,$2),($3,$4)', ['listing-photos', listingPath, 'roommate-post-photos', postPath]);
    await db.query("insert into public.listings values(1,$1,'Keep listing',$2,$3,true,'approved')", [owner, listingUrl, JSON.stringify([{ url: listingUrl, mimeType: 'image/jpeg' }, { url: 'https://external.example/keep.jpg' }])]);
    await db.query("insert into public.roommate_posts values(1,$1,'Keep post',$2,null,'approved')", [owner, JSON.stringify([postUrl])]);
    await db.exec(await readFile(new URL('../supabase/migrations/20261111000005_post_photo_privacy.sql', import.meta.url), 'utf8'));
    await db.exec(`create function public.is_boardmate_admin() returns boolean language sql stable as $$ select auth.uid() = '33333333-3333-4333-8333-333333333333'::uuid $$;`);
    await db.exec(await readFile(new URL('../supabase/migrations/20261111000007_admin_post_media_access.sql', import.meta.url), 'utf8'));
    await db.exec(await readFile(new URL('../supabase/migrations/20261111000010_admin_media_references.sql', import.meta.url), 'utf8'));
    const mediaVisible = async (bucket, mediaPath) => (await db.query('select public.can_read_boardmate_uploaded_media($1,$2) as allowed', [bucket, mediaPath])).rows[0].allowed;
    for (const reference of [{ path: postPath }, { storage_path: postPath }, { src: postUrl }, postPath, postUrl.replace('public/', 'sign/') + '?token=expired']) {
      await db.exec('reset role');
      await db.query("update public.roommate_posts set photos=$1, moderation_status='rejected'", [JSON.stringify([reference])]);
      await actor('33333333-3333-4333-8333-333333333333');
      assert.equal(await mediaVisible('roommate-post-photos', postPath), true);
      assert.equal((await db.query('select * from storage.objects where bucket_id=$1 and name=$2', ['roommate-post-photos', postPath])).rows.length, 1);
      await actor(viewer); assert.equal(await mediaVisible('roommate-post-photos', postPath), false);
    }
    await db.exec('reset role');
    await db.query('update public.roommate_posts set photos=$1', [JSON.stringify([postUrl])]);
    assert.equal((await db.query("select public.boardmate_media_url_matches($1,'listing-photos',$2) as matches", [listingUrl.replace('listing.jpg', 'a%20photo%20%F0%9F%8F%A0.jpg'), owner + '/a photo \u{1f3e0}.jpg'])).rows[0].matches, true);
    const videoPath = owner + '/clip.mp4';
    await db.query('insert into storage.objects values ($1,$2)', ['listing-photos', videoPath]);
    for (const reference of [{ path: videoPath }, { storage_path: videoPath }, { url: listingUrl.replace('listing.jpg', 'clip.mp4') }, 'listing-photos/' + videoPath]) {
      await db.query("update public.listings set photos=$1, moderation_status='rejected'", [JSON.stringify([reference])]);
      await actor('33333333-3333-4333-8333-333333333333');
      assert.equal(await mediaVisible('listing-photos', videoPath), true);
      assert.equal((await db.query('select * from storage.objects where bucket_id=$1 and name=$2', ['listing-photos', videoPath])).rows.length, 1);
      await actor(viewer); assert.equal(await mediaVisible('listing-photos', videoPath), false);
      await actor(null, 'anon');
      assert.equal((await db.query('select * from storage.objects where bucket_id=$1 and name=$2', ['listing-photos', videoPath])).rows.length, 0);
      await db.exec('reset role');
    }
    await db.query("update public.listings set photos=$1, moderation_status='approved'", [JSON.stringify([{ url: listingUrl, mimeType: 'image/jpeg' }, { url: 'https://external.example/keep.jpg' }])]);
    await db.query('delete from storage.objects where bucket_id=$1 and name=$2', ['listing-photos', videoPath]);
    for (const status of ['pending', 'approved', 'rejected']) {
      await db.exec('reset role');
      await db.query('update public.roommate_posts set moderation_status=$1', [status]);
      await actor('33333333-3333-4333-8333-333333333333');
      assert.equal(await mediaVisible('roommate-post-photos', postPath), true);
      assert.equal((await db.query('select * from storage.objects where bucket_id=$1 and name=$2', ['roommate-post-photos', postPath])).rows.length, 1);
      assert.equal(await mediaVisible('roommate-post-photos', owner + '/unattached.jpg'), false);
      await actor(viewer);
      assert.equal(await mediaVisible('roommate-post-photos', postPath), status === 'approved');
    }
    await db.exec('reset role');
    await db.query("update public.roommate_posts set moderation_status='approved'");
    for (const [bucket, mediaPath] of [['listing-photos', listingPath], ['roommate-post-photos', postPath]]) {
      await actor(viewer); assert.equal(await mediaVisible(bucket, mediaPath), true);
      await assert.rejects(db.query('select public.set_boardmate_uploaded_photo_visibility($1,$2,false)', [bucket, mediaPath]), /owner/);
      await assert.rejects(db.query('select public.delete_boardmate_uploaded_photo($1,$2)', [bucket, mediaPath]), /owner/);
      await actor(owner);
      await db.query('select public.set_boardmate_uploaded_photo_visibility($1,$2,false)', [bucket, mediaPath]);
      assert.equal(await mediaVisible(bucket, mediaPath), true);
      await actor(viewer); assert.equal(await mediaVisible(bucket, mediaPath), false);
      assert.equal((await db.query('select * from storage.objects where bucket_id=$1 and name=$2', [bucket, mediaPath])).rows.length, 0);
      await actor(owner); await db.query('select public.set_boardmate_uploaded_photo_visibility($1,$2,true)', [bucket, mediaPath]);
      await actor(viewer); assert.equal(await mediaVisible(bucket, mediaPath), true);
      await actor(owner);
      await assert.rejects(db.query('select public.delete_boardmate_uploaded_photo($1,$2)', [bucket, mediaPath]), /Remove the stored file/);
      await db.query('delete from storage.objects where bucket_id=$1 and name=$2', [bucket, mediaPath]);
      await db.query('select public.delete_boardmate_uploaded_photo($1,$2)', [bucket, mediaPath]);
    }
    await db.exec('reset role');
    const listing = (await db.query('select * from public.listings')).rows[0];
    assert.equal(listing.title, 'Keep listing'); assert.equal(listing.image_url, null);
    assert.deepEqual(listing.photos, [{ url: 'https://external.example/keep.jpg' }]);
    assert.deepEqual((await db.query('select photos from public.roommate_posts')).rows[0].photos, []);
  } finally { await db.close(); }
});
