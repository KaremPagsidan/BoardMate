-- READ ONLY. Prepared for manual production review; not executed by this task.
-- 1. Required objects and deployed feature surface.
select name, pg_catalog.to_regclass(name) is not null as present from (values
 ('public.profiles'),('public.boardmate_verification_submissions'),('public.boardmate_verification_document_locks'),
 ('public.boardmate_notifications'),('public.admin_review_notifications'),('storage.objects')) x(name);
select name,pg_catalog.to_regprocedure(name) is not null as present from (values
 ('public.submit_boardmate_verification(text,text,uuid)'),('public.review_boardmate_verification(uuid,uuid,text,text)'),
 ('public.protect_boardmate_verification_profile()'),('public.validate_boardmate_verification_documents(uuid,text,text)'),
 ('public.resubmit_boardmate_verification(text,text,uuid,jsonb)'),('public.boardmate_verification_resubmission_ready()')) x(name);

-- 2. STOP on multiple pending submissions; no automatic history rewrite is permitted.
select user_id,count(*) as pending_count from public.boardmate_verification_submissions
where status='pending' group by user_id having count(*)>1;
-- Also review orphaned pending history before allowing a rejected account to resubmit.
select s.user_id,s.revision,p.verification_status,p.verification_revision
from public.boardmate_verification_submissions s left join public.profiles p on p.id=s.user_id
where s.status='pending' and (p.id is null or p.verification_status<>'pending' or p.verification_revision is distinct from s.revision);

-- 3. Review full current definitions and any custom trigger attachments first.
select n.nspname,c.relname,t.tgname,t.tgenabled,pg_catalog.pg_get_triggerdef(t.oid,true) as definition,
 pg_catalog.pg_get_functiondef(t.tgfoid) as function_definition
from pg_catalog.pg_trigger t join pg_catalog.pg_class c on c.oid=t.tgrelid join pg_catalog.pg_namespace n on n.oid=c.relnamespace
where not t.tgisinternal and t.tgrelid in (pg_catalog.to_regclass('public.profiles'),
 pg_catalog.to_regclass('public.boardmate_verification_submissions'),pg_catalog.to_regclass('storage.objects'))
order by n.nspname,c.relname,t.tgname;
select p.oid::regprocedure::text as signature,pg_catalog.pg_get_userbyid(p.proowner) as owner,p.prosecdef,p.proconfig,p.proacl::text,
 pg_catalog.pg_get_functiondef(p.oid) as definition
from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('submit_boardmate_verification','resubmit_boardmate_verification',
 'review_boardmate_verification','protect_boardmate_verification_profile','notify_boardmate_verification_submission',
 'notify_boardmate_marketplace_activity','notify_boardmate_verification_decision','protect_boardmate_verification_history');

-- 4. Existing RLS/ACLs must remain unchanged; new migration does not add permissive policies.
select n.nspname,c.relname,c.relrowsecurity,c.relforcerowsecurity,c.relacl::text
from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in ('profiles','boardmate_verification_submissions',
 'boardmate_verification_document_locks','boardmate_notifications','admin_review_notifications');
select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check from pg_catalog.pg_policies
where (schemaname='public' and tablename in ('profiles','boardmate_verification_submissions',
 'boardmate_verification_document_locks','boardmate_notifications','admin_review_notifications'))
 or (schemaname='storage' and tablename='objects') order by schemaname,tablename,policyname;

-- 5. Column types/constraints, notification routing, and private bucket prerequisites.
select table_schema,table_name,column_name,data_type,udt_name from information_schema.columns
where table_schema='public' and ((table_name='profiles' and column_name in
 ('role','gender','property_type','dob','verification_status','verification_revision'))
 or (table_name='boardmate_notifications' and column_name in ('target_type','target_id'))
 or (table_name='boardmate_verification_submissions' and column_name='previous_review'));
select conname,pg_catalog.pg_get_constraintdef(oid,true) from pg_catalog.pg_constraint
where conrelid in (pg_catalog.to_regclass('public.profiles'),pg_catalog.to_regclass('public.boardmate_verification_submissions'));
select id,public,file_size_limit from storage.buckets where id='verification-documents';

-- 6. AFTER deployment: unique pending index + new history guard + notification binding.
select indexname,indexdef from pg_catalog.pg_indexes where schemaname='public'
 and tablename='boardmate_verification_submissions';
-- Readiness is not called here: this script inspects catalogs only (plus prerequisite SELECTs).

-- 7. Existing realtime delivery prerequisites; record inserts still persist without publication.
select pubname,schemaname,tablename from pg_catalog.pg_publication_tables
where schemaname='public' and tablename in ('profiles','boardmate_notifications','admin_review_notifications');
