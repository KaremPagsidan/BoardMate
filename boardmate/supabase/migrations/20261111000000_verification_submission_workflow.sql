-- REVIEW DRAFT: replaces the earlier UNAPPLIED 20261111 draft. If that draft
-- was deployed elsewhere, prepare a separate forward migration instead.
-- No production execution is authorized. Requires all preceding migrations.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if current_user <> 'postgres' then
    raise exception 'Run reviewed migration as trusted postgres owner.';
  end if;
  if pg_catalog.to_regclass('public.admin_memberships') is null
    or pg_catalog.to_regclass('public.admin_review_notifications') is null
    or pg_catalog.to_regprocedure('public.is_boardmate_admin()') is null then
    raise exception 'Required BoardMate account and notification migrations are missing.';
  end if;
  if not exists (select 1 from pg_catalog.pg_attribute
      where attrelid = 'public.profiles'::regclass and attname = 'verification_status'
        and atttypid = 'text'::regtype and not attisdropped) then
    raise exception 'Expected profiles.verification_status text; inspect schema drift first.';
  end if;
  if exists (select 1 from pg_catalog.pg_constraint c where c.conrelid = 'public.profiles'::regclass
      and c.contype = 'c' and c.conname <> 'profiles_verification_status_check'
      and (select attnum from pg_catalog.pg_attribute where attrelid = c.conrelid and attname = 'verification_status') = any(c.conkey)) then
    raise exception 'Unexpected additional verification-status constraint; review schema drift before migration.';
  end if;
  if not exists (select 1 from pg_catalog.pg_trigger where tgrelid = 'public.profiles'::regclass
      and tgname = 'protect_boardmate_suspension_fields' and tgenabled in ('O', 'A')) then
    raise exception 'Required profile suspension protection is missing or disabled.';
  end if;
  if not (select relrowsecurity from pg_catalog.pg_class where oid = 'public.profiles'::regclass)
    or not (select relrowsecurity from pg_catalog.pg_class where oid = 'storage.objects'::regclass)
    or not (select relrowsecurity from pg_catalog.pg_class where oid = 'public.admin_memberships'::regclass) then
    raise exception 'Profile, Storage, and admin-membership RLS must already be enabled.';
  end if;
  if pg_catalog.has_column_privilege('authenticated', 'public.admin_memberships', 'user_id', 'INSERT')
    or pg_catalog.has_column_privilege('authenticated', 'public.admin_memberships', 'user_id', 'UPDATE')
    or pg_catalog.has_table_privilege('authenticated', 'public.admin_memberships', 'DELETE')
    or pg_catalog.has_column_privilege('anon', 'public.admin_memberships', 'user_id', 'INSERT')
    or pg_catalog.has_column_privilege('anon', 'public.admin_memberships', 'user_id', 'UPDATE')
    or pg_catalog.has_table_privilege('anon', 'public.admin_memberships', 'DELETE') then
    raise exception 'Admin membership grants are unsafe; inspect schema drift before migration.';
  end if;
  if not exists (select 1 from pg_catalog.pg_proc where oid = 'public.is_boardmate_admin()'::regprocedure
      and proowner = 'postgres'::regrole and prosecdef and 'search_path=""' = any(proconfig)) then
    raise exception 'Admin authorization function must have trusted ownership and an empty search path.';
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conrelid = 'public.admin_review_notifications'::regclass
      and contype = 'u' and pg_catalog.pg_get_constraintdef(oid) = 'UNIQUE (notification_key)') then
    raise exception 'Expected unique notification_key constraint is missing.';
  end if;
  if not exists (select 1 from storage.buckets where id = 'verification-documents' and public = false
      and file_size_limit is not null and file_size_limit between 1 and 10485760) then
    raise exception 'Existing verification-documents bucket must already be private with a 10 MB or smaller nonzero size limit.';
  end if;
end;
$$;

alter table public.profiles drop constraint if exists profiles_verification_status_check;
alter table public.profiles add constraint profiles_verification_status_check
  check (verification_status in ('not_submitted', 'pending', 'approved', 'rejected'));
alter table public.profiles alter column verification_status set default 'not_submitted';
alter table public.profiles add column if not exists verification_revision uuid;
create index if not exists profiles_verification_id_path_idx on public.profiles(id_document_path) where id_document_path is not null;
create index if not exists profiles_verification_selfie_path_idx on public.profiles(selfie_document_path) where selfie_document_path is not null;

create table if not exists public.boardmate_verification_document_locks (
  path text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  locked_at timestamptz not null default pg_catalog.now()
);
create table if not exists public.boardmate_verification_submissions (
  revision uuid primary key default pg_catalog.gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  id_document_path text not null,
  selfie_document_path text not null,
  profile_snapshot jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  submitted_at timestamptz not null default pg_catalog.now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  reason text
);
create index if not exists boardmate_verification_submissions_user_idx
  on public.boardmate_verification_submissions(user_id, submitted_at desc);
alter table public.boardmate_verification_document_locks enable row level security;
alter table public.boardmate_verification_submissions enable row level security;
revoke all on public.boardmate_verification_document_locks, public.boardmate_verification_submissions from public, anon, authenticated;
grant select on public.boardmate_verification_document_locks, public.boardmate_verification_submissions to authenticated;
drop policy if exists verification_locks_read on public.boardmate_verification_document_locks;
create policy verification_locks_read on public.boardmate_verification_document_locks for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_boardmate_admin()));
drop policy if exists verification_submissions_read on public.boardmate_verification_submissions;
create policy verification_submissions_read on public.boardmate_verification_submissions for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_boardmate_admin()));

-- Freeze existing references without changing ANY profile status, revision,
-- flags, timestamps, or review reasons. Missing/malformed references are kept
-- as tombstones as well. No legacy account is automatically reclassified.
insert into public.boardmate_verification_document_locks(path, user_id)
select path, min(user_id::text)::uuid from (
  select id_document_path as path, id as user_id from public.profiles where id_document_path is not null
  union all
  select selfie_document_path, id from public.profiles where selfie_document_path is not null
) refs group by path on conflict (path) do nothing;

create or replace function public.is_boardmate_verification_storage_private()
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and exists (
    select 1 from storage.buckets where id = 'verification-documents' and public = false
      and file_size_limit is not null and file_size_limit between 1 and 10485760
  );
$$;

create or replace function public.boardmate_verification_identity(p_profile jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select pg_catalog.jsonb_build_object(
    'full_name', p_profile->'full_name', 'email', p_profile->'email', 'phone', p_profile->'phone',
    'role', p_profile->'role', 'gender', p_profile->'gender', 'dob', p_profile->'dob',
    'business_name', p_profile->'business_name', 'address', p_profile->'address',
    'gov_id_number', p_profile->'gov_id_number', 'property_type', p_profile->'property_type');
$$;

-- Serialize submission and Storage mutation by path. All path locks are taken
-- in sorted order. The Storage trigger checks the registry AFTER acquiring the
-- same advisory lock; no profile-row locks are acquired by Storage mutations.
create or replace function public.lock_boardmate_verification_paths(p_paths text[])
returns void language plpgsql security definer set search_path = '' as $$
declare v_path text;
begin
  foreach v_path in array (select pg_catalog.array_agg(distinct p order by p) from pg_catalog.unnest(p_paths) p where p is not null)
  loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('boardmate-verification:' || v_path, 0));
  end loop;
end;
$$;

create or replace function public.validate_boardmate_verification_documents(p_user_id uuid, p_id_path text, p_selfie_path text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_id_path is null or p_selfie_path is null or p_id_path = p_selfie_path
    or pg_catalog.split_part(p_id_path, '/', 1) <> p_user_id::text
    or pg_catalog.split_part(p_selfie_path, '/', 1) <> p_user_id::text then
    raise exception 'Submit separate ID and selfie documents in the account owner folder.';
  end if;
  perform public.lock_boardmate_verification_paths(array[p_id_path, p_selfie_path]);
  if not exists (select 1 from storage.buckets where id = 'verification-documents' and public = false
      and file_size_limit is not null and file_size_limit between 1 and 10485760) then
    raise exception 'Private verification storage with a 10 MB or smaller limit is required.';
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'verification-documents' and name = p_id_path
      and metadata->>'mimetype' in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')
      and case when metadata->>'size' ~ '^[0-9]+$' then (metadata->>'size')::numeric else 0 end between 1 and 10485760)
    or not exists (select 1 from storage.objects where bucket_id = 'verification-documents' and name = p_selfie_path
      and metadata->>'mimetype' in ('image/jpeg', 'image/png', 'image/webp')
      and case when metadata->>'size' ~ '^[0-9]+$' then (metadata->>'size')::numeric else 0 end between 1 and 10485760) then
    raise exception 'Both documents must exist with supported MIME types and nonempty size at most 10 MB. Replace any invalid legacy document.';
  end if;
end;
$$;

create or replace function public.is_boardmate_verification_path_locked(p_path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.boardmate_verification_document_locks where path = p_path)
    or exists (select 1 from public.profiles where id_document_path = p_path or selfie_document_path = p_path);
$$;

create or replace function public.can_read_boardmate_verification_path(p_path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and
    (pg_catalog.split_part(p_path, '/', 1) = (select auth.uid())::text or public.is_boardmate_admin());
$$;
create or replace function public.can_write_boardmate_verification_path(p_path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select pg_catalog.split_part(p_path, '/', 1) = (select auth.uid())::text and exists (
    select 1 from public.profiles where id = (select auth.uid()) and suspended_at is null
  );
$$;

-- RESTRICTIVE policies constrain even other permissive policies. Other buckets
-- are unaffected. These are DRAFT changes; do not apply to live Storage without review.
drop policy if exists verification_private_reads on storage.objects;
create policy verification_private_reads on storage.objects as restrictive for select to public
  using (bucket_id <> 'verification-documents' or
    public.can_read_boardmate_verification_path(name));
drop policy if exists verification_owned_inserts on storage.objects;
create policy verification_owned_inserts on storage.objects as restrictive for insert to public
  with check (bucket_id <> 'verification-documents' or
    (public.can_write_boardmate_verification_path(name)
      and not public.is_boardmate_verification_path_locked(name)));
drop policy if exists verification_immutable_updates on storage.objects;
create policy verification_immutable_updates on storage.objects as restrictive for update to public
  using (bucket_id <> 'verification-documents' or
    (public.can_write_boardmate_verification_path(name) and not public.is_boardmate_verification_path_locked(name)))
  with check (bucket_id <> 'verification-documents' or
    (public.can_write_boardmate_verification_path(name) and not public.is_boardmate_verification_path_locked(name)));
drop policy if exists verification_referenced_deletes on storage.objects;
create policy verification_referenced_deletes on storage.objects as restrictive for delete to public
  using (bucket_id <> 'verification-documents' or
    (public.can_write_boardmate_verification_path(name) and not public.is_boardmate_verification_path_locked(name)));

create or replace function public.protect_boardmate_verification_object()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_old text; v_new text;
begin
  -- The existing scheduled purge uses a trusted service-role client. Ordinary
  -- admins deliberately do NOT receive this Storage deletion exception.
  if (select auth.role()) = 'service_role' then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  if tg_op <> 'INSERT' and old.bucket_id = 'verification-documents' then v_old := old.name; end if;
  if tg_op <> 'DELETE' and new.bucket_id = 'verification-documents' then v_new := new.name; end if;
  if v_old is not null or v_new is not null then
    perform public.lock_boardmate_verification_paths(array[v_old, v_new]);
    if public.is_boardmate_verification_path_locked(v_old) or public.is_boardmate_verification_path_locked(v_new) then
      raise exception 'Submitted verification documents are immutable. Upload a replacement at a new unique path.';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;
drop trigger if exists protect_boardmate_verification_object on storage.objects;
create trigger protect_boardmate_verification_object before insert or update or delete on storage.objects
  for each row execute function public.protect_boardmate_verification_object();

-- Replace only the PROFILE trigger; keep the shared listing/roommate review
-- function unchanged. Column ACLs below route protected writes through RPCs.
create or replace function public.protect_boardmate_verification_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_identity_changed boolean; v_protected_changed boolean; v_submission public.boardmate_verification_submissions%rowtype;
begin
  if tg_op = 'INSERT' then
    new.verification_status := 'not_submitted'; new.verification_revision := null;
    new.id_document_path := null; new.selfie_document_path := null;
    new.id_uploaded := false; new.selfie_uploaded := false;
    new.verification_reason := null; new.verified_at := null; new.verified_by := null;
    return new;
  end if;
  if new.id is distinct from old.id or (new.created_at is distinct from old.created_at and not public.is_boardmate_admin()) then
    raise exception 'Profile identity and registration time cannot be changed.';
  end if;
  -- Trusted account deletion can clear a deleted reviewer's FK without
  -- rewriting the decision/revision or breaking the existing purge worker.
  if (select auth.role()) = 'service_role' and new.verified_by is null
    and (pg_catalog.to_jsonb(new) - 'verified_by') = (pg_catalog.to_jsonb(old) - 'verified_by') then
    return new;
  end if;
  v_identity_changed := public.boardmate_verification_identity(pg_catalog.to_jsonb(new)) is distinct from public.boardmate_verification_identity(pg_catalog.to_jsonb(old));
  v_protected_changed := row(new.verification_revision, new.verification_status, new.verification_reason, new.verified_at, new.verified_by,
      new.id_document_path, new.selfie_document_path, new.id_uploaded, new.selfie_uploaded)
    is distinct from row(old.verification_revision, old.verification_status, old.verification_reason, old.verified_at, old.verified_by,
      old.id_document_path, old.selfie_document_path, old.id_uploaded, old.selfie_uploaded);
  if not v_protected_changed then
    if v_identity_changed then
      if old.verification_revision is null then
        if old.verification_status = 'approved' then
          raise exception 'Legacy approved identity details are protected. Submit verification documents before editing these details; your existing approval has not changed.';
        end if;
        -- Legacy pending/rejected profiles retain their exact status and reason.
      else
        perform public.validate_boardmate_verification_documents(new.id, old.id_document_path, old.selfie_document_path);
        insert into public.boardmate_verification_submissions(user_id, id_document_path, selfie_document_path, profile_snapshot)
          values (new.id, old.id_document_path, old.selfie_document_path, public.boardmate_verification_identity(pg_catalog.to_jsonb(new)))
          returning * into v_submission;
        new.verification_revision := v_submission.revision; new.verification_status := 'pending';
        new.verification_reason := null; new.verified_at := null; new.verified_by := null;
      end if;
    end if;
    return new;
  end if;
  select * into v_submission from public.boardmate_verification_submissions
    where revision = new.verification_revision and user_id = new.id;
  if not found or v_submission.id_document_path is distinct from new.id_document_path
    or v_submission.selfie_document_path is distinct from new.selfie_document_path
    or v_submission.profile_snapshot is distinct from public.boardmate_verification_identity(pg_catalog.to_jsonb(new))
    or v_submission.status is distinct from new.verification_status then
    raise exception 'Use the versioned verification submission/review RPCs.';
  end if;
  if new.verification_revision is distinct from old.verification_revision then
    if new.verification_status <> 'pending' or v_submission.reviewed_at is not null then
      raise exception 'A new submission must begin pending review.';
    end if;
  elsif old.verification_status <> 'pending' or new.verification_status not in ('approved', 'rejected')
    or not public.is_boardmate_admin() or v_submission.reviewed_by is distinct from (select auth.uid()) then
    raise exception 'Only an authorized versioned review can change this decision.';
  end if;
  new.id_uploaded := true; new.selfie_uploaded := true;
  new.verification_reason := v_submission.reason; new.verified_at := v_submission.reviewed_at; new.verified_by := v_submission.reviewed_by;
  return new;
end;
$$;
drop trigger if exists zz_require_boardmate_verification_submission on public.profiles;
drop trigger if exists protect_profile_verification_fields on public.profiles;
create trigger protect_profile_verification_fields before insert or update on public.profiles
  for each row execute function public.protect_boardmate_verification_profile();
drop function if exists public.require_boardmate_verification_submission();

create or replace function public.submit_boardmate_verification(p_id_path text, p_selfie_path text, p_expected_revision uuid)
returns public.profiles language plpgsql security definer set search_path = '' as $$
declare v_user uuid := (select auth.uid()); v_profile public.profiles%rowtype; v_revision uuid; v_path text;
begin
  if v_user is null then raise exception 'Authentication is required.'; end if;
  select * into v_profile from public.profiles where id = v_user for update;
  if not found or v_profile.suspended_at is not null then raise exception 'An active, non-suspended account is required.'; end if;
  if v_profile.verification_revision is distinct from p_expected_revision then
    raise exception 'Verification changed. Refresh and retry with the current submission.';
  end if;
  if p_id_path is not distinct from v_profile.id_document_path and p_selfie_path is not distinct from v_profile.selfie_document_path then
    raise exception 'Upload at least one replacement document at a new unique path.';
  end if;
  perform public.validate_boardmate_verification_documents(v_user, p_id_path, p_selfie_path);
  if p_id_path is distinct from v_profile.id_document_path then
    if exists (select 1 from public.boardmate_verification_document_locks where path = p_id_path)
      or p_id_path !~ ('^' || v_user::text || '/government-id-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](jpg|png|webp|pdf)$') then
      raise exception 'Replacement ID requires a new unique UUID storage path.';
    end if;
  end if;
  if p_selfie_path is distinct from v_profile.selfie_document_path then
    if exists (select 1 from public.boardmate_verification_document_locks where path = p_selfie_path)
      or p_selfie_path !~ ('^' || v_user::text || '/selfie-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](jpg|png|webp)$') then
      raise exception 'Replacement selfie requires a new unique UUID storage path.';
    end if;
  end if;
  foreach v_path in array array[p_id_path, p_selfie_path] loop
    insert into public.boardmate_verification_document_locks(path, user_id) values (v_path, v_user) on conflict (path) do nothing;
  end loop;
  insert into public.boardmate_verification_submissions(user_id, id_document_path, selfie_document_path, profile_snapshot)
    values (v_user, p_id_path, p_selfie_path, public.boardmate_verification_identity(pg_catalog.to_jsonb(v_profile))) returning revision into v_revision;
  update public.profiles set id_document_path = p_id_path, selfie_document_path = p_selfie_path,
    verification_revision = v_revision, verification_status = 'pending', verification_reason = null,
    verified_at = null, verified_by = null where id = v_user returning * into v_profile;
  return v_profile;
end;
$$;

create or replace function public.review_boardmate_verification(p_user_id uuid, p_revision uuid, p_status text, p_reason text default null)
returns public.profiles language plpgsql security definer set search_path = '' as $$
declare v_profile public.profiles%rowtype; v_submission public.boardmate_verification_submissions%rowtype;
begin
  if (select auth.uid()) is null or not public.is_boardmate_admin() then raise exception 'Administrator authorization is required.'; end if;
  if p_status not in ('approved', 'rejected') or p_status is null then raise exception 'Choose approved or rejected.'; end if;
  if p_status = 'rejected' and nullif(pg_catalog.btrim(p_reason), '') is null then raise exception 'A rejection reason is required.'; end if;
  select * into v_profile from public.profiles where id = p_user_id for update;
  if not found or p_revision is null or v_profile.verification_revision is distinct from p_revision or v_profile.verification_status <> 'pending' then
    raise exception 'Stale verification review. Refresh and inspect the current submission before deciding.';
  end if;
  select * into v_submission from public.boardmate_verification_submissions
    where revision = p_revision and user_id = p_user_id and status = 'pending' for update;
  if not found then raise exception 'Stale verification review.'; end if;
  if p_status = 'approved' then
    perform public.validate_boardmate_verification_documents(p_user_id, v_submission.id_document_path, v_submission.selfie_document_path);
  end if;
  update public.boardmate_verification_submissions set status = p_status, reason = nullif(pg_catalog.btrim(p_reason), ''),
    reviewed_at = pg_catalog.now(), reviewed_by = (select auth.uid()) where revision = p_revision returning * into v_submission;
  update public.profiles set verification_status = p_status, verification_reason = v_submission.reason,
    verified_at = v_submission.reviewed_at, verified_by = v_submission.reviewed_by
    where id = p_user_id returning * into v_profile;
  return v_profile;
end;
$$;

-- Preserve previously granted ordinary profile-column updates, while removing
-- table-wide/column-specific access to protected fields. RLS remains in force.
do $$
declare v_column record; v_allowed text[];
begin
  select pg_catalog.array_agg(attname) into v_allowed from pg_catalog.pg_attribute
    where attrelid = 'public.profiles'::regclass and attnum > 0 and not attisdropped
      and pg_catalog.has_column_privilege('authenticated', 'public.profiles', attname, 'UPDATE');
  revoke update on public.profiles from public, anon, authenticated;
  for v_column in select attname from pg_catalog.pg_attribute where attrelid = 'public.profiles'::regclass and attnum > 0 and not attisdropped loop
    execute pg_catalog.format('revoke update (%I) on public.profiles from public, anon, authenticated', v_column.attname);
    if v_column.attname = any(v_allowed) and v_column.attname not in (
      'verification_status', 'verification_reason', 'verified_at', 'verified_by', 'id_uploaded', 'selfie_uploaded',
      'id_document_path', 'selfie_document_path', 'verification_revision') then
      execute pg_catalog.format('grant update (%I) on public.profiles to authenticated', v_column.attname);
    end if;
  end loop;
end;
$$;

-- Retire stale legacy queue notices without deleting their history or
-- touching any account status. A later explicit submission reopens this key.
update public.admin_review_notifications notice
set read_at = pg_catalog.now(), title = 'Legacy verification status retained',
  detail = 'Existing account status is unchanged. A new document submission is required before another review.'
from public.profiles profile
where notice.notification_key = 'profiles:' || profile.id::text
  and profile.verification_revision is null and profile.verification_status = 'pending'
  and notice.read_at is null;

create or replace function public.notify_boardmate_verification_submission()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.admin_review_notifications(notification_key, title, detail, destination_tab, icon, source_type, source_id, created_at)
  values ('profiles:' || new.id::text, 'User verification needs review',
    coalesce(nullif(new.full_name, ''), 'BoardMate member') || ' submitted verification for review.',
    'verifications', 'ID', 'profile', new.id::text, pg_catalog.now())
  on conflict (notification_key) do update set title = excluded.title, detail = excluded.detail,
    created_at = excluded.created_at, read_at = null, hidden_until = null;
  return new;
end;
$$;
drop trigger if exists enqueue_profile_review_notification on public.profiles;
drop trigger if exists notify_boardmate_verification_submission on public.profiles;
create trigger notify_boardmate_verification_submission after update on public.profiles for each row
  when (new.verification_revision is not null and new.verification_revision is distinct from old.verification_revision and new.verification_status = 'pending')
  execute function public.notify_boardmate_verification_submission();
drop trigger if exists mark_profile_review_notification_read on public.profiles;
create trigger mark_profile_review_notification_read after update of verification_status on public.profiles for each row
  when (old.verification_status = 'pending' and new.verification_status in ('approved', 'rejected'))
  execute function public.mark_admin_review_notification_reviewed();

-- Explicit trusted ownership, empty paths, private helper privileges, and a
-- narrow public RPC surface. Existing admin membership/suspension protections remain.
do $$
declare v_function record;
begin
  for v_function in select p.oid::regprocedure as signature from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'is_boardmate_verification_storage_private', 'boardmate_verification_identity', 'lock_boardmate_verification_paths',
      'can_read_boardmate_verification_path', 'can_write_boardmate_verification_path',
      'validate_boardmate_verification_documents', 'is_boardmate_verification_path_locked', 'protect_boardmate_verification_object',
      'protect_boardmate_verification_profile', 'submit_boardmate_verification', 'review_boardmate_verification', 'notify_boardmate_verification_submission')
  loop
    execute pg_catalog.format('alter function %s owner to postgres', v_function.signature);
    execute pg_catalog.format('revoke all on function %s from public, anon, authenticated', v_function.signature);
  end loop;
end;
$$;
grant execute on function public.is_boardmate_verification_storage_private(), public.is_boardmate_verification_path_locked(text),
  public.submit_boardmate_verification(text, text, uuid), public.review_boardmate_verification(uuid, uuid, text, text) to authenticated;
-- Restrictive SELECT policies may also run for anon under permissive drift.
grant execute on function public.is_boardmate_verification_path_locked(text),
  public.can_read_boardmate_verification_path(text), public.can_write_boardmate_verification_path(text) to authenticated, anon;
notify pgrst, 'reload schema';
commit;
