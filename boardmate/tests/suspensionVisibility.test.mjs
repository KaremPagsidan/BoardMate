import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

test('suspension hides content without rewriting it and blocks messages through direct SQL', async () => {
  const db = new PGlite();
  const owner = '11111111-1111-4111-8111-111111111111';
  const viewer = '22222222-2222-4222-8222-222222222222';
  const admin = '33333333-3333-4333-8333-333333333333';
  const alreadySuspended = '44444444-4444-4444-8444-444444444444';
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.sub', true), '')::uuid $$;
      grant usage on schema auth to anon, authenticated;
      create function public.is_boardmate_admin() returns boolean language sql stable as $$ select auth.uid() = '${admin}'::uuid $$;
      create table public.profiles(id uuid primary key, suspended_at timestamptz);
      insert into public.profiles values ('${owner}', null), ('${viewer}', null), ('${admin}', null), ('${alreadySuspended}', now());
      create table public.listings(id integer primary key, owner_id uuid, moderation_status text, is_available boolean);
      create table public.roommate_posts(id integer primary key, user_id uuid, moderation_status text, deleted_at timestamptz);
      create table public.direct_messages(id integer primary key, sender_id uuid, recipient_id uuid);
      alter table public.listings enable row level security;
      alter table public.roommate_posts enable row level security;
      alter table public.direct_messages enable row level security;
      grant select on public.listings, public.roommate_posts to anon, authenticated;
      grant insert on public.direct_messages to authenticated;
      create policy listing_read on public.listings for select using
        ((moderation_status = 'approved' and is_available) or owner_id = auth.uid() or public.is_boardmate_admin());
      create policy post_read on public.roommate_posts for select using
        ((moderation_status = 'approved' and deleted_at is null) or user_id = auth.uid() or public.is_boardmate_admin());
      create policy message_send on public.direct_messages for insert to authenticated with check (sender_id = auth.uid());
      insert into public.listings values (1, '${owner}', 'approved', true), (2, '${owner}', 'pending', true), (3, '${owner}', 'rejected', false), (4, '${alreadySuspended}', 'approved', true);
      insert into public.roommate_posts values (1, '${owner}', 'approved', null), (2, '${owner}', 'rejected', null), (3, '${owner}', 'approved', now()), (4, '${alreadySuspended}', 'approved', null);
    `);
    await db.exec(await readFile(new URL('../supabase/migrations/20261111000002_suspended_content_visibility.sql', import.meta.url), 'utf8'));
    const actor = async id => { await db.exec('reset role'); await db.query("select set_config('request.sub', $1, false)", [id || '']); await db.exec(`set role ${id ? 'authenticated' : 'anon'}`); };
    const visible = async table => (await db.query(`select id from public.${table} order by id`)).rows.map(row => row.id);
    await actor(viewer);
    assert.deepEqual(await visible('listings'), [1]);
    assert.deepEqual(await visible('roommate_posts'), [1]);
    await db.exec(`insert into public.direct_messages values(1, '${viewer}', '${owner}')`);
    await db.exec('reset role');
    await db.query('update public.profiles set suspended_at = now() where id = $1', [owner]);
    assert.equal((await db.query('select revision from public.boardmate_visibility_revision')).rows[0].revision, 1);
    await actor(viewer);
    assert.deepEqual(await visible('listings'), []);
    assert.deepEqual(await visible('roommate_posts'), []);
    await assert.rejects(db.exec(`insert into public.direct_messages values(2, '${viewer}', '${owner}')`), /suspended/);
    await assert.rejects(db.exec('update public.boardmate_visibility_revision set revision = 100'), /permission denied/);
    await actor(owner);
    assert.deepEqual(await visible('listings'), [1, 2, 3]);
    await assert.rejects(db.exec(`insert into public.direct_messages values(3, '${owner}', '${viewer}')`), /suspended/);
    await actor(admin);
    assert.deepEqual(await visible('listings'), [1, 2, 3, 4]);
    assert.deepEqual(await visible('roommate_posts'), [1, 2, 3, 4]);
    await actor(null);
    assert.deepEqual(await visible('listings'), []);
    await db.exec('reset role');
    // Even a broad permissive policy cannot bypass the restrictive suspension policy.
    await db.exec('create policy accidental_listing_read on public.listings for select using (true)');
    await actor(viewer);
    assert.deepEqual(await visible('listings'), []);
    await db.exec('reset role');
    await db.exec('drop policy accidental_listing_read on public.listings');
    await db.query('update public.profiles set suspended_at = null where id = $1', [owner]);
    await actor(viewer);
    assert.deepEqual(await visible('listings'), [1]);
    assert.deepEqual(await visible('roommate_posts'), [1]);
    await db.exec(`insert into public.direct_messages values(4, '${viewer}', '${owner}')`);
    await db.exec('reset role');
    assert.equal((await db.query("select count(*)::int as n from public.listings where moderation_status = 'rejected' and not is_available")).rows[0].n, 1);
    assert.equal((await db.query('select revision from public.boardmate_visibility_revision')).rows[0].revision, 2);
  } finally { await db.close(); }
});

test('message preflight stops before attachment upload when recipient is suspended', async () => {
  const source = (await readFile(new URL('../src/lib/directMessages.js', import.meta.url), 'utf8'))
    .replace("import { supabase } from '../supabaseClient';", 'const supabase = globalThis.suspensionTestClient;')
    .replace("import { fetchBoardmatePresence } from './presence';", 'const fetchBoardmatePresence = async () => new Map();');
  let uploaded = false;
  globalThis.suspensionTestClient = {
    rpc: async (_, args) => ({ data: args.target_user_id !== 'suspended', error: null }),
    storage: { from() { uploaded = true; throw new Error('Must not upload'); } },
  };
  try {
    const api = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
    await assert.rejects(api.sendDirectMessage('active', 'suspended', 'Hello', { type: 'image/png', size: 12, name: 'test.png' }), /suspended or inactive/);
    assert.equal(uploaded, false);
    await api.assertDirectContactAvailable('active', 'active');
  } finally { delete globalThis.suspensionTestClient; }
});
