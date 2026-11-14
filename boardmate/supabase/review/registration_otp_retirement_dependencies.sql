-- READ ONLY: catalog SELECTs only. Prepared for manual review, NOT executed.
-- Run as postgres for complete definitions. Does not read account rows or SMTP secrets.
-- Keep definition output private. Empty dependency/search results are NOT absolute proof
-- against dynamically constructed SQL or references in external application code.

-- 1. Exact live trigger bindings. Expected BEFORE retirement: three rows, matches=true.
with expected(schema_name,table_name,trigger_name,function_signature,expected_type) as (
 values ('auth','users','boardmate_require_signup_email','public.enroll_boardmate_email_verification()',5),
        ('public','profiles','enforce_boardmate_email_before_review','public.guard_boardmate_email_review()',21),
        ('public','profiles','protect_profile_verification_fields','public.protect_boardmate_verification_profile()',23)
)
select e.*,t.tgenabled,t.tgisinternal,
       pg_catalog.pg_get_triggerdef(t.oid,true) as actual_definition,
       coalesce(t.tgfoid=pg_catalog.to_regprocedure(e.function_signature)
         and t.tgtype=e.expected_type and t.tgenabled in ('O','A')
         and not t.tgisinternal,false) as matches
from expected e
left join pg_catalog.pg_namespace n on n.nspname=e.schema_name
left join pg_catalog.pg_class c on c.relnamespace=n.oid and c.relname=e.table_name
left join pg_catalog.pg_trigger t on t.tgrelid=c.oid and t.tgname=e.trigger_name;

-- 2. ALL non-internal triggers on Auth/profiles plus attachments to either retired
-- function anywhere else. Review unexpected attachments: the migration does not remove them.
select n.nspname,c.relname,t.tgname,t.tgenabled,
       pg_catalog.pg_get_triggerdef(t.oid,true) as definition,
       t.tgfoid::regprocedure::text as function_signature
from pg_catalog.pg_trigger t
join pg_catalog.pg_class c on c.oid=t.tgrelid
join pg_catalog.pg_namespace n on n.oid=c.relnamespace
where not t.tgisinternal and (
  t.tgrelid in (pg_catalog.to_regclass('auth.users'),pg_catalog.to_regclass('public.profiles'))
  or t.tgfoid in (pg_catalog.to_regprocedure('public.enroll_boardmate_email_verification()'),
                  pg_catalog.to_regprocedure('public.guard_boardmate_email_review()')))
order by n.nspname,c.relname,t.tgname;

-- 3. Catalog dependencies in BOTH directions for the two triggers and retained
-- table/functions. A trigger depends on its function/table, not vice versa.
-- Incoming dependencies on a trigger deserve review before DROP (no CASCADE used).
with targets(classid,objid,label) as (
 select 'pg_catalog.pg_trigger'::regclass::oid,t.oid,t.tgname::text
 from pg_catalog.pg_trigger t where
   (t.tgrelid=pg_catalog.to_regclass('auth.users') and t.tgname='boardmate_require_signup_email')
   or (t.tgrelid=pg_catalog.to_regclass('public.profiles') and t.tgname='enforce_boardmate_email_before_review')
 union all
 select 'pg_catalog.pg_class'::regclass::oid,c.oid,'retained enrollment table'
 from pg_catalog.pg_class c where c.oid=pg_catalog.to_regclass('public.boardmate_email_verification_required')
 union all
 select 'pg_catalog.pg_proc'::regclass::oid,p.oid,p.oid::regprocedure::text
 from pg_catalog.pg_proc p where p.oid in
  (pg_catalog.to_regprocedure('public.enroll_boardmate_email_verification()'),
   pg_catalog.to_regprocedure('public.guard_boardmate_email_review()'))
)
select x.label,'depends_on' as direction,d.deptype,
       pg_catalog.pg_describe_object(d.classid,d.objid,d.objsubid) as dependent,
       pg_catalog.pg_describe_object(d.refclassid,d.refobjid,d.refobjsubid) as referenced
from targets x join pg_catalog.pg_depend d on d.classid=x.classid and d.objid=x.objid
union all
select x.label,'referenced_by',d.deptype,
       pg_catalog.pg_describe_object(d.classid,d.objid,d.objsubid),
       pg_catalog.pg_describe_object(d.refclassid,d.refobjid,d.refobjsubid)
from targets x join pg_catalog.pg_depend d on d.refclassid=x.classid and d.refobjid=x.objid
order by 1,2,3;

-- 4. Heuristic source scan for remaining registration email enforcement and dependencies.
-- Includes procedures, wrappers and custom schemas. Expected hits include the two
-- retained OTP functions; email_confirmed_at in recovery functions can be legitimate.
select n.nspname,p.oid::regprocedure::text as routine,
       pg_catalog.pg_get_functiondef(p.oid) as definition
from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
where p.prokind in ('f','p') and n.nspname not in ('pg_catalog','information_schema')
 and n.nspname !~ '^pg_(toast|temp)'
 and p.prosrc ~* '(boardmate_email_verification_required|enroll_boardmate_email_verification|guard_boardmate_email_review|boardmate_require_signup_email|enforce_boardmate_email_before_review|email_confirmed_at)'
order by 1,2;

-- 5. Preserved workflow definitions/privileges, including Auth profile creation.
-- Verify document validation and administrator authorization are present in the bodies.
select p.oid::regprocedure::text as routine,pg_catalog.pg_get_userbyid(p.proowner) as owner,
       p.prosecdef,p.proconfig,p.proacl::text,
       pg_catalog.pg_get_functiondef(p.oid) as definition
from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.prokind in ('f','p') and p.proname in
 ('handle_new_boardmate_user','protect_boardmate_verification_profile','submit_boardmate_verification',
  'review_boardmate_verification','validate_boardmate_verification_documents','is_boardmate_admin')
order by 1;

-- 6. Policies on profile/document storage, and suspicious email enforcement elsewhere.
select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check
from pg_catalog.pg_policies
where (schemaname='public' and tablename in
 ('profiles','boardmate_verification_submissions','boardmate_verification_document_locks','boardmate_email_verification_required'))
 or (schemaname='storage' and tablename='objects')
 or (coalesce(qual,'')||' '||coalesce(with_check,'')) ~*
 '(boardmate_email_verification_required|guard_boardmate_email_review|enroll_boardmate_email_verification|email_confirmed_at)'
order by schemaname,tablename,policyname;

-- 7. Views/rules/check constraints with textual enforcement references.
select 'rule' as kind,n.nspname as schema_name,c.relname as object_name,
       r.rulename::text as name,pg_catalog.pg_get_ruledef(r.oid,true) as definition
from pg_catalog.pg_rewrite r join pg_catalog.pg_class c on c.oid=r.ev_class
join pg_catalog.pg_namespace n on n.oid=c.relnamespace
where n.nspname not in ('pg_catalog','information_schema') and pg_catalog.pg_get_ruledef(r.oid,true) ~*
 '(boardmate_email_verification_required|guard_boardmate_email_review|enroll_boardmate_email_verification|email_confirmed_at)'
union all
select 'constraint',n.nspname,c.relname,k.conname::text,pg_catalog.pg_get_constraintdef(k.oid,true)
from pg_catalog.pg_constraint k join pg_catalog.pg_class c on c.oid=k.conrelid
join pg_catalog.pg_namespace n on n.oid=c.relnamespace
where k.contype='c' and pg_catalog.pg_get_constraintdef(k.oid,true) ~*
 '(boardmate_email_verification_required|guard_boardmate_email_review|enroll_boardmate_email_verification|email_confirmed_at)';

-- 8. Enabled database-wide DDL event triggers can react to a DROP TRIGGER.
-- Review their tags/function bodies if any are returned; none are changed here.
select e.evtname,e.evtevent,e.evtenabled,e.evttags,
       e.evtfoid::regprocedure::text as function_signature,
       pg_catalog.pg_get_functiondef(e.evtfoid) as definition
from pg_catalog.pg_event_trigger e where e.evtenabled<>'D' order by e.evtname;
