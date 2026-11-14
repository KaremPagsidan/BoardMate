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
let beforeRetirement;
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
  await db.exec(await readFile(new URL('../supabase/migrations/20261113000000_registration_email_otp_guard.sql', import.meta.url),'utf8'));
  await db.query('insert into public.boardmate_email_verification_required values ($1)',[member]);
  beforeRetirement=await snapshot();
  await db.exec(await readFile(new URL('../supabase/migrations/20261113000002_remove_registration_email_otp_triggers.sql', import.meta.url),'utf8'));

});

beforeEach(async()=>{await db.exec('begin');});
afterEach(async()=>{await db.exec('rollback');});
after(async()=>{await db.close();});
async function snapshot(){
 const result={};
 for(const table of ['auth.users','profiles','boardmate_email_verification_required']) result[table]=(await db.query(`select to_jsonb(t) from ${table} t order by to_jsonb(t)::text`)).rows;
 result.functions=(await db.query(`select oid,pg_get_functiondef(oid),proacl::text from pg_proc where oid in ('public.guard_boardmate_email_review()'::regprocedure,'public.enroll_boardmate_email_verification()'::regprocedure)`)).rows;
 result.triggers=(await db.query(`select oid,pg_get_triggerdef(oid) from pg_trigger where not tgisinternal and tgname not in ('enforce_boardmate_email_before_review','boardmate_require_signup_email') order by oid`)).rows;
 return result;
}
test('retirement preserves accounts, historical enrollment, functions and unrelated controls',async()=>{
 assert.deepEqual(await snapshot(),beforeRetirement);
 await db.exec('set transaction read only');
 const results=await db.exec(await readFile(new URL('../supabase/review/registration_without_otp_verification.sql',import.meta.url),'utf8'));
 for(const value of Object.values(results[1].rows[0]))assert.equal(value,true);
});
for(const role of ['RENTER','LANDLORD']) test(`${role}: signup without email OTP submits documents; only admin can approve`,async()=>{
 await db.exec(`alter table auth.users add column email text unique, add column raw_user_meta_data jsonb;`);
 const repair=await readFile(new URL('../supabase/migrations/20261111000008_repair_registration_profile_trigger.sql',import.meta.url),'utf8');
 await db.exec(repair.replace(/^begin;$/m,'').replace(/^commit;$/m,''));
 const id=randomUUID();
 await db.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',[id,`${role.toLowerCase()}@example.com`,{full_name:'New Account',role}]);
 assert.equal((await db.query('select email_confirmed_at from auth.users where id=$1',[id])).rows[0].email_confirmed_at,null);
 await actor(id);
 const idPath=await upload(id),selfiePath=await upload(id,'selfie');
 const submitted=(await db.query('select * from public.submit_boardmate_verification($1,$2,null)',[idPath,selfiePath])).rows[0];
 assert.equal(submitted.verification_status,'pending');
 await expectFailure(()=>review(id,submitted.verification_revision),/administrator/i);
 await actor(admin);
 assert.equal((await review(id,submitted.verification_revision)).verification_status,'approved');
});
test('missing documents and direct forged approval remain forbidden after retirement',async()=>{
 await actor(member);
 await expectFailure(()=>submit('missing','missing'),/documents|path|upload/i);
 await expectFailure(()=>db.query("update profiles set verification_status='approved' where id=$1",[member]),/permission denied|versioned|authorized/i);
});

for (const timing of ['before','after']) test(`retirement handles the installed ${timing.toUpperCase()} guard and safe reapplication`,async()=>{
 await db.exec(`create trigger enforce_boardmate_email_before_review ${timing} insert or update on profiles for each row execute function public.guard_boardmate_email_review();
   create trigger boardmate_require_signup_email after insert on auth.users for each row execute function public.enroll_boardmate_email_verification();`);
 const sql=(await readFile(new URL('../supabase/migrations/20261113000002_remove_registration_email_otp_triggers.sql',import.meta.url),'utf8')).replace(/^begin;$/m,'').replace(/^commit;$/m,'');
 await db.exec(sql);await db.exec(sql);
 assert.deepEqual(await snapshot(),beforeRetirement);
});
