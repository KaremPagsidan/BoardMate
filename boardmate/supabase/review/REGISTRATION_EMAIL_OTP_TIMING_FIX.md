# Forward-only email OTP trigger timing correction

Prepared for an existing installation of 20261113000000_registration_email_otp_guard.sql. Do NOT rerun the original migration. No SQL was executed against live Supabase. No application code or original migration was changed.

## Separate artifacts

- Corrective SQL: ../migrations/20261113000001_fix_registration_email_guard_timing.sql
- Read-only before/after SQL: registration_email_otp_timing_verification.sql
- Local security regression tests: ../../tests/registrationOtpTiming.database.test.mjs

The correction uses CREATE OR REPLACE TRIGGER on exactly public.profiles.enforce_boardmate_email_before_review. It retains the existing trigger name and guard function, changing timing from BEFORE to immediate AFTER INSERT OR UPDATE FOR EACH ROW. There is no column list or WHEN filter: identity edits can cause a later BEFORE trigger to set Pending even when verification_status was not in the original UPDATE statement.

No tables, functions, policies, accounts, or enrollment rows are recreated, deleted or updated. Enrollment, approval authorization, RLS, and legacy exemptions remain unchanged. The old trigger name is deliberately retained for compatibility even though it contains the word before. An ordinary AFTER trigger is nondeferrable and raises within the modifying statement; its exception rolls back profile changes and transactional submission/notification writes. This is final relative to BEFORE row transformations, not a claim to run after every unrelated AFTER trigger. Any external nontransactional side effects in unknown live triggers would require independent review.

## Definition review

Reviewed actual SQL definitions in repository:

- Original guard: BEFORE INSERT OR UPDATE, checks enrolled IDs, Auth email_confirmed_at, and final statuses pending/approved; raises on unconfirmed enrolled accounts.
- protect_profile_verification_fields: BEFORE INSERT OR UPDATE calling protect_boardmate_verification_profile(), defined by 20261111000000_verification_submission_workflow.sql. It runs alphabetically after the old guard and can move a rejected versioned profile to Pending during an identity edit.
- The correction leaves the guard function and profile protection function unchanged, validating the row after that transformation.

The user confirmed live objects exist, but their complete live definitions have not been supplied and no live management connection is available here. Therefore the local review is not a claim of live definition equivalence. Run the read-only file before deployment to compare live trigger/function definitions with these expected definitions. The migration additionally checks the target guard function binding, enabled mode O, BEFORE/AFTER INSERT+UPDATE ROW event mask, absence of arguments/WHEN/UPDATE OF/transition tables, and ordinary trigger status. Unexpected drift aborts instead of being silently overwritten. An already corrected expected AFTER definition is accepted for safe reapplication. PostgreSQL 14+ is required for CREATE OR REPLACE TRIGGER.

## Manual deployment

1. Run the separate read-only queries as postgres and retain output. Expect existing protection/enrollment/RLS booleans true. Before correction, guard_is_immediate_after_insert_update_row is false. Review returned function bodies and any additional triggers; object existence alone does not validate behavior.
2. Execute ONLY the forward corrective SQL when ready. It is transactional with 5-second lock and 30-second statement timeouts. A timeout or failed precondition requires reviewing the error; do not disable protections to force deployment. If the editor retains an aborted explicit transaction after a failure, roll that transaction back before retrying.
3. Rerun the read-only queries. All four booleans should be true, the target trigger must say AFTER INSERT OR UPDATE, and original guard/enrollment function definitions, owners, ACLs and table identities must be unchanged. The verification queries do not write test accounts or data.

This correction does not backfill existing unenrolled accounts or fix any previously committed incorrect status; record remediation would be a separate authorized task. It enforces future writes using the existing enrollment scope. A catalog query establishes definitions, not actual live end-to-end enforcement; no live behavior or SMTP delivery test was performed.

## Local results

Command (from boardmate):

    node --test tests/registrationOtpTiming.database.test.mjs tests/registrationOtp.database.test.mjs tests/verification.database.test.mjs tests/registration.database.test.mjs

39 passed, 0 failed, 0 skipped. All SQL ran exclusively in disposable in-memory PGlite PostgreSQL; no production connection is supported by these tests.

Coverage includes:

- Reproduces the original ordering bypass using the actual BoardMate verification protection function; proves the corrected guard rejects that same rejected-to-Pending identity edit.
- Confirms rollback of profile identity/revision, new submission and notification changes on rejection.
- Rejects unconfirmed document submissions and administrator approval, including rollback of the corresponding review decision.
- Rejects final Pending and Approved statuses produced by an even later BEFORE trigger.
- Confirms verified users can submit, only administrators can approve, existing rejection/legacy workflows remain intact, enrollment still occurs for new Auth rows, and ordinary accounts cannot delete enrollment records.
- Compares enrollment/accounts, both unchanged functions, and unrelated triggers before and after correction.
- Verifies immediate AFTER timing, successful safe rerun, rejection of disabled-guard drift, and execution of the separate verification queries inside a READ ONLY transaction.

PostgreSQL reference: https://www.postgresql.org/docs/current/sql-createtrigger.html confirms CREATE OR REPLACE TRIGGER syntax and AFTER visibility of BEFORE trigger transformations.
