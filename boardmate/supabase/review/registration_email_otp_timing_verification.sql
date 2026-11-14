-- READ ONLY. Run before correction to review definitions, and after to verify.
-- Catalog inspection only: no account changes, test signups, or application RPCs.
-- 1. Actual trigger definitions, including other triggers on both relevant tables.
select n.nspname as schema_name, c.relname as table_name, t.tgname,
       t.tgenabled, t.tgdeferrable, t.tginitdeferred,
       pg_catalog.pg_get_triggerdef(t.oid, true) as trigger_definition,
       p.oid::regprocedure as function_signature,
       pg_catalog.pg_get_userbyid(p.proowner) as function_owner,
       p.prosecdef as security_definer, p.proconfig,
       pg_catalog.pg_get_functiondef(p.oid) as function_definition
from pg_catalog.pg_trigger t
join pg_catalog.pg_class c on c.oid = t.tgrelid
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
join pg_catalog.pg_proc p on p.oid = t.tgfoid
where not t.tgisinternal
  and t.tgrelid in (pg_catalog.to_regclass('public.profiles'), pg_catalog.to_regclass('auth.users'))
order by n.nspname, c.relname, t.tgname;

-- 2. guard_is_immediate_after_insert_update_row must be true AFTER correction (false BEFORE).
-- All other booleans should be true before and after. A missing object yields false.
select
 exists(select 1 from pg_catalog.pg_trigger t
   where t.tgrelid=pg_catalog.to_regclass('public.profiles')
     and t.tgname='enforce_boardmate_email_before_review'
     and t.tgtype=21 and t.tgenabled='O'
     and t.tgfoid=pg_catalog.to_regprocedure('public.guard_boardmate_email_review()')
     and t.tgconstraint=0 and not t.tgdeferrable and not t.tginitdeferred
     and t.tgnargs=0 and t.tgqual is null) as guard_is_immediate_after_insert_update_row,
 exists(select 1 from pg_catalog.pg_trigger t
   where t.tgrelid=pg_catalog.to_regclass('public.profiles')
     and t.tgname='protect_profile_verification_fields' and t.tgtype=23
     and t.tgenabled in ('O','A')
     and t.tgfoid=pg_catalog.to_regprocedure('public.protect_boardmate_verification_profile()')) as existing_profile_protection_present,
 exists(select 1 from pg_catalog.pg_trigger t
   where t.tgrelid=pg_catalog.to_regclass('auth.users')
     and t.tgname='boardmate_require_signup_email' and t.tgtype=5
     and t.tgenabled in ('O','A')
     and t.tgfoid=pg_catalog.to_regprocedure('public.enroll_boardmate_email_verification()')) as existing_enrollment_trigger_present,
 exists(select 1 from pg_catalog.pg_class c
   where c.oid=pg_catalog.to_regclass('public.boardmate_email_verification_required')
     and c.relrowsecurity) as enrollment_table_rls_enabled;

-- 3. Save before/after output to confirm table/function object identities.
select 'table' as object_kind, c.oid, n.nspname||'.'||c.relname as name,
       c.relacl::text as privileges
from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
where c.oid=pg_catalog.to_regclass('public.boardmate_email_verification_required')
union all
select 'function', p.oid, p.oid::regprocedure::text, p.proacl::text
from pg_catalog.pg_proc p
where p.oid in (pg_catalog.to_regprocedure('public.enroll_boardmate_email_verification()'),
               pg_catalog.to_regprocedure('public.guard_boardmate_email_review()'));

-- This catalog-only inspection cannot prove live behavior through test writes.
-- Local tests cover enforcement; live behavior tests require separate authorization.
