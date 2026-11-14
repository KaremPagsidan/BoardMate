import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { approvalChange, manilaDate, shiftWeek, weekStart } from '../src/lib/weeklyStatistics.js';

test('week helpers use Philippine boundaries, cross years, and compare zero baselines', () => {
  assert.equal(manilaDate(new Date('2026-11-08T16:00:00Z')), '2026-11-09');
  assert.equal(weekStart('2026-11-11'), '2026-11-09');
  assert.equal(shiftWeek('2026-01-05', -1), '2025-12-29');
  assert.equal(approvalChange(3, 2).label, '+50%');
  assert.equal(approvalChange(1, 2).label, '-50%');
  assert.equal(approvalChange(2, 0).label, 'New approvals');
  assert.equal(approvalChange(0, 0).direction, 'unchanged');
});

test('durable approval history backfills known decisions, survives deletion, and enforces admin access', async () => {
  const db = new PGlite();
  const admin = '11111111-1111-4111-8111-111111111111', member = '22222222-2222-4222-8222-222222222222';
  try {
    await db.exec(`
      create role anon; create role authenticated; create schema auth;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.sub',true),'')::uuid $$;
      grant usage on schema auth to authenticated, anon;
      create function public.is_boardmate_admin() returns boolean language sql stable as $$ select auth.uid() = '${admin}'::uuid $$;
      create table public.profiles(id uuid primary key, verification_status text, verified_at timestamptz);
      create table public.listings(id bigint primary key, moderation_status text, reviewed_at timestamptz);
      create table public.roommate_posts(id bigint primary key, moderation_status text, reviewed_at timestamptz);
      create table public.boardmate_verification_submissions(user_id uuid, status text, reviewed_at timestamptz);
      create table public.admin_activity_logs(target_table text,target_id text,action text,created_at timestamptz);
      insert into public.profiles values('${member}','approved','2020-01-06T00:00:00Z');
      insert into public.listings values(1,'approved','2020-01-06T00:00:00Z'),(2,'pending',null);
      insert into public.roommate_posts values(1,'approved','2020-01-13T00:00:00Z');
      insert into public.boardmate_verification_submissions values('${member}','approved','2020-01-06T00:00:00Z'),('${member}','approved','2019-12-30T00:00:00Z');
      insert into public.admin_activity_logs values('listings','1','listings approved','2020-01-06T00:00:00Z'),('listings','2','listings approved','2020-01-05T16:00:00Z');
    `);
    await db.exec(await readFile(new URL('../supabase/migrations/20261111000006_weekly_approval_history.sql', import.meta.url), 'utf8'));
    assert.equal((await db.query('select count(*)::int as n from public.boardmate_approval_events')).rows[0].n, 5);
    const actor = async id => { await db.exec('reset role'); await db.query("select set_config('request.sub',$1,false)", [id]); await db.exec('set role authenticated'); };
    const report = async week => (await db.query('select public.get_boardmate_weekly_statistics($1) as report', [week])).rows[0].report;
    await actor(member);
    assert.equal((await db.query('select * from public.boardmate_approval_events')).rows.length, 0);
    await assert.rejects(report('2020-01-13'), /Administrator/);
    await actor(admin);
    let data = await report('2020-01-15');
    assert.equal(data.week, '2020-01-13'); assert.equal(data.days.length, 7); assert.equal(data.trend.length, 8);
    assert.equal(data.days[0].posts, 1); assert.equal(data.previous.accounts, 1); assert.equal(data.previous.listings, 2);
    assert.equal(data.first_week, '2019-12-30');
    await assert.rejects(db.exec('delete from public.boardmate_approval_events'), /permission denied/);
    await assert.rejects(report('2999-01-01'), /Future/);
    await db.exec('reset role');
    await db.exec("update public.listings set moderation_status='rejected' where id=1; update public.listings set moderation_status='approved',reviewed_at='2020-01-13T01:00:00Z' where id=1;");
    await db.exec("update public.listings set reviewed_at='2020-01-13T02:00:00Z' where id=1; delete from public.listings where id=1; delete from public.profiles;");
    await actor(admin); data = await report('2020-01-13');
    assert.equal(data.days[0].listings, 1); assert.equal(data.previous.accounts, 1); assert.equal(data.previous.listings, 2);
    assert.equal((await db.query('select count(*)::int as n from public.boardmate_approval_events')).rows[0].n, 6);
    await db.exec('reset role');
    // A rolled-back approval must never enter preserved statistics.
    await db.exec("begin; insert into public.roommate_posts values(3,'approved','2020-01-13T03:00:00Z'); rollback;");
    await actor(admin); assert.equal((await report('2020-01-13')).days[0].posts, 1);
  } finally { await db.close(); }
});
