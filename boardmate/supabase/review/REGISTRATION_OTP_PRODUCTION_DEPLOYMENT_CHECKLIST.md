# Production deployment checklist: registration OTP retirement and recovery OTP

Status: preparation only, pending explicit approval. No SQL was executed and no live settings or deployment were changed during this review. Rollback SQL is prepared text, not executed or SQL-tested in this turn.

## Confirmed findings and scope

The supplied live inspection confirms the registration-email enrollment trigger AND the enabled Auth profile-creation trigger. The earlier concern that new accounts might lack automatic profile creation is closed at the trigger-presence level. The reported profile triggers also match the expected shapes.

| Object | Reported live shape | Required action |
| --- | --- | --- |
| auth.users.boardmate_require_signup_email | enabled AFTER INSERT ROW, type 5 | Retire |
| auth.users.on_auth_user_created_boardmate_profile | enabled AFTER INSERT ROW | Keep unchanged |
| public.profiles.enforce_boardmate_email_before_review | enabled AFTER INSERT/UPDATE ROW, type 21 | Retire |
| public.profiles.protect_profile_verification_fields | enabled BEFORE INSERT/UPDATE ROW, type 23 | Keep unchanged |

`20261113000002_remove_registration_email_otp_triggers.sql` matches these findings and needs no timing correction. It removes exactly the two registration-email attachments and retains accounts, enrollment history, all functions, policies, constraints, profile creation, private document validation, administrator approval and unrelated triggers. It does not change existing confirmation timestamps or approval statuses. Function bodies/security still require live review; a matching trigger name/type alone is not proof of the entire live workflow.

## Remaining critical checks: do not treat as already completed

Use the existing read-only `registration_otp_retirement_dependencies.sql` and `registration_without_otp_verification.sql`. They remain sufficient for the database dependency review; no additional SQL execution is necessary in this preparation task.

- [ ] Verify schema-qualified, zero-argument function bindings: public.enroll_boardmate_email_verification(), public.guard_boardmate_email_review(), public.protect_boardmate_verification_profile(), and public.handle_new_boardmate_user(). Capture literal enabled modes O/A, full definitions, owners, security-definer flags and search_path. The retirement migration checks only a subset; review the actual bodies.
- [ ] Confirm no extra trigger elsewhere calls either retained OTP function. Check wrappers, custom functions, policies, views, rules and checks for remaining enrollment-table/email_confirmed_at enforcement. Legitimate recovery checks must not be removed. Inspect configured Supabase Auth Hooks separately; catalog/source searches cannot cover external or constructed dynamic SQL.
- [ ] Review pg_depend in both directions for the retiring triggers. Retained table/function/FK dependencies are expected. Unexpected dependencies or DDL event triggers must be understood before DROP; never add CASCADE to force retirement.
- [ ] Verify live submission/review RPCs still validate private ID/selfie uploads and revisions, enforce authentication/suspension, and require administrator membership for decisions. Confirm existing profile/Storage RLS, protected-column grants and suspension controls remain effective.
- [ ] If not previously captured, verify validated profiles.id -> auth.users.id FK, UUID identity, and verification_status NOT NULL with allowed values not_submitted/pending/approved/rejected using the earlier preflight. Confirm new profiles start not_submitted; email confirmation must not imply administrator approval.
- [ ] Review Auth hooks, CAPTCHA, secure password-change rules, OTP length/expiry, email quotas, and Brevo SMTP/sender setup. Check whether any other application shares this Supabase project; Auth settings and templates affect the project, not only BoardMate roles.
- [ ] Confirm all changes target the intended production project and that the approved frontend environment points to that same project. Do not print or copy SMTP secrets/service-role keys into frontend files or review output.

No unresolved conflict is demonstrated by the supplied trigger results. Deployment remains conditional on these pending checks, staging acceptance and approval.

## Before the maintenance window

- [ ] Obtain explicit approval for: the exact retirement migration; Confirm email OFF; Reset Password template replacement; any OTP expiry/length/rate changes; release of both User and Admin bundles; signup/recovery maintenance gates and production smoke-test accounts. SMTP credential changes are not required or authorized by this plan.
- [ ] Save current full trigger/function definitions and ACLs, Auth Confirm email/signup availability settings, OTP/rate/CAPTCHA settings, template subjects/bodies and Auth URL configuration. Record which values are actually changed; rollback restores captured values rather than guessing defaults. Keep exports private.
- [ ] Confirm a current recoverable backup/PITR policy and save the pre-release frontend artifacts, configuration and asset hashes. Routine rollback must preserve new data/password changes; a whole-database restore is not the normal rollback method.
- [ ] Prepare a TESTED compatible rollback frontend before release. The earlier frontend used registration OTP and Flask recovery, which was unavailable. Blindly restoring it would regress recovery. Preferred fallback supports the former signup OTP path AND the current Supabase recovery OTP flow/template. Such a combined fallback has NOT been built or validated in this task; this is a release-readiness item, not an existing artifact.
- [ ] If no compatible fallback exists, agree that rollback will keep registrations closed and preserve working recovery until a compatible build is ready. Do not promise an instant full-service rollback from the old artifacts alone.
- [ ] Complete staging tests below with actual controlled email accounts; local mocks do not validate Brevo delivery. Record expected six-digit code expiry and send interval. Current UI cooldown is 60 seconds; the server owns durable limits. Review shared-project effects of any setting change.
- [ ] Review the two known pre-existing duplicate-message wording test failures; obtain explicit acceptance or resolve separately. Prior final local suite: 142 total, 136 passed, 2 such failures, 4 disposable-Supabase tests skipped. Both builds/lint and 28 responsive browser checks passed; these are historical local results, not a new production test.

## Approved deployment sequence

These are future manual/operator actions, not authorization to execute them now. Auth settings, SQL and frontend release cannot commit as a single atomic transaction.

1. [ ] Announce a short registration/recovery maintenance window and record start time/release identifier. Gate NEW signups at an approved Auth-level control (not only a hidden frontend button) so direct API clients cannot create accounts during a mismatched configuration. Preserve existing-account login and dashboards. Pause recovery entry points during template/frontend switchover; handle in-flight codes by asking users to restart after reopening.
2. [ ] Recheck/save the read-only dependency output immediately before deployment. If definitions differ from the reviewed baseline, stop rather than widening the migration.
3. [ ] Apply ONLY `../migrations/20261113000002_remove_registration_email_otp_triggers.sql` as the trusted deployment role. It is transactional, with a 5-second lock timeout and 30-second statement timeout. Review errors and roll back an aborted transaction; do not manually disable unrelated guards or rerun the original OTP migration/timing correction.
4. [ ] Run `registration_without_otp_verification.sql`. All six summary booleans must be true. Confirm the Auth profile-creation and profile document-protection triggers remain enabled with identical definitions; confirm enrollment history/functions/RLS remain. Stop on any unexpected result.
5. [ ] Set Supabase Email **Confirm email OFF** while keeping password Auth enabled. Restore signup availability only at the controlled smoke-test/public reopening step, not yet. This removes signup inbox-ownership proof and implicitly confirms new addresses; document that accepted tradeoff. Do not mass-confirm or otherwise edit existing accounts.
6. [ ] Replace ONLY the **Reset Password** email template with `../templates/recovery-email-otp.html`, preserving an approved subject. It must display `{{ .Token }}` as six digits, with no confirmation/reset link. Do not edit Magic Link, email change, invitation or signup templates unnecessarily. Confirm OTP length 6, approved expiry and resend limits. Inspect existing Brevo configuration; do not change credentials without a separate approved need.
7. [ ] Deploy the prepared no-signup-OTP frontend artifacts for User AND Admin. The shared recovery component changed in both. Confirm environment/project match and release asset hashes, invalidate old HTML caches and require stale tabs to reload. Retain rollback artifacts; do not delete database history.
8. [ ] Verify existing-account login and authorized recovery first while new signups remain gated. Open signups only under an approved controlled tester gate for actual registration smoke tests. If the platform has no tester-only gate, use an explicitly approved short monitored opening with the ability to close signups immediately; do not bypass account protections with service-role test creation as a substitute for the real signup path.
9. [ ] Complete the acceptance checks below, reopen normal signup/recovery traffic and monitor Auth/database/Brevo errors, delivery/rate-limit logs and administrator queue behavior. Record final settings, migration success and actual results. Roll back or keep the affected entry points gated on a critical failure.

## Acceptance checks before declaring success

Use real controlled inboxes and ordinary browser signup/login. Do not modify other users' accounts or share OTPs/tokens in logs. Use approved test accounts; keep their data for audit unless cleanup is separately authorized.

### New User and Owner registration

- [ ] Register a new User/Renter and Owner/Landlord with their actual inboxes. No signup OTP page, code request or signup confirmation email should block creation. An Auth password session and exactly one correctly mapped profile must exist per signup; metadata/role must be correct and the initial profile must be not_submitted.
- [ ] Submit the required government ID and selfie. Confirm private upload access and one versioned Pending submission/admin queue entry. Missing/invalid documents and unauthorized document reads must fail. Upload failure must allow retry without creating another account.
- [ ] Retry the same normalized email in both roles and an existing phone number. No duplicate Auth account/profile should be created. Check whitespace/case normalization and ambiguous network failures without interpreting protected Auth responses as successful signup.
- [ ] Confirm Pending accounts retain existing posting/member restrictions. Email auto-confirmation must not bypass administrator approval. Confirm ordinary email/password login requires no OTP.

### Administrator decisions and existing functionality

- [ ] As a non-admin, attempt direct approval and protected review writes; they must remain forbidden.
- [ ] As an admin, approve one valid submission and reject another with a reason. Check revision handling, notifications and correct approved/rejected permissions. Repeat/stale decisions must not produce duplicate approval effects.
- [ ] Verify an existing approved, pending/rejected and suspended account behaves as before. No role, document, suspension or approval timestamps should change merely because of this migration.
- [ ] Check existing User/Owner dashboards, listing/roommate-post visibility/moderation, messaging, private documents and administrator features. Recovering a password must not alter any of these states.

### Forgot Password recovery

- [ ] For both roles, request recovery at actual controlled Gmail/Yahoo/Outlook inboxes (cover all providers across the test matrix). Confirm the six-digit Reset Password code arrives at the entered registered address and record delivery/log evidence without exposing the code.
- [ ] Use an unknown email: show the same conditional request message and no account lookup disclosure. Check known/unknown error paths and shared rate-limit behavior; do not claim constant-time guarantees from UI messages alone.
- [ ] Test incorrect, expired and reused codes; none may unlock password updates. Re-request after the cooldown, test server limits, and use the latest valid code. Email-code lifetime follows the actual live setting, not an assumed five-minute value.
- [ ] Verify with type recovery and confirm the matching isolated session unlocks Reset Password. A normal login, page refresh, expired reset window, cancelled flow or mismatched session must not independently unlock this UI. No recovery token should be persisted into the main session/sessionStorage.
- [ ] Test password mismatch, weak password and configured server policy. A valid update changes only the intended account's password; role/approval/suspension/content remain unchanged.
- [ ] Confirm sign-out and return to Login. Test the new password succeeds and old password fails for the controlled account. Do not assert all issued access JWTs are immediately invalidated; check actual refresh-session revocation behavior separately.
- [ ] Verify existing shared administrator recovery still works. At 320/375/390/430px, check signup/document screens, both login screens, Forgot Password, OTP and Reset Password: no horizontal overflow, reachable buttons, scrolling, keyboard input/paste and errors/countdowns.

## Safe rollback procedure

Rollback is a separately approved coordinated operation, not an automatic action. Roll back on broken signup/profile creation, approval bypass, unauthorized password change, persistent recovery failures or other agreed critical regressions.

1. [ ] Gate new signups immediately at the approved Auth control and pause recovery entry points if their template/build is being changed. Leave ordinary login/dashboards available where safe. Record the interval in which no-OTP accounts were created and preserve logs/current state.
2. [ ] If the migration failed before commit, roll back its aborted transaction and verify both original attachments remain. Do NOT run restoration SQL merely because the operator saw an error; inspect the actual committed state first.
3. [ ] If retirement committed and restoration is approved, review retained table/functions against saved definitions, then run `registration_otp_retirement_rollback.sql` only in the gated window. It restores the two missing attachments using retained objects, retaining the corrected AFTER profile guard. It does not recreate the original migration, tables or functions, and never alters the profile-creation/protection triggers. Unexpected definitions cause it to stop rather than overwrite them. This newly prepared rollback text has not been SQL-tested/executed in this task; validate it in staging before release approval.
4. [ ] Restore the captured pre-release Confirm email/other changed Auth values and a compatible frontend/template combination while signup remains blocked. Preferred rollback keeps the working Supabase recovery and Token template with a tested fallback signup-OTP UI. Restore the old Reset Password template only if its paired fallback recovery implementation has independently passed real recovery tests. Do NOT restore the unavailable Flask path and call recovery healthy. Never reinstate Admin-Assisted Recovery Phase 1/2.
5. [ ] Run the existing read-only dependency/timing queries. Both restored OTP triggers must be enabled, profile email guard type 21 AFTER, enrollment type 5 AFTER, and profile creation/protection unchanged. Verify retained records/functions/ACLs/RLS and administrator decisions. Re-test controlled signup/email verification, documents/admin approval and the chosen recovery path before reopening.
6. [ ] Assess accounts created during the no-OTP window separately. Restoring enrollment triggers does NOT backfill them, and turning Confirm email back ON does NOT undo their auto-confirmed email timestamps. There is no safe automatic reversal of the lost inbox-ownership proof. Preserve these accounts and current statuses; obtain separate approval for any ownership-verification/remediation plan. Do not mass-unconfirm, delete, reapprove, insert enrollment rows or revert passwords as part of routine rollback.
7. [ ] Preserve successful password changes, messages, listings and other activity since deployment. Do not restore an old database snapshot as routine rollback; that could erase valid changes. Already-sent codes may need to be re-requested after restoring a compatible template/build. Keep signups closed if rollback acceptance cannot pass.
8. [ ] Reopen only after approved rollback checks pass, restore the captured signup-availability setting deliberately, and record the outcome. A database attachment rollback alone is not a complete frontend/Auth/template rollback.

## Go/no-go record

Release owner: __________  Approved project/release: __________
Dependency review complete: __________  Staging real-email evidence: __________
Approved settings/template diff: __________  Fallback build or maintenance agreement: __________
Migration result: __________  Production acceptance evidence: __________
Public reopening/rollback decision: __________

Nothing in this checklist grants execution approval. Current status remains NOT DEPLOYED by this task. Earlier local tests do not establish real Brevo delivery or real production password reset success.

Official references: [Supabase password Auth](https://supabase.com/docs/guides/auth/passwords), [email templates](https://supabase.com/docs/guides/auth/auth-email-templates), [sign-out behavior](https://supabase.com/docs/reference/javascript/auth-signout).
