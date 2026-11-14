import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { after, afterEach, before, beforeEach, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

// This fixture has no network/connection-string support. SQL runs exclusively
// in a disposable in-memory PostgreSQL instance, never against Supabase.
const member = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const admin = '33333333-3333-4333-8333-333333333333';
const legacyApproved = '44444444-4444-4444-8444-444444444444';
const legacyPending = '55555555-5555-4555-8555-555555555555';
const legacyRejected = '66666666-6666-4666-8666-666666666666';
let db;
let originalProfiles;
let beforeCorrection;
const fix = await readFile(new URL('../supabase/migrations/20261113000001_fix_registration_email_guard_timing.sql', import.meta.url), 'utf8');
const migration = await readFile(new URL('../supabase/migrations/20261111000000_verification_submission_workflow.sql', import.meta.url), 'utf8');

async function actor(id, role = 'authenticated') {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true)", [id || '', role]);
  await db.exec(`set local role ${role}`);
}
async function upload(user = member, kind = 'government-id', metadata = { mimetype: 'image/png', size: 512 }) {
  const path = `${user}/${kind}-${randomUUID()}.png`;
  await db.query("insert into storage.objects(bucket_id, name, metadata) values ('verification-documents', $1, $2)", [path, metadata]);
  return path;
}
async function submit(idPath, selfiePath, revision = null) {
  return (await db.query('select * from public.submit_boardmate_verification($1, $2, $3)', [idPath, selfiePath, revision])).rows[0];
}
async function review(user, revision, status = 'approved', reason = null) {
  return (await db.query('select * from public.review_boardmate_verification($1, $2, $3, $4)', [user, revision, status, reason])).rows[0];
}
async function firstSubmission() {
  await actor(member);
  const idPath = await upload();
  const selfiePath = await upload(member, 'selfie');
  return { idPath, selfiePath, profile: await submit(idPath, selfiePath) };
}
async function expectFailure(action, pattern) {
  await db.exec('savepoint expected_failure');
  try {
    await assert.rejects(action, pattern);
  } finally {
    await db.exec('rollback to savepoint expected_failure');
  }
}

before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create schema storage;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;
    grant usage on schema public, auth, storage to anon, authenticated, service_role;
    create table auth.users(id uuid primary key, email_confirmed_at timestamptz);
    grant select, delete on auth.users to service_role;
    create table public.admin_memberships(user_id uuid primary key references auth.users(id) on delete cascade);
    alter table public.admin_memberships enable row level security;
    create function public.is_boardmate_admin() returns boolean language sql stable security definer set search_path = '' as $$
      select exists(select 1 from public.admin_memberships where user_id = auth.uid());
    $$;
    revoke all on function public.is_boardmate_admin() from public;
    grant execute on function public.is_boardmate_admin() to authenticated;
    create table public.profiles (
      id uuid primary key references auth.users(id) on delete cascade,
      full_name text default '', email text default '', phone text default '', role text default 'RENTER',
      gender text, dob date, business_name text, address text, gov_id_number text, property_type text,
      avatar_url text, created_at timestamptz not null default now(), suspended_at timestamptz, suspended_by uuid, suspension_reason text,
      verification_status text not null default 'pending' constraint profiles_verification_status_check check (verification_status in ('pending', 'approved', 'rejected')),
      verification_reason text, verified_at timestamptz, verified_by uuid references public.admin_memberships(user_id) on delete set null,
      id_document_path text, selfie_document_path text, id_uploaded boolean default false, selfie_uploaded boolean default false
    );
    alter table public.profiles enable row level security;
    grant select, insert, update on public.profiles to authenticated;
    create policy profile_read on public.profiles for select to authenticated using (id = auth.uid() or public.is_boardmate_admin());
    create policy profile_insert on public.profiles for insert to authenticated with check (id = auth.uid());
    create policy profile_update on public.profiles for update to authenticated using ((id = auth.uid() and suspended_at is null) or public.is_boardmate_admin())
      with check ((id = auth.uid() and suspended_at is null) or public.is_boardmate_admin());
    create table storage.buckets(id text primary key, public boolean, file_size_limit bigint);
    create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text, metadata jsonb, unique(bucket_id, name));
    insert into storage.buckets values ('verification-documents', false, 10485760), ('listing-photos', true, 10485760);
    alter table storage.objects enable row level security;
    grant select, insert, update, delete on storage.objects to authenticated, anon, service_role;
    -- Deliberately broad permissive policy proves restrictive guards still win.
    create policy broad_storage_policy on storage.objects to public using (true) with check (true);
    create table public.admin_review_notifications (
      id bigint generated always as identity primary key, notification_key text unique not null,
      title text not null, detail text not null, destination_tab text not null, icon text not null,
      source_type text not null, source_id text not null, created_at timestamptz default now(), read_at timestamptz, hidden_until timestamptz
    );
    alter table public.admin_review_notifications enable row level security;
    grant select, update, delete on public.admin_review_notifications to authenticated;
    create policy admin_notices on public.admin_review_notifications to authenticated using (public.is_boardmate_admin()) with check (public.is_boardmate_admin());
    create function public.mark_admin_review_notification_reviewed() returns trigger language plpgsql security definer set search_path = '' as $$
    begin update public.admin_review_notifications set read_at = now() where notification_key = 'profiles:' || new.id; return new; end; $$;
    insert into auth.users(id) values ('${member}'), ('${other}'), ('${admin}'), ('${legacyApproved}'), ('${legacyPending}'), ('${legacyRejected}');
    insert into public.admin_memberships values ('${admin}');
    insert into public.profiles(id, verification_status, id_document_path, selfie_document_path, verification_reason) values
      ('${other}', 'pending', null, null, null),
      ('${admin}', 'approved', null, null, null),
      ('${legacyApproved}', 'approved', '${legacyApproved}/missing-old-id.pdf', '${legacyApproved}/missing-old-selfie.png', 'Grandfathered'),
      ('${legacyPending}', 'pending', null, null, 'Legacy pending'),
      ('${legacyRejected}', 'rejected', null, null, 'Legacy rejection');
  `);
  await db.query("insert into public.admin_review_notifications(notification_key,title,detail,destination_tab,icon,source_type,source_id) values ($1,'User verification needs review','Old incomplete submission','verifications','ID','profile',$2)", [`profiles:${legacyPending}`, legacyPending]);
  // Install the actual earlier shared moderation function; the new migration
  // must leave that function intact for listings and roommate posts.
  const earlier = await readFile(new URL('../supabase/migrations/20261101000000_listing_media_gallery.sql', import.meta.url), 'utf8');
  await db.exec(earlier.slice(earlier.indexOf('create or replace function'), earlier.indexOf("notify pgrst")));
  await db.exec('create trigger protect_profile_verification_fields before insert or update on public.profiles for each row execute function public.protect_boardmate_review_fields()');
  const suspensionMigration = await readFile(new URL('../supabase/migrations/20261028000003_reports_suspensions_and_blocking.sql', import.meta.url), 'utf8');
  await db.exec(suspensionMigration.slice(suspensionMigration.indexOf('create or replace function public.protect_boardmate_suspension_fields()'),
    suspensionMigration.indexOf('drop policy if exists "Users can update their own profile"')));
  originalProfiles = (await db.query('select to_jsonb(p) as profile from public.profiles p order by id')).rows.map(row => row.profile);
  await db.exec(migration);
  // A post-migration signup cannot smuggle approval, paths, flags or revisions.
  await db.query("insert into public.profiles(id,verification_status,id_document_path,selfie_document_path,id_uploaded,selfie_uploaded) values ($1,'approved','fake-id','fake-selfie',true,true)", [member]);
  await db.exec(await readFile(new URL('../supabase/migrations/20261113000000_registration_email_otp_guard.sql', import.meta.url), 'utf8'));
  // Model accounts enrolled under the already-installed original migration.
  await db.query('insert into public.boardmate_email_verification_required values ($1), ($2)', [member, other]);
  beforeCorrection = await snapshot();
  await db.exec(fix);

});

// All mutations here run only inside this isolated in-memory PostgreSQL fixture.
beforeEach(async () => { await db.exec('begin'); });
afterEach(async () => { await db.exec('rollback'); });
after(async () => { await db?.close(); });
async function snapshot() {
  const output = {};
  for (const table of ['auth.users','public.profiles','public.boardmate_email_verification_required','public.admin_review_notifications']) {
    output[table] = (await db.query(`select to_jsonb(x) as row from ${table} x order by to_jsonb(x)::text`)).rows;
  }
  output.functions = (await db.query(`select oid,pg_get_functiondef(oid) as definition,proacl::text from pg_proc where oid in ('public.guard_boardmate_email_review()'::regprocedure,'public.enroll_boardmate_email_verification()'::regprocedure)`)).rows;
  output.otherTriggers = (await db.query(`select oid,pg_get_triggerdef(oid) as definition from pg_trigger where not tgisinternal and tgname <> 'enforce_boardmate_email_before_review' order by oid`)).rows;
  return output;
}
async function confirmedSubmission() {
  await db.query('update auth.users set email_confirmed_at=now() where id=$1', [member]);
  return firstSubmission();
}
async function rejectedSubmission() {
  const result = await confirmedSubmission();
  await actor(admin);
  await review(member, result.profile.verification_revision, 'rejected', 'Please update identity');
  await db.exec('reset role');
  await db.query('update auth.users set email_confirmed_at=null where id=$1', [member]);
  return result;
}

test('correction preserves enrollment, accounts, functions and unrelated triggers; timing is immediate AFTER', async () => {
  assert.deepEqual(await snapshot(), beforeCorrection);
  const t = (await db.query(`select tgtype,tgenabled,tgdeferrable,tginitdeferred from pg_trigger where tgrelid='public.profiles'::regclass and tgname='enforce_boardmate_email_before_review'`)).rows[0];
  assert.deepEqual(t, { tgtype: 21, tgenabled: 'O', tgdeferrable: false, tginitdeferred: false });
});

test('regression reproduces old rejected-to-pending bypass and corrected guard rolls back identity, revision and notifications', async () => {
  await rejectedSubmission();
  await db.exec('savepoint old_guard');
  await db.exec(`create or replace trigger enforce_boardmate_email_before_review before insert or update on public.profiles for each row execute function public.guard_boardmate_email_review()`);
  await actor(member);
  const bypass = await db.query("update public.profiles set full_name='Changed identity' where id=$1 returning verification_status", [member]);
  assert.equal(bypass.rows[0].verification_status, 'pending');
  await db.exec('rollback to savepoint old_guard');
  await db.exec('reset role');
  const before = await snapshot();
  const submissions = (await db.query('select count(*)::int as n from public.boardmate_verification_submissions')).rows[0].n;
  await actor(member);
  await expectFailure(() => db.query("update public.profiles set full_name='Changed identity' where id=$1", [member]), /Verify your email/);
  await db.exec('reset role');
  assert.deepEqual(await snapshot(), before);
  assert.equal((await db.query('select count(*)::int as n from public.boardmate_verification_submissions')).rows[0].n, submissions);
});

test('unconfirmed document submission fails atomically and new Auth enrollment still works', async () => {
  await actor(member);
  const idPath=await upload(), selfiePath=await upload(member,'selfie');
  await expectFailure(() => submit(idPath,selfiePath), /Verify your email/);
  await db.exec('reset role');
  assert.equal((await db.query('select count(*)::int as n from public.boardmate_verification_submissions where user_id=$1',[member])).rows[0].n,0);
  const id = randomUUID();
  await db.query('insert into auth.users(id) values ($1)',[id]);
  assert.equal((await db.query('select count(*)::int as n from public.boardmate_email_verification_required where user_id=$1',[id])).rows[0].n,1);
});

test('unconfirmed administrator approval fails and rolls back submission review decision', async () => {
  const { profile }=await confirmedSubmission();
  await db.exec('reset role');
  await db.query('update auth.users set email_confirmed_at=null where id=$1',[member]);
  await actor(admin);
  await expectFailure(() => review(member,profile.verification_revision), /Verify your email/);
  await db.exec('reset role');
  assert.equal((await db.query('select status from public.boardmate_verification_submissions where revision=$1',[profile.verification_revision])).rows[0].status,'pending');
  assert.equal((await db.query('select verification_status from profiles where id=$1',[member])).rows[0].verification_status,'pending');
});

test('confirmed members submit; non-admin cannot approve; admin approval/rejection and legacy accounts remain intact', async () => {
  const { profile }=await confirmedSubmission();
  await expectFailure(() => review(member,profile.verification_revision), /administrator/i);
  await actor(admin);
  const approved=await review(member,profile.verification_revision);
  assert.equal(approved.verification_status,'approved');
  await actor(legacyRejected);
  const legacy=await db.query("update profiles set full_name='Legacy update' where id=$1 returning verification_status",[legacyRejected]);
  assert.equal(legacy.rows[0].verification_status,'rejected');
});

test('enrollment cannot be edited by ordinary members', async () => {
  await actor(member);
  await expectFailure(() => db.exec('delete from public.boardmate_email_verification_required'), /permission denied/);
});

test('final Pending and Approved states from even later BEFORE triggers are rejected', async () => {
  await db.exec(`create function public.test_late_status() returns trigger language plpgsql as $$
    begin if new.full_name in ('pending','approved') then new.verification_status:=new.full_name; end if; return new; end; $$;
    create trigger zzzz_test_late_status before update on public.profiles for each row execute function public.test_late_status();`);
  for (const status of ['pending','approved']) {
    await expectFailure(() => db.query('update profiles set full_name=$1 where id=$2',[status,member]), /Verify your email/);
  }
  assert.equal((await db.query('select verification_status from profiles where id=$1',[member])).rows[0].verification_status,'not_submitted');
});

test('verification queries execute read-only and report the corrected definitions', async () => {
  await db.exec('set transaction read only');
  const sql=await readFile(new URL('../supabase/review/registration_email_otp_timing_verification.sql', import.meta.url),'utf8');
  const results=await db.exec(sql);
  const checks=results[1].rows[0];
  for (const [name,value] of Object.entries(checks)) assert.equal(value,true,name);
});

test('forward migration reruns safely and rejects unexpected guard drift atomically', async () => {
  const isolated=new PGlite();
  try {
    await isolated.exec(`create role anon; create role authenticated; create schema auth;
      create table auth.users(id uuid primary key,email_confirmed_at timestamptz);
      create table profiles(id uuid primary key references auth.users(id),verification_status text);`);
    await isolated.exec(await readFile(new URL('../supabase/migrations/20261113000000_registration_email_otp_guard.sql',import.meta.url),'utf8'));
    await isolated.exec(fix);
    await isolated.exec(fix);
    await isolated.exec('alter table profiles disable trigger enforce_boardmate_email_before_review');
    await assert.rejects(isolated.exec(fix),/definition differs/);
    await isolated.exec('rollback');
    assert.equal((await isolated.query("select tgenabled from pg_trigger where tgname='enforce_boardmate_email_before_review'")).rows[0].tgenabled,'D');
  } finally { await isolated.close(); }
});
