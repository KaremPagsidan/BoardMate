# Registration profile repair

Apply `migrations/20261111000008_repair_registration_profile_trigger.sql` after the earlier BoardMate migrations, including `20261111000000_verification_submission_workflow.sql`. Deploy the updated frontend with it. This repair has been tested in a disposable PostgreSQL instance, not applied to a live Supabase project.

The previous Auth trigger assumes `public.user_role` exists and assigns text expressions directly to other potentially enum-valued profile fields. A real insert using the previous function fails against an enum-valued gender column; the replacement passes under the Auth database role with profile RLS enabled. The replacement reads the actual role/gender/property column types and uses the profile row type for conversion. It keeps database constraints, RLS, document protection and admin membership unchanged, and does not suppress profile insert errors or overwrite existing profiles.

New accounts start `not_submitted`. Only the existing private-document submission RPC moves them to `pending` with a revision after both uploads are validated. When email confirmation is required, users must confirm and sign in before files can be uploaded. A failed upload can be retried from account verification without creating another account. Auth's unique email constraint remains the account duplicate authority; existing profile uniqueness constraints also remain active.

## Live diagnosis

Supabase's generic message does not identify the failing database object. Check Authentication and Postgres logs around the failing request for the underlying SQLSTATE, column, constraint, or function. Do not disable RLS or drop all Auth triggers to work around the error. The local reproduction does not establish the precise live cause without those logs.

Read-only SQL to inspect the target database (contains no user values):

```sql
select c.table_schema, c.table_name, c.column_name, c.data_type,
       c.udt_name, c.is_nullable, c.column_default
from information_schema.columns c
where c.table_schema = 'public' and c.table_name = 'profiles'
order by c.ordinal_position;

select conname, pg_get_constraintdef(oid)
from pg_constraint where conrelid = 'public.profiles'::regclass;

select tgrelid::regclass, tgname, tgenabled, pg_get_triggerdef(oid)
from pg_trigger
where tgrelid in ('auth.users'::regclass, 'public.profiles'::regclass)
  and not tgisinternal;

select p.oid::regprocedure, p.proowner::regrole, p.prosecdef, p.proconfig
from pg_proc p
where p.oid = 'public.handle_new_boardmate_user()'::regprocedure;

select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where (schemaname = 'public' and tablename = 'profiles')
   or (schemaname = 'storage' and tablename = 'objects');

select id, public, file_size_limit, allowed_mime_types
from storage.buckets where id = 'verification-documents';
```

Confirm the signup trigger is enabled and the function owner is `postgres`, `security definer` is true, and the search path is empty. Review any additional Auth signup triggers separately; this migration replaces only BoardMate's named trigger. Missing required columns, unrelated triggers, or additional deployment-specific constraints need correction based on the actual logs rather than broad constraint removal.

## Validation

Run `node --test tests/registration.test.mjs tests/registration.database.test.mjs tests/verification.test.mjs tests/verification.database.test.mjs` and `npm run build` from `boardmate`.

In staging, register one renter and one owner with new emails; confirm email if required; verify saved identity fields, upload ID/selfie, and confirm one pending submission appears in Admin Sign-up Verification. Retry an existing email and verify no second account/profile is created. Retry a failed upload from the account review screen. Confirm unapproved users cannot access approved-member actions and other users cannot read verification documents.

Reference: [Supabase registration database errors](https://supabase.com/kb/troubleshooting/database-error-saving-new-user-RU_EwB).


## Duplicate validation and admin approval update

Apply `20261111000009_registration_duplicate_validation.sql` after the previous repair and before deploying the updated frontend. The browser checks email/phone availability with a narrowly scoped RPC before calling Auth signup. Both roles share the same check. It returns only two booleans; no Auth/profile SELECT grants are added. Unique profile indexes enforce normalized email and phone values even when two requests pass the availability check together. If Auth hides a unique violation behind its generic database error, the browser repeats the availability check to identify the duplicate field.

Phone comparison removes formatting and equates Philippine `09?`, `9?`, `+639?`, and `00639?` mobile numbers. Blank phones/emails are excluded from the indexes. The migration is transactional. If existing accounts already collide after normalization, PostgreSQL will reject index creation and roll back this migration; do not deploy the frontend until those collisions are reviewed and resolved. No accounts are automatically merged, deleted, or reapproved.

Check for existing collisions without printing account details:

```sql
select count(*) as duplicate_email_groups from (
  select lower(btrim(email)) from public.profiles
  where nullif(btrim(email), '') is not null
  group by lower(btrim(email)) having count(*) > 1
) duplicates;
```

The phone index error identifies normalized phone collisions if present; review the affected records in the protected dashboard. Keep the previous frontend deployed until the migration succeeds.

The Admin Approve button no longer depends on click history for document preview links or on temporary signed-link generation. It is disabled during an active operation or for records no longer pending. The existing versioned review RPC still checks admin membership, current pending revision and valid stored ID/selfie documents. A synchronous request lock prevents rapid duplicate clicks. Successful decisions immediately leave the queue even if a later refresh fails. Existing account activation, user notification and rejection triggers are retained.

Run `node --test tests/registration.test.mjs tests/registrationDuplicates.test.mjs tests/registration.database.test.mjs tests/verification.test.mjs tests/verification.database.test.mjs` for duplicate lookup, normalized uniqueness, cross-role signup, approval/rejection, notifications, RLS and concurrent-decision regression checks. Live deployment/log verification still requires a connected Supabase project or database administrator access.
