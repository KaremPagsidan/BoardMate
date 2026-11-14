-- REVIEW-ONLY ROLLBACK SCRIPT. DO NOT AUTO-APPLY.
-- Requires separate approval and a gated signup maintenance window.
-- Restore the CONFIRMED pre-retirement trigger attachments only, using retained objects.
-- Does not recreate tables/functions, backfill enrollment, or change account records.
-- Coordinate with a compatible frontend and saved Auth settings/template.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
do $$
begin
  if pg_catalog.to_regclass('public.boardmate_email_verification_required') is null
    or pg_catalog.to_regprocedure('public.enroll_boardmate_email_verification()') is null
    or pg_catalog.to_regprocedure('public.guard_boardmate_email_review()') is null then
    raise exception 'Retained OTP objects missing. Stop; do not rerun the original migration.';
  end if;
  if not exists(select 1 from pg_catalog.pg_trigger t
    where t.tgrelid=pg_catalog.to_regclass('public.profiles')
      and t.tgname='protect_profile_verification_fields' and t.tgtype=23
      and t.tgenabled in ('O','A')
      and t.tgfoid=pg_catalog.to_regprocedure('public.protect_boardmate_verification_profile()')) then
    raise exception 'Required document/admin protection differs. Stop for review.';
  end if;
  if not exists(select 1 from pg_catalog.pg_trigger t
    where t.tgrelid=pg_catalog.to_regclass('auth.users')
      and t.tgname='on_auth_user_created_boardmate_profile' and t.tgtype=5
      and t.tgenabled in ('O','A')
      and t.tgfoid=pg_catalog.to_regprocedure('public.handle_new_boardmate_user()')) then
    raise exception 'Required Auth profile creation differs. Stop for review.';
  end if;
  if exists(select 1 from pg_catalog.pg_trigger t
    where t.tgrelid=pg_catalog.to_regclass('auth.users') and t.tgname='boardmate_require_signup_email') then
    if not exists(select 1 from pg_catalog.pg_trigger t
      where t.tgrelid=pg_catalog.to_regclass('auth.users') and t.tgname='boardmate_require_signup_email'
        and t.tgtype=5 and t.tgenabled='O' and not t.tgisinternal and t.tgconstraint=0
        and t.tgnargs=0 and t.tgqual is null
        and t.tgfoid=pg_catalog.to_regprocedure('public.enroll_boardmate_email_verification()')) then
      raise exception 'Existing enrollment trigger differs. Stop rather than overwrite it.';
    end if;
  else
    create trigger boardmate_require_signup_email after insert on auth.users
      for each row execute function public.enroll_boardmate_email_verification();
  end if;
  if exists(select 1 from pg_catalog.pg_trigger t
    where t.tgrelid=pg_catalog.to_regclass('public.profiles') and t.tgname='enforce_boardmate_email_before_review') then
    if not exists(select 1 from pg_catalog.pg_trigger t
      where t.tgrelid=pg_catalog.to_regclass('public.profiles') and t.tgname='enforce_boardmate_email_before_review'
        and t.tgtype=21 and t.tgenabled='O' and not t.tgisinternal and t.tgconstraint=0
        and t.tgnargs=0 and t.tgqual is null and t.tgattr=''::pg_catalog.int2vector
        and t.tgoldtable is null and t.tgnewtable is null
        and t.tgfoid=pg_catalog.to_regprocedure('public.guard_boardmate_email_review()')) then
      raise exception 'Existing profile email guard differs. Stop rather than overwrite it.';
    end if;
  else
    -- Preserve the corrected AFTER form. Do not restore the old BEFORE ordering bug.
    create trigger enforce_boardmate_email_before_review after insert or update on public.profiles
      for each row execute function public.guard_boardmate_email_review();
  end if;
end;
$$;
commit;
