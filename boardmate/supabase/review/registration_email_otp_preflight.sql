-- READ ONLY: one catalog-only SELECT; no DDL, DML, user data, or application RPCs.
-- Run the whole query in Supabase SQL Editor as postgres.
-- Results are evidence for review, not an automatic deployment authorization.
WITH targets AS (
  SELECT c.oid, n.nspname, c.relname, c.relkind, c.relowner,
         c.relrowsecurity, c.relforcerowsecurity, c.relacl
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE (n.nspname = 'public' AND c.relname IN
    ('profiles', 'boardmate_email_verification_required',
     'boardmate_verification_submissions', 'boardmate_verification_document_locks'))
    OR (n.nspname = 'auth' AND c.relname = 'users')
), columns AS (
  SELECT t.nspname AS schema_name, t.relname AS table_name, a.attname AS column_name,
         pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
         a.attnotnull AS not_null, pg_catalog.pg_get_expr(d.adbin,d.adrelid) AS default_expression,
         ty.typtype AS type_kind, ty.oid AS type_oid, ty.typbasetype AS base_type_oid
  FROM targets t JOIN pg_catalog.pg_attribute a ON a.attrelid = t.oid
  JOIN pg_catalog.pg_type ty ON ty.oid = a.atttypid
  LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
  WHERE a.attnum > 0 AND NOT a.attisdropped
    AND ((t.nspname = 'public' AND t.relname = 'profiles'
           AND a.attname IN ('id','verification_status','verification_revision'))
      OR (t.nspname = 'auth' AND t.relname = 'users' AND a.attname IN ('id','email_confirmed_at'))
      OR t.relname = 'boardmate_email_verification_required')
), triggers AS (
  SELECT t.nspname AS schema_name, t.relname AS table_name, g.tgname AS trigger_name,
         g.tgenabled AS enabled_mode, g.tgfoid AS function_oid,
         g.tgdeferrable AS deferrable, g.tginitdeferred AS initially_deferred,
         pg_catalog.pg_get_triggerdef(g.oid,true) AS definition,
         CASE WHEN (g.tgtype & 2) <> 0 THEN 'BEFORE'
              WHEN (g.tgtype & 64) <> 0 THEN 'INSTEAD OF' ELSE 'AFTER' END AS timing,
         CASE WHEN (g.tgtype & 1) <> 0 THEN 'ROW' ELSE 'STATEMENT' END AS trigger_level
  FROM targets t JOIN pg_catalog.pg_trigger g ON g.tgrelid = t.oid
  WHERE NOT g.tgisinternal
), relevant_functions AS (
  SELECT p.* FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE p.prokind = 'f' AND (p.oid IN (SELECT function_oid FROM triggers)
    OR (n.nspname = 'public' AND p.proname IN (
      'handle_new_boardmate_user','protect_boardmate_verification_profile',
      'submit_boardmate_verification','review_boardmate_verification','is_boardmate_admin',
      'enroll_boardmate_email_verification','guard_boardmate_email_review')))
), reports AS (
 SELECT '01_context' AS section, pg_catalog.jsonb_build_object(
   'database',current_database(),'role',current_user,'server_version',current_setting('server_version'),
   'session_replication_role',current_setting('session_replication_role'),
   'profiles_present',pg_catalog.to_regclass('public.profiles') IS NOT NULL,
   'auth_users_present',pg_catalog.to_regclass('auth.users') IS NOT NULL) AS result
 UNION ALL
 SELECT '02_tables',coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
   'schema',nspname,'table',relname,'kind',relkind,'owner',pg_catalog.pg_get_userbyid(relowner),
   'rls',relrowsecurity,'force_rls',relforcerowsecurity,'acl',relacl::text)), '[]'::jsonb) FROM targets
 UNION ALL
 SELECT '03_required_columns',coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(c)), '[]'::jsonb) FROM columns c
 UNION ALL
 SELECT '04_exact_profiles_id_to_auth_users_id_fk',pg_catalog.jsonb_build_object(
   'validated_single_column_fk_found',EXISTS (
     SELECT 1 FROM pg_catalog.pg_constraint c
     JOIN pg_catalog.pg_attribute a ON a.attrelid=c.conrelid AND a.attname='id' AND NOT a.attisdropped
     JOIN pg_catalog.pg_attribute b ON b.attrelid=c.confrelid AND b.attname='id' AND NOT b.attisdropped
     WHERE c.contype='f' AND c.convalidated
       AND c.conrelid=pg_catalog.to_regclass('public.profiles')
       AND c.confrelid=pg_catalog.to_regclass('auth.users')
       AND c.conkey=ARRAY[a.attnum] AND c.confkey=ARRAY[b.attnum]))
 UNION ALL
 SELECT '05_constraints',coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
   'table',c.conrelid::regclass::text,'name',c.conname,'type',c.contype,
   'validated',c.convalidated,'definition',pg_catalog.pg_get_constraintdef(c.oid,true))), '[]'::jsonb)
 FROM pg_catalog.pg_constraint c WHERE c.conrelid IN (SELECT oid FROM targets)
 UNION ALL
 SELECT '06_status_enum_labels',coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
   'type',e.enumtypid::regtype::text,'label',e.enumlabel,'sort_order',e.enumsortorder)
   ORDER BY e.enumsortorder), '[]'::jsonb)
 FROM pg_catalog.pg_enum e WHERE e.enumtypid IN
   (SELECT type_oid FROM columns WHERE column_name='verification_status'
    UNION SELECT base_type_oid FROM columns WHERE column_name='verification_status')
 UNION ALL
 SELECT '07_status_domain_constraints',coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
   'name',c.conname,'definition',pg_catalog.pg_get_constraintdef(c.oid,true))), '[]'::jsonb)
 FROM pg_catalog.pg_constraint c WHERE c.contypid IN
   (SELECT type_oid FROM columns WHERE column_name='verification_status')
 UNION ALL
 SELECT '08_triggers_review_order_and_enabled_modes',coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t)
   ORDER BY schema_name,table_name,timing,trigger_level,trigger_name), '[]'::jsonb) FROM triggers t
 UNION ALL
 SELECT '09_function_definitions',coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
   'signature',p.oid::regprocedure::text,'owner',pg_catalog.pg_get_userbyid(p.proowner),
   'security_definer',p.prosecdef,'settings',p.proconfig,'acl',p.proacl::text,
   'definition',pg_catalog.pg_get_functiondef(p.oid))), '[]'::jsonb) FROM relevant_functions p
 UNION ALL
 SELECT '10_policies',coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
   'schema',p.schemaname,'table',p.tablename,'name',p.policyname,'permissive',p.permissive,
   'roles',p.roles,'command',p.cmd,'using',p.qual,'with_check',p.with_check)), '[]'::jsonb)
 FROM pg_catalog.pg_policies p JOIN targets t ON t.nspname=p.schemaname AND t.relname=p.tablename
 UNION ALL
 SELECT '11_existing_migration_object_collisions',pg_catalog.jsonb_build_object(
   'table_exists',pg_catalog.to_regclass('public.boardmate_email_verification_required') IS NOT NULL,
   'functions',coalesce((SELECT pg_catalog.jsonb_agg(p.oid::regprocedure::text)
     FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname IN
       ('enroll_boardmate_email_verification','guard_boardmate_email_review')), '[]'::jsonb),
   'triggers',coalesce((SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t)) FROM triggers t
     WHERE (t.schema_name='auth' AND t.table_name='users' AND t.trigger_name='boardmate_require_signup_email')
        OR (t.schema_name='public' AND t.table_name='profiles' AND t.trigger_name='enforce_boardmate_email_before_review')), '[]'::jsonb))
 UNION ALL
 SELECT '12_roles',coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
   'role',rolname,'superuser',rolsuper,'bypass_rls',rolbypassrls)), '[]'::jsonb)
 FROM pg_catalog.pg_roles WHERE rolname IN ('postgres','supabase_auth_admin','anon','authenticated','service_role')
 UNION ALL
 SELECT '13_profile_column_grants',coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(g)), '[]'::jsonb)
 FROM information_schema.column_privileges g
 WHERE g.table_schema='public' AND g.table_name='profiles'
   AND g.column_name IN ('id','verification_status','verification_revision')
 UNION ALL
 SELECT '14_default_privileges',coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
   'owner',pg_catalog.pg_get_userbyid(d.defaclrole),'schema',n.nspname,
   'object_kind',d.defaclobjtype,'acl',d.defaclacl::text)), '[]'::jsonb)
 FROM pg_catalog.pg_default_acl d LEFT JOIN pg_catalog.pg_namespace n ON n.oid=d.defaclnamespace
 WHERE d.defaclnamespace=0 OR n.nspname IN ('public','auth')
)
SELECT section,result FROM reports ORDER BY section;
