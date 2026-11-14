-- REVIEW ONLY: forward migration, never auto-apply to production.
-- Requires the versioned verification workflow and existing notifications tables.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $$
begin
 if current_user <> 'postgres' then raise exception 'Run as the trusted postgres owner after review.'; end if;
 if pg_catalog.to_regprocedure('public.submit_boardmate_verification(text,text,uuid)') is null
   or pg_catalog.to_regprocedure('public.review_boardmate_verification(uuid,uuid,text,text)') is null
   or pg_catalog.to_regclass('public.boardmate_notifications') is null then
   raise exception 'Required versioned verification/notification objects are missing.';
 end if;
 if not exists(select 1 from pg_catalog.pg_trigger where tgrelid='public.profiles'::regclass
   and tgname='protect_profile_verification_fields' and tgenabled in ('O','A')
   and tgfoid='public.protect_boardmate_verification_profile()'::regprocedure) then
   raise exception 'Expected profile verification protection is missing.';
 end if;
 if (select count(*) from pg_catalog.pg_attribute where attrelid='public.boardmate_notifications'::regclass
   and attname in ('target_type','target_id') and not attisdropped)<>2 then
   raise exception 'Notification routing columns are missing.';
 end if;
 if exists(select 1 from pg_catalog.pg_class where oid in ('public.profiles'::regclass,
   'public.boardmate_verification_submissions'::regclass,'public.boardmate_notifications'::regclass) and not relrowsecurity)
   or not exists(select 1 from pg_catalog.pg_trigger where tgrelid='storage.objects'::regclass
     and tgname='protect_boardmate_verification_object' and tgenabled in ('O','A')
     and tgfoid='public.protect_boardmate_verification_object()'::regprocedure) then
   raise exception 'Required verification RLS or immutable Storage protection is missing.';
 end if;
 if exists(select 1 from public.boardmate_verification_submissions where status='pending' group by user_id having count(*)>1) then
   raise exception 'Multiple historical pending submissions require manual review. No records were changed.';
 end if;
end; $$;
-- Preserve any legacy rejection that has no versioned submission in the next revision.
alter table public.boardmate_verification_submissions add column previous_review jsonb;
create unique index boardmate_one_pending_verification on public.boardmate_verification_submissions(user_id) where status='pending';

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
      if old.verification_status <> 'not_submitted' or old.verification_revision is not null then
        raise exception 'Reviewed identity records are protected. Rejected applicants must use Edit and Resubmit Verification.';
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
    if old.verification_status not in ('not_submitted', 'rejected') then
      raise exception 'Only an initial or rejected verification can create a new revision.';
    end if;
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
create or replace function public.submit_boardmate_verification(p_id_path text, p_selfie_path text, p_expected_revision uuid)
returns public.profiles language plpgsql security definer set search_path = '' as $$
declare v_user uuid := (select auth.uid()); v_profile public.profiles%rowtype; v_revision uuid; v_path text;
begin
  if v_user is null then raise exception 'Authentication is required.'; end if;
  select * into v_profile from public.profiles where id = v_user for update;
  if not found or v_profile.suspended_at is not null then raise exception 'An active, non-suspended account is required.'; end if;
  if v_profile.verification_status <> 'not_submitted' or v_profile.verification_revision is not null
    or v_profile.id_document_path is not null or v_profile.selfie_document_path is not null or v_profile.id_uploaded or v_profile.selfie_uploaded
    or exists(select 1 from public.boardmate_verification_submissions where user_id=v_user and status='pending') then
    raise exception 'Use the rejected-account correction workflow. Pending and approved submissions cannot be replaced.';
  end if;
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

create function public.resubmit_boardmate_verification(p_id_path text,p_selfie_path text,p_expected_revision uuid,p_identity jsonb)
returns public.profiles language plpgsql security definer set search_path='' as $$
declare v_user uuid := (select auth.uid()); v_old public.profiles%rowtype; v_next public.profiles%rowtype;
 v_revision uuid; v_path text; v_previous jsonb; v_payload jsonb; v_field text; v_type oid; v_label text;
begin
 if v_user is null then raise exception 'Authentication is required.'; end if;
 select * into v_old from public.profiles where id=v_user for update;
 if not found or v_old.suspended_at is not null then raise exception 'An active, non-suspended account is required.'; end if;
 if upper(v_old.role::text) not in ('RENTER','USER','LANDLORD','OWNER') then raise exception 'A User or Owner account is required.'; end if;
 if v_old.verification_status <> 'rejected' then raise exception 'Only rejected verification can be corrected and resubmitted.'; end if;
 if v_old.verification_revision is distinct from p_expected_revision then raise exception 'Verification changed. Refresh before resubmitting.'; end if;
 if exists(select 1 from public.boardmate_verification_submissions where user_id=v_user and status='pending') then raise exception 'A pending submission already exists.'; end if;
 if v_old.verification_revision is not null and not exists(select 1 from public.boardmate_verification_submissions
   where revision=v_old.verification_revision and user_id=v_user and status='rejected') then raise exception 'Current rejected revision could not be confirmed.'; end if;
 if p_identity is null or pg_catalog.jsonb_typeof(p_identity)<>'object' or pg_catalog.octet_length(p_identity::text)>8192 then raise exception 'Provide valid correction details.'; end if;
 if exists(select 1 from pg_catalog.jsonb_object_keys(p_identity) k where k not in
 ('full_name','phone','gender','dob','business_name','address','gov_id_number','property_type')) then
   raise exception 'Email, role and protected account fields cannot be changed through resubmission.';
 end if;
 v_payload:=p_identity;
 foreach v_field in array array['gender','property_type'] loop
  if v_payload->>v_field is not null then
   select a.atttypid into v_type from pg_catalog.pg_attribute a where a.attrelid='public.profiles'::regclass and a.attname=v_field and not a.attisdropped;
   if exists(select 1 from pg_catalog.pg_type where oid=v_type and typtype='e') then
    select e.enumlabel into v_label from pg_catalog.pg_enum e where e.enumtypid=v_type and lower(e.enumlabel)=lower(v_payload->>v_field) limit 1;
    if v_label is null then raise exception 'Invalid correction value for %.',v_field; end if;
    v_payload:=pg_catalog.jsonb_set(v_payload,array[v_field],pg_catalog.to_jsonb(v_label));
   end if;
  end if;
 end loop;
 v_next := pg_catalog.jsonb_populate_record(null::public.profiles,pg_catalog.to_jsonb(v_old)||v_payload);
 if nullif(btrim(v_next.full_name),'') is null or length(v_next.full_name)>150
   or coalesce(v_next.phone,'') !~ '^[+0-9() .-]+$'
   or length(pg_catalog.regexp_replace(coalesce(v_next.phone,''),'[^0-9]','','g')) not between 7 and 15
   or nullif(btrim(v_next.gender::text),'') is null or v_next.dob is null or v_next.dob>(now() at time zone 'Asia/Manila')::date then
   raise exception 'Provide a full name, valid phone, gender and valid birth date.';
 end if;
 if upper(v_old.role::text) in ('LANDLORD','OWNER') and (
   nullif(btrim(v_next.business_name),'') is null or nullif(btrim(v_next.address),'') is null
   or nullif(btrim(v_next.gov_id_number),'') is null or nullif(btrim(v_next.property_type::text),'') is null) then
   raise exception 'Complete the required owner identity and business details.';
 end if;
 perform public.validate_boardmate_verification_documents(v_user,p_id_path,p_selfie_path);
 if p_id_path !~ ('^'||v_user::text||'/government-id-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](jpg|png|webp|pdf)$')
   or p_selfie_path !~ ('^'||v_user::text||'/selfie-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](jpg|png|webp)$')
   or public.is_boardmate_verification_path_locked(p_id_path) or public.is_boardmate_verification_path_locked(p_selfie_path) then
   raise exception 'Upload both replacement documents at new, unreferenced UUID paths.';
 end if;
 if v_old.verification_revision is null then
  v_previous:=pg_catalog.jsonb_build_object('status',v_old.verification_status,'reason',v_old.verification_reason,
    'reviewed_at',v_old.verified_at,'profile_snapshot',public.boardmate_verification_identity(pg_catalog.to_jsonb(v_old)),
    'id_document_path',v_old.id_document_path,'selfie_document_path',v_old.selfie_document_path);
 end if;
 foreach v_path in array array[p_id_path,p_selfie_path] loop
  insert into public.boardmate_verification_document_locks(path,user_id) values(v_path,v_user);
 end loop;
 insert into public.boardmate_verification_submissions(user_id,id_document_path,selfie_document_path,profile_snapshot,previous_review)
 values(v_user,p_id_path,p_selfie_path,public.boardmate_verification_identity(pg_catalog.to_jsonb(v_next)),v_previous) returning revision into v_revision;
 update public.profiles set full_name=v_next.full_name,phone=v_next.phone,gender=v_next.gender,dob=v_next.dob,
  business_name=v_next.business_name,address=v_next.address,gov_id_number=v_next.gov_id_number,property_type=v_next.property_type,
  id_document_path=p_id_path,selfie_document_path=p_selfie_path,verification_revision=v_revision,
  verification_status='pending',verification_reason=null,verified_at=null,verified_by=null where id=v_user returning * into v_next;
 return v_next;
end; $$;

-- Versioned snapshots/documents/previous decisions may never be rewritten.
create function public.protect_boardmate_verification_history() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='DELETE' then
   if (select auth.role())='service_role' then return old; end if;
   raise exception 'Verification history cannot be deleted.';
 end if;
 if (select auth.role())='service_role' and new.reviewed_by is null
   and (pg_catalog.to_jsonb(new)-'reviewed_by')=(pg_catalog.to_jsonb(old)-'reviewed_by') then return new; end if;
 if old.status<>'pending' or new.status not in ('approved','rejected')
   or not public.is_boardmate_admin() or new.reviewed_by is distinct from (select auth.uid()) or new.reviewed_at is null
   or (new.status='rejected' and nullif(btrim(new.reason),'') is null)
   or (pg_catalog.to_jsonb(new)-array['status','reason','reviewed_at','reviewed_by'])
      is distinct from (pg_catalog.to_jsonb(old)-array['status','reason','reviewed_at','reviewed_by']) then
   raise exception 'Verification history is immutable; only the pending administrator decision is allowed.';
 end if;
 return new;
end; $$;
create trigger protect_boardmate_verification_history before update or delete on public.boardmate_verification_submissions
 for each row execute function public.protect_boardmate_verification_history();

create function public.notify_boardmate_verification_decision() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 insert into public.boardmate_notifications(user_id,title,body,target_type,target_id) values(new.id,
   case when new.verification_status='approved' then 'Your account has been approved' else 'Verification corrections requested' end,
   case when new.verification_status='approved' then 'Your account is approved. You can now use verified-member features.'
   else coalesce(new.verification_reason,'Please review your verification details.') ||
     ' Reviewed ' || coalesce(pg_catalog.to_char(new.verified_at at time zone 'Asia/Manila','YYYY-MM-DD HH24:MI'),'date not recorded') ||
     ' (Philippine time). Open Account Verification Status and choose Edit and Resubmit Verification.' end,'profile',new.id::text);
 return new;
end; $$;
-- Replace only the profile-decision attachment; marketplace notification logic remains unchanged.
drop trigger if exists notify_boardmate_profile_review on public.profiles;
create trigger notify_boardmate_profile_review after update of verification_status on public.profiles for each row
 when(old.verification_status='pending' and new.verification_status in ('approved','rejected'))
 execute function public.notify_boardmate_verification_decision();

create function public.boardmate_verification_resubmission_ready() returns boolean
language sql stable security definer set search_path='' as $$
 select (select auth.uid()) is not null and public.is_boardmate_verification_storage_private();
$$;

do $$
declare f record;
begin
 for f in select p.oid::regprocedure signature from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('protect_boardmate_verification_profile','submit_boardmate_verification',
 'resubmit_boardmate_verification','protect_boardmate_verification_history','notify_boardmate_verification_decision','boardmate_verification_resubmission_ready') loop
 execute pg_catalog.format('alter function %s owner to postgres',f.signature);
 execute pg_catalog.format('revoke all on function %s from public,anon,authenticated',f.signature);
 end loop;
end; $$;
grant execute on function public.submit_boardmate_verification(text,text,uuid),
 public.resubmit_boardmate_verification(text,text,uuid,jsonb),public.boardmate_verification_resubmission_ready() to authenticated;
notify pgrst,'reload schema';
commit;
