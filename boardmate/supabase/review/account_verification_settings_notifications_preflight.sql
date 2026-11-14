-- READ ONLY. Manual review only; no execution performed against production.
select n.nspname,c.relname,c.relrowsecurity,c.relforcerowsecurity,c.relacl::text
from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
where c.oid=pg_catalog.to_regclass('public.boardmate_notifications');
select policyname,permissive,roles,cmd,qual,with_check from pg_catalog.pg_policies
where schemaname='public' and tablename='boardmate_notifications';
-- Confirm that SELECT/UPDATE/DELETE policies are restricted to the caller's rows.
-- Review unexpected direct INSERT privileges instead of granting/removing rights blindly.
select pg_catalog.has_table_privilege('authenticated','public.boardmate_notifications','INSERT') as authenticated_can_insert;
select table_name,column_name,data_type from information_schema.columns where table_schema='public'
 and ((table_name='boardmate_notifications' and column_name in ('target_type','target_id','verification_event_key'))
 or (table_name='profiles' and column_name in ('verification_revision','verification_status','verification_reason','verified_at')));
select t.tgname,t.tgenabled,pg_catalog.pg_get_triggerdef(t.oid,true) as trigger_definition,
 pg_catalog.pg_get_functiondef(t.tgfoid) as function_definition
from pg_catalog.pg_trigger t where not t.tgisinternal and t.tgrelid=pg_catalog.to_regclass('public.profiles')
order by t.tgname;
-- One account-decision producer attachment is expected; inspect custom wrappers/aliases.
select p.oid::regprocedure::text as signature,pg_catalog.pg_get_functiondef(p.oid) as definition
from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.prokind='f' and p.proname in
 ('notify_boardmate_marketplace_activity','notify_boardmate_verification_decision','notify_boardmate_verification_settings',
 'protect_boardmate_verification_notice_key','review_boardmate_verification','protect_boardmate_verification_profile');
select indexname,indexdef from pg_catalog.pg_indexes where schemaname='public' and tablename='boardmate_notifications';
select pubname,schemaname,tablename from pg_catalog.pg_publication_tables
where schemaname='public' and tablename in ('profiles','boardmate_notifications');
-- Before first deployment: new metadata column/index/functions should not exist.
-- After deployment: verify the event key/index, the single settings producer attachment,
-- metadata-key UPDATE guard and unchanged owner-only RLS/review/security definitions.
