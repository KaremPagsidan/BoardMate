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
let notificationSettingsBaseline;
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
  await db.exec(`create table public.boardmate_notifications(id bigint generated always as identity primary key,user_id uuid references auth.users(id) on delete cascade,title text,body text,target_type text,target_id text,read_at timestamptz,created_at timestamptz default now());
    alter table public.boardmate_notifications enable row level security;
    grant select,update,delete on public.boardmate_notifications to authenticated;
    create policy own_notices on public.boardmate_notifications to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());`);
  notificationSettingsBaseline = await securitySnapshot();
  await db.exec(await readFile(new URL('../supabase/migrations/20261113000004_account_verification_settings_notifications.sql',import.meta.url),'utf8'));

});

beforeEach(async()=>{await db.exec('begin');});
afterEach(async()=>{await db.exec('rollback');});
after(async()=>{await db.close();});
for(const role of ['RENTER','LANDLORD']) for(const decision of ['approved','rejected'])test(`${role}: ${decision} notice targets Settings, deduplicates and stays private`,async()=>{
 await db.query('update profiles set role=$1 where id=$2',[role,member]);
 const {profile}=await firstSubmission();
 await db.exec('reset role');
 // Even a duplicate producer attachment must not create a duplicate event.
 await db.exec('create trigger test_duplicate_notice after update of verification_status on profiles for each row execute function public.notify_boardmate_verification_settings()');
 await actor(admin);await review(member,profile.verification_revision,decision,decision==='rejected'?'Correct your date of birth.':'Documents accepted.');
 await expectFailure(()=>review(member,profile.verification_revision,decision,'Repeated feedback'),/Stale/);
 await actor(member);const rows=(await db.query('select * from boardmate_notifications')).rows;
 assert.equal(rows.length,1);assert.equal(rows[0].target_type,'profile');assert.equal(rows[0].target_id,member);
 assert.match(rows[0].body,/Settings & Privacy → Account Verification/);assert.match(rows[0].body,/Review date:/);
 assert.match(rows[0].body,decision==='rejected'?/Correct your date of birth/:/Documents accepted/);
 await db.query('update boardmate_notifications set read_at=now() where id=$1',[rows[0].id]);
 await expectFailure(()=>db.query("update boardmate_notifications set verification_event_key='tamper' where id=$1",[rows[0].id]),/immutable/);
 await actor(other);assert.equal((await db.query('select * from boardmate_notifications')).rows.length,0);
 assert.equal((await db.query('update boardmate_notifications set read_at=now() returning id')).rows.length,0);
});
test('same Pending status emits no decision, and later versions get separate notices without overwriting history',async()=>{
 const first=await firstSubmission();await actor(admin);await review(member,first.profile.verification_revision,'rejected','First feedback');
 await actor(member);const id=await upload(),selfie=await upload(member,'selfie');const next=await submit(id,selfie,first.profile.verification_revision);
 assert.equal((await db.query('select * from boardmate_notifications')).rows.length,1);
 await actor(admin);await review(member,next.verification_revision,'approved','Second review accepted');
 await actor(member);const rows=(await db.query('select * from boardmate_notifications')).rows;
 assert.equal(rows.length,2);assert.notEqual(rows[0].verification_event_key,rows[1].verification_event_key);
 assert.ok(rows.some(row=>row.body.includes('First feedback')));
});

async function securitySnapshot(){
 return {
  profiles:(await db.query('select to_jsonb(p) as row from profiles p order by id')).rows,
  accounts:(await db.query('select to_jsonb(u) as row from auth.users u order by id')).rows,
  policies:(await db.query("select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check from pg_policies order by schemaname,tablename,policyname")).rows,
  core:(await db.query("select oid,pg_get_functiondef(oid) as definition,proacl::text from pg_proc where oid in ('public.submit_boardmate_verification(text,text,uuid)'::regprocedure,'public.review_boardmate_verification(uuid,uuid,text,text)'::regprocedure,'public.protect_boardmate_verification_profile()'::regprocedure) order by oid")).rows,
 };
}
test('notification migration leaves account/profile records, RLS and core verification controls unchanged',async()=>{
 assert.deepEqual(await securitySnapshot(),notificationSettingsBaseline);
});
