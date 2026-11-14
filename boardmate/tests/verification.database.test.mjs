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
    create table auth.users(id uuid primary key);
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
    insert into auth.users values ('${member}'), ('${other}'), ('${admin}'), ('${legacyApproved}'), ('${legacyPending}'), ('${legacyRejected}');
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
});
beforeEach(async () => { await db.exec('begin'); });
afterEach(async () => { await db.exec('rollback'); });
after(async () => { await db?.close(); });

test('migration preserves every legacy status, flag, and review field', async () => {
  const actual = (await db.query('select to_jsonb(p) - \'verification_revision\' as profile from public.profiles p where id <> $1 order by id', [member])).rows.map(row => row.profile);
  assert.deepEqual(actual, originalProfiles);
  for (const user of [legacyApproved, legacyPending, legacyRejected]) {
    await actor(user);
    const result = await db.query("update public.profiles set avatar_url = 'new-avatar' where id = $1 returning verification_status, verification_reason", [user]);
    const original = originalProfiles.find(profile => profile.id === user);
    assert.equal(result.rows[0].verification_status, original.verification_status);
    assert.equal(result.rows[0].verification_reason, original.verification_reason);
  }
});

test('legacy approved identity edits fail without silently invalidating approval', async () => {
  await actor(legacyApproved);
  await expectFailure(() => db.query("update public.profiles set full_name = 'Changed identity' where id = $1", [legacyApproved]), /Legacy approved identity/);
  assert.equal((await db.query('select verification_status from public.profiles where id = $1', [legacyApproved])).rows[0].verification_status, 'approved');
});

test('submitted documents cannot be overwritten, moved or deleted; unsubmitted cleanup still works', async () => {
  const { idPath } = await firstSubmission();
  for (const sql of [
    'update storage.objects set metadata = \'{"mimetype":"image/png","size":999}\' where name = $1 returning name',
    "update storage.objects set name = name || '-moved' where name = $1 returning name",
    'delete from storage.objects where name = $1 returning name',
  ]) assert.equal((await db.query(sql, [idPath])).rows.length, 0);
  const temporary = await upload();
  assert.equal((await db.query('delete from storage.objects where name = $1 returning name', [temporary])).rows.length, 1);
});

test('storage trigger blocks mutation even when RLS is bypassed by an ordinary maintenance role', async () => {
  const { idPath } = await firstSubmission();
  await db.exec('reset role');
  await expectFailure(() => db.query('delete from storage.objects where name = $1', [idPath]), /immutable/);
  await expectFailure(() => db.query("update storage.objects set metadata = '{}' where name = $1", [idPath]), /immutable/);
});

test('replacement creates a new revision, retains immutable history, and cannot reuse an old path', async () => {
  const first = await firstSubmission();
  await actor(admin);
  await review(member, first.profile.verification_revision, 'rejected', 'Please replace the ID');
  await actor(member);
  const replacement = await upload();
  const next = await submit(replacement, first.selfiePath, first.profile.verification_revision);
  assert.notEqual(next.verification_revision, first.profile.verification_revision);
  assert.equal(next.verification_status, 'pending');
  await expectFailure(() => submit(first.idPath, first.selfiePath, next.verification_revision), /new unique/);
  assert.equal((await db.query('select * from public.boardmate_verification_submissions')).rows.length, 2);
});

test('resubmission during review rejects the stale approval and rejection', async () => {
  const first = await firstSubmission();
  const replacement = await upload();
  const next = await submit(replacement, first.selfiePath, first.profile.verification_revision);
  await actor(admin);
  await expectFailure(() => review(member, first.profile.verification_revision), /Stale verification review/);
  await expectFailure(() => review(member, first.profile.verification_revision, 'rejected', 'Old review'), /Stale verification review/);
  assert.equal((await review(member, next.verification_revision)).verification_status, 'approved');
});

test('competing review decisions have exactly one successful result', async () => {
  const { profile } = await firstSubmission();
  await actor(admin);
  // PGlite has one connection: submitted competing calls are serialized. This
  // checks both decisions' compare-and-set behavior, not multi-session blocking.
  await db.exec('savepoint competing_reviews');
  const actions = await Promise.allSettled([
    review(member, profile.verification_revision),
    review(member, profile.verification_revision, 'rejected', 'Competing review'),
  ]);
  assert.equal(actions.filter(action => action.status === 'fulfilled').length, 1);
  assert.equal(actions.filter(action => action.status === 'rejected').length, 1);
  await db.exec('rollback to savepoint competing_reviews');
});

test('unauthorized document access is denied even with a permissive Storage policy', async () => {
  const { idPath } = await firstSubmission();
  assert.equal((await db.query('select * from storage.objects where name = $1', [idPath])).rows.length, 1);
  await actor(other);
  assert.equal((await db.query('select * from storage.objects where name = $1', [idPath])).rows.length, 0);
  assert.equal((await db.query('select * from public.boardmate_verification_submissions where user_id = $1', [member])).rows.length, 0);
  await actor(null, 'anon');
  assert.equal((await db.query('select * from storage.objects where name = $1', [idPath])).rows.length, 0);
  await actor(admin);
  assert.equal((await db.query('select * from storage.objects where name = $1', [idPath])).rows.length, 1);
});

test('direct profile updates cannot bypass submission or versioned review RPCs', async () => {
  await actor(member);
  await expectFailure(() => db.query("update public.profiles set verification_status = 'approved' where id = $1", [member]), /permission denied/);
  await expectFailure(() => db.query("update public.profiles set id_document_path = 'fake' where id = $1", [member]), /permission denied/);
  const { profile } = await firstSubmission();
  await actor(admin);
  await expectFailure(() => db.query("update public.profiles set verification_status = 'approved' where id = $1", [member]), /permission denied/);
  await actor(other);
  await expectFailure(() => review(member, profile.verification_revision), /Administrator authorization/);
});

test('profile identity changes create a new revision; unrelated changes retain the decision', async () => {
  const { profile } = await firstSubmission();
  await actor(admin);
  await review(member, profile.verification_revision);
  await actor(member);
  const unrelated = (await db.query("update public.profiles set avatar_url = 'photo' where id = $1 returning *", [member])).rows[0];
  assert.equal(unrelated.verification_status, 'approved');
  assert.equal(unrelated.verification_revision, profile.verification_revision);
  const changed = (await db.query("update public.profiles set full_name = 'New name' where id = $1 returning *", [member])).rows[0];
  assert.equal(changed.verification_status, 'pending');
  assert.notEqual(changed.verification_revision, profile.verification_revision);
});

test('missing, empty, oversized, wrong-type and foreign documents fail before any submission', async () => {
  await actor(member);
  const selfie = await upload(member, 'selfie');
  await expectFailure(() => submit(`${member}/missing.pdf`, selfie), /Both documents must exist/);
  for (const metadata of [{ mimetype: 'image/png', size: 0 }, { mimetype: 'image/png', size: 10485761 }, { mimetype: 'text/html', size: 10 }]) {
    const invalid = await upload(member, 'government-id', metadata);
    await expectFailure(() => submit(invalid, selfie), /Both documents must exist/);
  }
  await expectFailure(() => submit(`${other}/government-id-${randomUUID()}.png`, selfie), /account owner folder/);
  assert.equal((await db.query('select * from public.boardmate_verification_submissions')).rows.length, 0);
});

test('notifications remain unique, reopen on resubmission, and ignore unrelated edits', async () => {
  const first = await firstSubmission();
  await actor(admin);
  await review(member, first.profile.verification_revision, 'rejected', 'Replace ID');
  let notices = (await db.query('select * from public.admin_review_notifications where notification_key = $1', [`profiles:${member}`])).rows;
  assert.equal(notices.length, 1);
  assert.ok(notices[0].read_at);
  await actor(member);
  const replacement = await upload();
  await submit(replacement, first.selfiePath, first.profile.verification_revision);
  await db.query("update public.profiles set avatar_url = 'photo' where id = $1", [member]);
  await actor(admin);
  notices = (await db.query('select * from public.admin_review_notifications where notification_key = $1', [`profiles:${member}`])).rows;
  assert.equal(notices.length, 1);
  assert.equal(notices[0].read_at, null);
});

test('trusted service-role purge remains possible, but ordinary admins cannot delete submitted files', async () => {
  const { idPath } = await firstSubmission();
  await actor(admin);
  assert.equal((await db.query('delete from storage.objects where name = $1 returning name', [idPath])).rows.length, 0);
  await actor(null, 'service_role');
  assert.equal((await db.query('delete from storage.objects where name = $1 returning name', [idPath])).rows.length, 1);
  await actor(member);
  await expectFailure(() => db.query("insert into storage.objects(bucket_id,name,metadata) values ('verification-documents',$1,'{}')", [idPath]), /row-level security|immutable/);
});

test('RPCs/helpers have trusted ownership, empty search paths and restricted execution privileges', async () => {
  await db.exec('reset role');
  const functions = (await db.query(`select p.proname, r.rolname, p.proconfig from pg_proc p join pg_roles r on r.oid = p.proowner
    where p.proname in ('submit_boardmate_verification','review_boardmate_verification','validate_boardmate_verification_documents','protect_boardmate_verification_object')`)).rows;
  assert.equal(functions.length, 4);
  assert.ok(functions.every(fn => fn.rolname === 'postgres' && fn.proconfig.includes('search_path=""')));
  const grants = (await db.query(`select
    has_function_privilege('anon','public.submit_boardmate_verification(text,text,uuid)','execute') as anonymous,
    has_function_privilege('authenticated','public.validate_boardmate_verification_documents(uuid,text,text)','execute') as helper,
    has_function_privilege('authenticated','public.review_boardmate_verification(uuid,uuid,text,text)','execute') as review`)).rows[0];
  assert.deepEqual(grants, { anonymous: false, helper: false, review: true });
});

test('a review completed before resubmission cannot leave the replacement approved', async () => {
  const first = await firstSubmission();
  await actor(admin);
  await review(member, first.profile.verification_revision);
  await actor(member);
  const replacement = await upload();
  const next = await submit(replacement, first.selfiePath, first.profile.verification_revision);
  assert.equal(next.verification_status, 'pending');
  assert.equal(next.verified_by, null);
  assert.notEqual(next.verification_revision, first.profile.verification_revision);
});

test('legacy missing document paths remain frozen tombstones without invalidating accounts', async () => {
  await actor(legacyApproved);
  await expectFailure(() => db.query("insert into storage.objects(bucket_id,name,metadata) values ('verification-documents',$1,'{}')", [`${legacyApproved}/missing-old-id.pdf`]), /row-level security|immutable/);
  assert.equal((await db.query('select verification_status from public.profiles where id = $1', [legacyApproved])).rows[0].verification_status, 'approved');
});

test('swapping previously submitted ID/selfie paths is not a unique replacement', async () => {
  const first = await firstSubmission();
  await expectFailure(() => submit(first.selfiePath, first.idPath, first.profile.verification_revision), /new unique/);
});

test('suspended accounts cannot upload or submit verification documents', async () => {
  const first = await firstSubmission();
  await actor(admin);
  await db.query('update public.profiles set suspended_at = now() where id = $1', [member]);
  await actor(member);
  await expectFailure(() => upload(), /row-level security/);
  await expectFailure(() => submit(first.idPath, first.selfiePath, first.profile.verification_revision), /non-suspended/);
});

test('failed notification writes roll back the whole submission and allow retry', async () => {
  await actor(member);
  const idPath = await upload();
  const selfiePath = await upload(member, 'selfie');
  await db.exec('reset role');
  await db.exec(`alter table public.admin_review_notifications add constraint simulate_notification_failure check (notification_key <> 'profiles:${member}')`);
  await actor(member);
  await expectFailure(() => submit(idPath, selfiePath), /simulate_notification_failure/);
  assert.equal((await db.query('select verification_status from public.profiles where id = $1', [member])).rows[0].verification_status, 'not_submitted');
  assert.equal((await db.query('select * from public.boardmate_verification_submissions')).rows.length, 0);
  await db.exec('reset role');
  await db.exec('alter table public.admin_review_notifications drop constraint simulate_notification_failure');
  await actor(member);
  assert.equal((await submit(idPath, selfiePath)).verification_status, 'pending');
});

test('other Storage buckets retain their existing access and mutations', async () => {
  await actor(member);
  await db.query("insert into storage.objects(bucket_id,name,metadata) values ('listing-photos','other-bucket-file','{}')");
  assert.equal((await db.query("update storage.objects set metadata = jsonb_build_object('size', 10) where bucket_id = 'listing-photos' returning name")).rows.length, 1);
  assert.equal((await db.query("delete from storage.objects where bucket_id = 'listing-photos' returning name")).rows.length, 1);
});

test('trusted deletion of a reviewer clears attribution without invalidating approved accounts', async () => {
  const { profile } = await firstSubmission();
  await actor(admin);
  await review(member, profile.verification_revision);
  await actor(null, 'service_role');
  await db.query('delete from auth.users where id = $1', [admin]);
  await actor(member);
  const result = (await db.query('select verification_status, verification_revision, verified_by from public.profiles where id = $1', [member])).rows[0];
  assert.equal(result.verification_status, 'approved');
  assert.equal(result.verification_revision, profile.verification_revision);
  assert.equal(result.verified_by, null);
});

test('competing submissions require the expected revision and cannot silently overwrite each other', async () => {
  await actor(member);
  const firstId = await upload();
  const firstSelfie = await upload(member, 'selfie');
  const secondId = await upload();
  const secondSelfie = await upload(member, 'selfie');
  await db.exec('savepoint competing_submissions');
  const results = await Promise.allSettled([submit(firstId, firstSelfie), submit(secondId, secondSelfie)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected').length, 1);
  await db.exec('rollback to savepoint competing_submissions');
});

test('new profile inserts cannot forge approval, document paths, flags, or a revision', async () => {
  await actor(member);
  const inserted = (await db.query('select verification_status,verification_revision,id_document_path,selfie_document_path,id_uploaded,selfie_uploaded from public.profiles where id = $1', [member])).rows[0];
  assert.deepEqual(inserted, { verification_status: 'not_submitted', verification_revision: null, id_document_path: null, selfie_document_path: null, id_uploaded: false, selfie_uploaded: false });
});

test('stale legacy queue notices are retired without changing account status', async () => {
  await actor(admin);
  const notice = (await db.query('select * from public.admin_review_notifications where notification_key = $1', [`profiles:${legacyPending}`])).rows[0];
  assert.ok(notice.read_at);
  assert.equal(notice.title, 'Legacy verification status retained');
  assert.equal((await db.query('select verification_status from public.profiles where id = $1', [legacyPending])).rows[0].verification_status, 'pending');
});

test('Auth-created accounts persist identity and submit private documents for admin approval', async () => {
  await db.exec('reset role');
  await db.exec(`alter table auth.users add column email text unique, add column raw_user_meta_data jsonb;
    create role supabase_auth_admin;
    grant usage on schema auth to supabase_auth_admin;
    grant insert on auth.users to supabase_auth_admin;`);
  const repair = await readFile(new URL('../supabase/migrations/20261111000008_repair_registration_profile_trigger.sql', import.meta.url), 'utf8');
  await db.exec(repair.replace(/^begin;$/m, '').replace(/^commit;$/m, ''));
  const id = '77777777-7777-4777-8777-777777777777';
  await db.exec('set local role supabase_auth_admin');
  await db.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)', [id, 'new@example.com', { full_name: 'New Member', role: 'RENTER', phone: '09123456789', gender: 'Male', dob: '2000-01-01' }]);
  await actor(id);
  const profile = (await db.query('select * from public.profiles where id=$1', [id])).rows[0];
  assert.equal(profile.full_name, 'New Member'); assert.equal(profile.email, 'new@example.com');
  assert.equal(profile.verification_status, 'not_submitted'); assert.equal(profile.verification_revision, null);
  const idPath = await upload(id), selfiePath = await upload(id, 'selfie');
  const submitted = (await db.query('select * from public.submit_boardmate_verification($1,$2,null)', [idPath, selfiePath])).rows[0];
  assert.equal(submitted.verification_status, 'pending'); assert.ok(submitted.verification_revision);
  await actor(admin);
  assert.equal((await db.query('select * from public.boardmate_verification_submissions where user_id=$1', [id])).rows.length, 1);
  const reviewed = (await db.query("select * from public.review_boardmate_verification($1,$2,'approved',null)", [id, submitted.verification_revision])).rows[0];
  assert.equal(reviewed.verification_status, 'approved');
});

for (const role of ['RENTER', 'LANDLORD']) test(`${role} approval activates the account and notifies once; rejection still works`, async () => {
  await db.exec('reset role');
  await db.query('update public.profiles set role=$1 where id=$2', [role, member]);
  await db.exec('create table public.boardmate_notifications(user_id uuid, title text, body text)');
  const activity = await readFile(new URL('../supabase/migrations/20261028000006_notifications_and_public_profiles.sql', import.meta.url), 'utf8');
  await db.exec(activity.slice(0, activity.indexOf('drop trigger if exists notify_boardmate_roommate_post_like')));
  await db.exec('create trigger notify_boardmate_profile_review after update of verification_status on public.profiles for each row execute function public.notify_boardmate_marketplace_activity()');
  const { profile } = await firstSubmission();
  await actor(admin);
  const approved = await review(member, profile.verification_revision);
  assert.equal(approved.verification_status, 'approved'); assert.equal(approved.verified_by, admin);
  await expectFailure(() => review(member, profile.verification_revision), /Stale/);
  await db.exec('reset role');
  let notices = (await db.query('select * from public.boardmate_notifications where user_id=$1', [member])).rows;
  assert.equal(notices.length, 1); assert.match(notices[0].body, /verified-member features/);
  await actor(member);
  const replacement = await upload();
  const next = await submit(replacement, profile.selfie_document_path, profile.verification_revision);
  await actor(admin);
  const rejected = await review(member, next.verification_revision, 'rejected', 'Replace the ID');
  assert.equal(rejected.verification_status, 'rejected'); assert.equal(rejected.verification_reason, 'Replace the ID');
  await db.exec('reset role');
  notices = (await db.query('select * from public.boardmate_notifications where user_id=$1', [member])).rows;
  assert.equal(notices.length, 2); assert.match(notices[1].body, /Replace the ID/);
});
