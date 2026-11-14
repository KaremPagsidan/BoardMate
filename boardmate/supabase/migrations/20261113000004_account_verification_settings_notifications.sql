-- REVIEW ONLY: notification-only forward migration. Do not auto-apply.
-- Does not modify approval/submission RPCs, profile guards, Auth, account records or RLS.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $$
begin
 if current_user<>'postgres' then raise exception 'Run as the trusted postgres owner after review.'; end if;
 if pg_catalog.to_regclass('public.boardmate_notifications') is null
  or not exists(select 1 from pg_catalog.pg_class where oid='public.boardmate_notifications'::regclass and relrowsecurity) then
  raise exception 'Expected private notification table/RLS is missing.';
 end if;
 if (select count(*) from pg_catalog.pg_attribute where attrelid='public.boardmate_notifications'::regclass and attname in ('target_type','target_id') and not attisdropped)<>2 then
  raise exception 'Expected notification destination columns are missing.';
 end if;
 if exists(select 1 from pg_catalog.pg_trigger where tgrelid='public.profiles'::regclass and not tgisinternal
   and tgname<>'notify_boardmate_profile_review' and tgfoid in
    (pg_catalog.to_regprocedure('public.notify_boardmate_marketplace_activity()'),pg_catalog.to_regprocedure('public.notify_boardmate_verification_decision()'))) then
  raise exception 'Additional profile decision notification attachments require review before deployment.';
 end if;
 if exists(select 1 from pg_catalog.pg_trigger where tgrelid='public.profiles'::regclass and tgname='notify_boardmate_profile_review'
   and tgfoid not in (coalesce(pg_catalog.to_regprocedure('public.notify_boardmate_marketplace_activity()'),0),coalesce(pg_catalog.to_regprocedure('public.notify_boardmate_verification_decision()'),0))) then
  raise exception 'Unexpected profile notification trigger. Review instead of overwriting it.';
 end if;
end; $$;

-- Nullable metadata leaves every existing notification unchanged.
alter table public.boardmate_notifications add column verification_event_key text;
create unique index boardmate_verification_notice_event_unique on public.boardmate_notifications(verification_event_key);
create function public.protect_boardmate_verification_notice_key() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.verification_event_key is distinct from old.verification_event_key then raise exception 'Verification notification identity is immutable.'; end if;
 return new;
end; $$;
create trigger protect_boardmate_verification_notice_key before update on public.boardmate_notifications
 for each row execute function public.protect_boardmate_verification_notice_key();

create function public.notify_boardmate_verification_settings() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_decision text; v_key text;
begin
 if old.verification_status is not distinct from new.verification_status or new.verification_status not in ('approved','rejected') then return new; end if;
 v_decision:=case when new.verification_status='approved' then 'Approved' else 'Rejected / corrections requested' end;
 v_key:=new.id::text||':'||coalesce(new.verification_revision::text,'legacy:'||coalesce(new.verified_at::text,'undated'))||':'||new.verification_status;
 insert into public.boardmate_notifications(user_id,title,body,target_type,target_id,verification_event_key)
 values(new.id,'Account verification: '||v_decision,
   'Decision: '||v_decision||'. '||case when nullif(btrim(new.verification_reason),'') is not null then 'Administrator remarks: '||new.verification_reason||' ' else '' end||
   'Review date: '||coalesce(pg_catalog.to_char(new.verified_at at time zone 'Asia/Manila','YYYY-MM-DD HH24:MI'),'not recorded')||
   ' (Philippine time). Open Settings & Privacy → Account Verification.',
   'profile',new.id::text,v_key)
 on conflict(verification_event_key) do nothing;
 return new;
end; $$;
-- Replace the decision-notification attachment only. All review/security controls remain.
drop trigger if exists notify_boardmate_profile_review on public.profiles;
create trigger notify_boardmate_profile_review after update of verification_status on public.profiles for each row
 when(old.verification_status is distinct from new.verification_status and new.verification_status in ('approved','rejected'))
 execute function public.notify_boardmate_verification_settings();
alter function public.notify_boardmate_verification_settings() owner to postgres;
alter function public.protect_boardmate_verification_notice_key() owner to postgres;
revoke all on function public.notify_boardmate_verification_settings(),public.protect_boardmate_verification_notice_key() from public,anon,authenticated;
commit;
