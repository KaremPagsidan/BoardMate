-- Manual, forward-only retirement of registration OTP enforcement.
-- Keep all tables, functions, enrollment history, accounts, RLS and review controls.
-- Review/apply together with approved Auth Confirm email OFF and frontend release.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
do $$
begin
  if exists(select 1 from pg_catalog.pg_trigger t
      where t.tgrelid=pg_catalog.to_regclass('public.profiles')
        and t.tgname='enforce_boardmate_email_before_review'
        and (t.tgfoid is distinct from pg_catalog.to_regprocedure('public.guard_boardmate_email_review()')
          or t.tgtype not in (21,23) or t.tgisinternal))
    or exists(select 1 from pg_catalog.pg_trigger t
      where t.tgrelid=pg_catalog.to_regclass('auth.users')
        and t.tgname='boardmate_require_signup_email'
        and (t.tgfoid is distinct from pg_catalog.to_regprocedure('public.enroll_boardmate_email_verification()')
          or t.tgtype<>5 or t.tgisinternal)) then
    raise exception 'Unexpected registration OTP trigger definitions. Review live definitions before proceeding.';
  end if;
  if not exists(select 1 from pg_catalog.pg_trigger t
      where t.tgrelid=pg_catalog.to_regclass('public.profiles')
        and t.tgname='protect_profile_verification_fields' and t.tgtype=23
        and t.tgenabled in ('O','A')
        and t.tgfoid=pg_catalog.to_regprocedure('public.protect_boardmate_verification_profile()')) then
    raise exception 'Required document/admin verification protection is missing. Do not remove other security controls.';
  end if;
end;
$$;
drop trigger if exists enforce_boardmate_email_before_review on public.profiles;
drop trigger if exists boardmate_require_signup_email on auth.users;
commit;
