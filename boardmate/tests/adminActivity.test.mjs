import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

test('admin audit isolates actors, logs committed changes and enforces access', async () => {
  const db = new PGlite();
  const admin = '11111111-1111-4111-8111-111111111111';
  const member = '22222222-2222-4222-8222-222222222222';
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.sub', true), '')::uuid $$;
      create function auth.jwt() returns jsonb language sql stable as $$ select '{"session_id":"test-session"}'::jsonb $$;
      grant usage on schema auth to authenticated;
      create table public.admin_memberships(user_id uuid primary key);
      insert into public.admin_memberships values ('${admin}');
      create function public.is_boardmate_admin() returns boolean language sql stable security definer set search_path = '' as $$ select exists(select 1 from public.admin_memberships where user_id = auth.uid()) $$;
      create table public.profiles(id uuid primary key, full_name text, verification_status text, suspended_at timestamptz);
      create table public.listings(id integer primary key, moderation_status text);
      create table public.direct_messages(id integer primary key, body text);
      grant select, insert, update, delete on public.profiles, public.listings, public.direct_messages to authenticated;
      insert into public.profiles values ('${member}', 'Original', 'approved', null);
    `);
    await db.exec(await readFile(new URL('../supabase/migrations/20261111000001_admin_activity_logs.sql', import.meta.url), 'utf8'));
    const actor = async id => { await db.exec('reset role'); await db.query("select set_config('request.sub', $1, false)", [id]); await db.exec('set role authenticated'); };
    await actor(member);
    await db.exec("update public.profiles set full_name = 'Member edit'");
    assert.equal((await db.query('select * from public.admin_activity_logs')).rows.length, 0);
    await assert.rejects(db.exec("select public.record_boardmate_admin_session_event('login')"), /Administrator access/);
    await assert.rejects(db.exec("insert into public.admin_activity_logs(user_id, action, details) values (auth.uid(), 'fake', 'fake')"), /permission denied/);
    await actor(admin);
    await db.exec("select public.record_boardmate_admin_session_event('login'); select public.record_boardmate_admin_session_event('login');");
    await db.exec("update public.profiles set suspended_at = now(); update public.profiles set suspended_at = null;");
    await db.exec("insert into public.listings values (1, 'pending'); update public.listings set moderation_status = 'approved'; update public.listings set moderation_status = 'rejected'; delete from public.listings;");
    await db.exec("insert into public.direct_messages values (1, 'private body must not be copied');");
    await db.exec("begin; update public.profiles set full_name = 'Rolled back'; rollback;");
    const logs = (await db.query('select * from public.admin_activity_logs order by id')).rows;
    assert.equal(logs.filter(log => log.action === 'Admin login').length, 1);
    assert.ok(logs.every(log => log.user_id === admin));
    for (const action of ['Account suspended', 'Account reinstated', 'listings approved', 'listings rejected', 'listings delete', 'Admin message sent']) assert.ok(logs.some(log => log.action === action), action);
    assert.ok(!JSON.stringify(logs).includes('private body'));
    assert.ok(!logs.some(log => log.action === 'profiles update'));
    await assert.rejects(db.exec('delete from public.admin_activity_logs'), /permission denied/);
    await assert.rejects(db.exec("select public.record_boardmate_admin_session_event('forged')"), /Unsupported/);
    await db.exec("select public.record_boardmate_admin_session_event('logout_requested')");
    await actor(member);
    assert.equal((await db.query('select * from public.admin_activity_logs')).rows.length, 0);
  } finally { await db.close(); }
});
