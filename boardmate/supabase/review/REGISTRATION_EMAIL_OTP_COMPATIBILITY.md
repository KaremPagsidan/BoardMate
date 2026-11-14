# Registration email OTP guard compatibility review

Verdict: conditionally compatible with the latest repository schema, but NOT ready to deploy unchanged. Live compatibility remains unconfirmed. No live database connection was available and no live queries, DDL, DML, settings changes, or migration execution were performed. The existing migration was left unchanged.

## Evidence and limitations

- The original public.profiles CREATE TABLE is absent from the migration history in this repository. tests/registration.database.test.mjs defines id as uuid primary key references auth.users(id), and the repaired Auth trigger inserts new.id into profiles.id. These establish the intended mapping, not the live foreign key. Preflight section 04 verifies the exact validated, single-column foreign key in the live catalog; section 05 shows its definition and delete action. A matching UUID type alone does not prove a foreign key exists.
- 20261027000000_account_and_content_review.sql introduces verification_status as text NOT NULL, originally default approved and constrained to pending/approved/rejected. 20261111000000_verification_submission_workflow.sql expands its check to not_submitted/pending/approved/rejected and changes its default to not_submitted. 20261111000008_repair_registration_profile_trigger.sql explicitly inserts not_submitted. The OTP guard correctly compares pending and approved but does not check these prerequisites itself. Inspect sections 03, 05, 06 and 07 for live type, nullability, default, checks and any enum/domain restrictions.
- auth.users.id must be UUID and unique/primary; email_confirmed_at must exist with its standard timestamp type. Sections 03/05 expose these requirements.

## Required correction before deployment

The new enforce_boardmate_email_before_review is BEFORE INSERT OR UPDATE. Alphabetical ordering places it BEFORE protect_profile_verification_fields. The latter calls protect_boardmate_verification_profile(), whose identity-change branch can change a versioned rejected profile into pending even if the incoming row still says rejected. The email guard has already run at that point. This is a real ordering hole in the invariant; it is not a claim that the standard configured Auth login path currently exposes an exploit.

Change the guard design in a separately reviewed revision so it validates the final row: an ordinary, immediate AFTER INSERT OR UPDATE FOR EACH ROW trigger using the existing raising function will see changes made by all BEFORE triggers and abort the transaction on failure. Do not defer the check. Keep the existing protection trigger, document submission/review RPCs, and policies intact. An alternative is a BEFORE guard ordered after every row-mutating BEFORE trigger, but that relies on maintaining trigger-name ordering as new triggers are added. No correction has been applied here.

If the four-value verification workflow and repaired Auth profile trigger are absent, deploy the reviewed prerequisites first; do not solve this by broadening privileges or changing the OTP guard to accept the old three-status workflow. If the exact profiles.id foreign key is absent or unvalidated, investigate existing integrity and prepare a separately reviewed schema repair before declaring compatibility; the preflight does not modify or scan user records to repair this.

## Trigger and policy interactions

- Auth: boardmate_require_signup_email sorts before on_auth_user_created_boardmate_profile for the current AFTER INSERT ROW triggers, so enrollment should exist before the repaired profile insert. Both changes are transactional. Any error in enrollment aborts signup. Inspect all live Auth triggers for additional profile-creation functions or different ordering; duplicate profile creation can fail the Auth insert. Trigger enabled mode O/A is expected for ordinary signup; D is disabled, R is replica-only.
- Profiles: protect_profile_verification_fields initializes insert state to not_submitted, makes IDs immutable, and restricts review transitions through versioned submissions. Keep it. See the required ordering correction above.
- protect_boardmate_suspension_fields independently rejects unauthorized suspended-account edits; it is complementary.
- notify_boardmate_verification_submission, mark_profile_review_notification_read, preserve_account_approvals, boardmate_admin_audit, and visibility triggers run after relevant changes. No direct object-name conflict is present in local preceding migrations. A rejecting immediate AFTER guard rolls back transactional database writes, including notifications/history. Review any unknown live triggers for external, nontransactional effects.
- Existing own-profile SELECT/INSERT policies, suspension-aware UPDATE policy, private submission/document-lock read policies and column grants do not conflict directly. The guard adds a condition; it does not replace RLS or authorize approval. Existing profile policies can neither bypass a trigger nor grant writes to the new enrollment table.
- Enrollment is SECURITY DEFINER owned by postgres with an empty search_path. The new table enables RLS and revokes privileges from PUBLIC/anon/authenticated, so ordinary Auth/profile policies should not block the trusted functions. Check custom ownership, FORCE RLS, role privileges, default ACLs and any pre-existing enrollment-table policies. Never grant frontend access to fix a signup failure.
- Existing accounts are deliberately not backfilled into enrollment. Only Auth rows inserted after installation are enrolled; therefore unconfirmed accounts that already exist at deployment remain exempt. This preserves the stated legacy scope but must be an accepted rollout decision.
- Enrollment applies to all newly inserted Auth users, including accounts created by administrative/import/OAuth paths, not just the two UI signup forms. Verify those paths populate email confirmation when appropriate. This guard does not prove that confirmation happened through a six-digit OTP: that depends on approved Auth configuration and signup template. It cannot distinguish OTP from confirmation links or trusted admin confirmation.
- The guard examines every insert/update with final pending/approved state, so a later unconfirmation of an enrolled account also blocks unrelated profile updates in those states. Confirm that strict behavior is intended.

## Preflight usage and interpretation

Open registration_email_otp_preflight.sql and paste the entire file into Supabase SQL Editor. Run as postgres for complete catalog visibility. It is one SELECT using PostgreSQL catalogs and information_schema; it does not call application functions, read user emails/documents, or change records, tables, triggers or policies. Its output contains function source/ACLs and should be shared privately, not published.

- 01-03: required tables, owners, RLS, required column types/defaults and session replication mode.
- 04: validated_single_column_fk_found must be true for the requested FK confirmation.
- 05-07: inspect the actual status constraints, enum labels/domain constraints, primary/foreign keys.
- 08-09: inspect ALL relevant attached trigger/function definitions, enablement, security and ordering. Sorting is for display; triggers of the same timing/event/level execute alphabetically, not all rows in the displayed listing.
- 10/13/14: inspect RLS policies, protected-column grants, and default privileges. Unknown permissive policies require review; RLS alone does not protect against a privileged function with unsafe logic.
- 11: table/functions/triggers must be absent on a first deployment. The migration uses CREATE without IF NOT EXISTS and is not rerunnable. If present, inspect definitions and migration history rather than dropping/replacing objects blindly. Function overloads are conservatively reported as potential collisions.
- 12: confirms expected roles and privileged ownership assumptions; not a proof that the SQL Editor role has every migration privilege.

Do not infer live compatibility from a successful SELECT alone: review its returned definitions against these requirements. No account data integrity audit, Auth dashboard configuration inspection, SMTP/template inspection, or email delivery test is performed by this catalog query.

## Local validation

The catalog query was executed against disposable PGlite PostgreSQL with an explicit READ ONLY transaction. It correctly reported the four-status constraint and returned true for a validated profiles.id -> auth.users.id FK, then false in a separate disposable schema case without that FK. No persistent or live database was changed. The query avoids casts to missing required relations so absent tables can be reported rather than causing immediate relation-resolution errors.

PostgreSQL trigger ordering reference: https://www.postgresql.org/docs/current/sql-createtrigger.html .
