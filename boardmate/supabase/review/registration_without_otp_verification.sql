-- READ ONLY, before and after manual migration. Does not inspect SMTP secrets.
select n.nspname as schema_name,c.relname as table_name,t.tgname,t.tgenabled,
       pg_catalog.pg_get_triggerdef(t.oid,true) as definition,
       pg_catalog.pg_get_functiondef(t.tgfoid) as function_definition
from pg_catalog.pg_trigger t
join pg_catalog.pg_class c on c.oid=t.tgrelid
join pg_catalog.pg_namespace n on n.oid=c.relnamespace
where not t.tgisinternal and t.tgrelid in
  (pg_catalog.to_regclass('auth.users'),pg_catalog.to_regclass('public.profiles'))
order by n.nspname,c.relname,t.tgname;

-- All booleans below should be true AFTER deployment.
select
 not exists(select 1 from pg_catalog.pg_trigger where tgrelid=pg_catalog.to_regclass('public.profiles')
   and tgname='enforce_boardmate_email_before_review') as signup_email_guard_retired,
 not exists(select 1 from pg_catalog.pg_trigger where tgrelid=pg_catalog.to_regclass('auth.users')
   and tgname='boardmate_require_signup_email') as signup_email_enrollment_retired,
 exists(select 1 from pg_catalog.pg_trigger where tgrelid=pg_catalog.to_regclass('public.profiles')
   and tgname='protect_profile_verification_fields' and tgtype=23 and tgenabled in ('O','A')
   and tgfoid=pg_catalog.to_regprocedure('public.protect_boardmate_verification_profile()')) as document_admin_guard_preserved,
 pg_catalog.to_regclass('public.boardmate_email_verification_required') is not null as enrollment_history_preserved,
 pg_catalog.to_regprocedure('public.guard_boardmate_email_review()') is not null as old_guard_function_preserved,
 pg_catalog.to_regprocedure('public.enroll_boardmate_email_verification()') is not null as old_enrollment_function_preserved;
