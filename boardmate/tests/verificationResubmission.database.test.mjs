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
  await db.exec(`create table public.boardmate_notifications(id bigint generated always as identity primary key,user_id uuid references auth.users(id) on delete cascade,title text,body text,target_type text,target_id text,created_at timestamptz default now());
    alter table public.boardmate_notifications enable row level security;
    grant select on public.boardmate_notifications to authenticated;
    create policy member_notices on public.boardmate_notifications for select to authenticated using(user_id=auth.uid());`);
  await db.exec(await readFile(new URL('../supabase/migrations/20261113000003_verification_resubmission.sql',import.meta.url),'utf8'));

});

beforeEach(async()=>{await db.exec('begin');});
afterEach(async()=>{await db.exec('rollback');});
after(async()=>{await db.close();});
const identity={full_name:'Corrected Applicant',phone:'09123456789',gender:'Female',dob:'2000-01-01',business_name:'BoardMate House',address:'Manila',gov_id_number:'ID-1234',property_type:'Apartment'};
async function resubmit(revision,idPath,selfiePath,corrections=identity){return (await db.query('select * from public.resubmit_boardmate_verification($1,$2,$3,$4)',[idPath,selfiePath,revision,corrections])).rows[0];}
async function rejected(){const first=await firstSubmission();await actor(admin);await review(member,first.profile.verification_revision,'rejected','Correct the birth date and replace the unreadable ID.');return first;}
async function replacements(){await actor(member);return [await upload(member,'government-id'),await upload(member,'selfie')];}

for(const role of ['RENTER','LANDLORD'])test(`${role}: rejection, correction, immutable history, pending notification, and approval`,async()=>{
 await db.query('update profiles set role=$1 where id=$2',[role,member]);
 const first=await rejected();
 await db.exec('reset role');
 const original=(await db.query('select to_jsonb(s) as row from boardmate_verification_submissions s where revision=$1',[first.profile.verification_revision])).rows[0].row;
 assert.match((await db.query('select body from boardmate_notifications where user_id=$1',[member])).rows[0].body,/Correct the birth date.*Reviewed.*Edit and Resubmit/);
 const [id,selfie]=await replacements();
 await expectFailure(()=>db.query("update profiles set full_name='Bypass' where id=$1",[member]),/Edit and Resubmit/);
 const pending=await resubmit(first.profile.verification_revision,id,selfie);
 assert.equal(pending.verification_status,'pending');assert.equal(pending.full_name,identity.full_name);assert.equal(pending.role,role);assert.notEqual(pending.verification_revision,first.profile.verification_revision);
 await expectFailure(()=>resubmit(first.profile.verification_revision,id,selfie),/Only rejected/);
 await db.exec('reset role');
 assert.deepEqual((await db.query('select to_jsonb(s) as row from boardmate_verification_submissions s where revision=$1',[first.profile.verification_revision])).rows[0].row,original);
 assert.equal((await db.query("select count(*)::int n from boardmate_verification_submissions where user_id=$1 and status='pending'",[member])).rows[0].n,1);
 assert.equal((await db.query("select count(*)::int n from admin_review_notifications where source_id=$1 and read_at is null",[member])).rows[0].n,1);
 await actor(member);assert.equal((await db.query('delete from storage.objects where name=$1 returning name',[first.idPath])).rows.length,0);
 await db.exec('reset role');await expectFailure(()=>db.query('delete from storage.objects where name=$1',[first.idPath]),/immutable|referenced|submitted/i);
 assert.equal((await db.query('select count(*)::int n from storage.objects where name=$1',[first.idPath])).rows[0].n,1);
 await actor(admin);assert.equal((await review(member,pending.verification_revision)).verification_status,'approved');
 await expectFailure(()=>review(member,first.profile.verification_revision),/Stale/);
 await actor(member);await expectFailure(()=>resubmit(pending.verification_revision,id,selfie),/Only rejected/);
 await expectFailure(()=>db.query("update profiles set full_name='Approved tamper' where id=$1",[member]),/protected/);
});

test('pending and approved cannot replace documents through the original RPC',async()=>{
 const first=await firstSubmission();const [id,selfie]=[await upload(),await upload(member,'selfie')];
 await expectFailure(()=>submit(id,selfie,first.profile.verification_revision),/Pending and approved/);
 await actor(admin);await review(member,first.profile.verification_revision);await actor(member);
 await expectFailure(()=>submit(id,selfie,first.profile.verification_revision),/Pending and approved/);
});

test('correction rejects role/email injection, stale revisions, invalid identity, reused and foreign paths',async()=>{
 const first=await rejected();const [id,selfie]=await replacements();
 for(const fields of [{...identity,role:'ADMIN'},{...identity,email:'other@example.com'},{...identity,verification_status:'approved'},{...identity,full_name:''},{...identity,dob:'2999-01-01'}])await expectFailure(()=>resubmit(first.profile.verification_revision,id,selfie,fields),/cannot be changed|Provide a full name/);
 await expectFailure(()=>resubmit(randomUUID(),id,selfie),/Verification changed/);
 await expectFailure(()=>resubmit(first.profile.verification_revision,first.idPath,selfie),/new, unreferenced/);
 await expectFailure(()=>resubmit(first.profile.verification_revision,`${other}/fake.png`,selfie),/owner folder/);
 await expectFailure(()=>review(member,first.profile.verification_revision),/Administrator/);
});

test('history and previous remarks cannot be edited even by administrators; unrelated reads are denied',async()=>{
 const first=await rejected();await db.exec('reset role');
 await db.exec('grant update,delete on boardmate_verification_submissions to authenticated;create policy broad_history on boardmate_verification_submissions for all to authenticated using(true) with check(true)');
 await actor(admin);await expectFailure(()=>db.query("update boardmate_verification_submissions set reason='rewrite' where revision=$1",[first.profile.verification_revision]),/immutable/);
 await expectFailure(()=>db.query('delete from boardmate_verification_submissions where revision=$1',[first.profile.verification_revision]),/cannot be deleted/);
 await db.exec('reset role');await db.exec('drop policy broad_history on boardmate_verification_submissions');
 await actor(other);assert.equal((await db.query('select * from boardmate_verification_submissions where user_id=$1',[member])).rows.length,0);
 assert.equal((await db.query('select * from boardmate_notifications where user_id=$1',[member])).rows.length,0);
});

test('suspended applicants cannot resubmit; notification failure rolls back identity, new revision and path locks',async()=>{
 const first=await rejected();const [id,selfie]=await replacements();await actor(admin);
 await db.query('update profiles set suspended_at=now() where id=$1',[member]);await actor(member);
 await expectFailure(()=>resubmit(first.profile.verification_revision,id,selfie),/non-suspended/);
 await actor(admin);await db.query('update profiles set suspended_at=null where id=$1',[member]);await db.exec('reset role');
 await db.exec(`create function public.test_reject_notice() returns trigger language plpgsql as $$begin raise exception 'test notification failure';end;$$;create trigger test_reject_notice before insert or update on admin_review_notifications for each row execute function public.test_reject_notice();`);
 await actor(member);await expectFailure(()=>resubmit(first.profile.verification_revision,id,selfie),/test notification failure/);
 await db.exec('reset role');assert.equal((await db.query('select count(*)::int n from boardmate_verification_submissions where user_id=$1',[member])).rows[0].n,1);
 assert.equal((await db.query('select verification_status from profiles where id=$1',[member])).rows[0].verification_status,'rejected');
 assert.equal((await db.query('select count(*)::int n from boardmate_verification_document_locks where path=$1',[id])).rows[0].n,0);
});

test('legacy rejection is archived without inventing a submission date; deployment preserves existing profiles',async()=>{
 await actor(legacyRejected);const id=await upload(legacyRejected),selfie=await upload(legacyRejected,'selfie');
 const pending=(await db.query('select * from public.resubmit_boardmate_verification($1,$2,null,$3)',[id,selfie,identity])).rows[0];
 const prior=(await db.query('select previous_review from boardmate_verification_submissions where revision=$1',[pending.verification_revision])).rows[0].previous_review;
 assert.equal(prior.reason,'Legacy rejection');assert.equal(prior.status,'rejected');assert.equal(prior.reviewed_at,null);
 await db.exec('reset role');
 for(const original of originalProfiles.filter(p=>p.id!==legacyRejected)){
  const current=(await db.query("select to_jsonb(p)-'verification_revision' as row from profiles p where id=$1",[original.id])).rows[0].row;
  assert.deepEqual(current,original);
 }
});

test('approved history is immutable and a second pending submission is rejected by the database index',async()=>{
 const first=await firstSubmission();await db.exec('reset role');
 await expectFailure(()=>db.query(`insert into boardmate_verification_submissions(user_id,id_document_path,selfie_document_path,profile_snapshot) select user_id,id_document_path,selfie_document_path,profile_snapshot from boardmate_verification_submissions where revision=$1`,[first.profile.verification_revision]),/unique|duplicate/i);
 await actor(admin);await review(member,first.profile.verification_revision);await db.exec('reset role');
 await expectFailure(()=>db.query("update boardmate_verification_submissions set reason='changed approved record' where revision=$1",[first.profile.verification_revision]),/immutable/);
});
test('second rejection and correction preserve all prior remarks; approved records remain sealed',async()=>{
 const first=await rejected();const [id,selfie]=await replacements();const next=await resubmit(first.profile.verification_revision,id,selfie);
 await actor(admin);await review(member,next.verification_revision,'rejected','Replace the selfie with a clearer image.');
 const paths=await replacements();const final=await resubmit(next.verification_revision,...paths);
 await db.exec('reset role');const rows=(await db.query('select status,reason from boardmate_verification_submissions where user_id=$1 order by submitted_at,revision',[member])).rows;
 assert.equal(rows.length,3);assert.ok(rows.some(row=>row.reason==='Correct the birth date and replace the unreadable ID.'));assert.ok(rows.some(row=>row.reason==='Replace the selfie with a clearer image.'));
 assert.equal(rows.filter(row=>row.status==='pending').length,1);
 await actor(admin);await review(member,final.verification_revision);
 assert.equal((await db.query('select count(*)::int n from boardmate_notifications where user_id=$1',[member])).rows[0].n,0); // RLS keeps applicant notices private even from admins without a notice policy.
});
