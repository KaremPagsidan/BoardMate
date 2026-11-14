> Current navigation: ACCOUNT_VERIFICATION_SETTINGS_REPORT.md moves status and the authorized correction workflow exclusively into Settings & Privacy > Account Verification and removes the old banners/links and phone OTP UI. This earlier report records the previous implementation.

# Secure verification corrections and resubmission

Implemented locally for User/Renter and Owner/Landlord. No production SQL, deployment, account edits, Auth setting, SMTP/template or password-recovery changes were performed. The migration and preflight below are prepared for review only.

## Inspection and resulting workflow

Reviewed the existing versioned verification migration, original document locks and restrictive Storage policies, profile-protection trigger, submission/review RPCs, private history SELECT policy, applicant/admin notification mechanisms, dashboard notification routing, read-only status page, and administrator rejection dialog. Full live schema/function definitions remain unverified beyond prior user-supplied trigger inspections; the review preflight must be run against the intended project before approval.

Existing infrastructure already stores snapshots and document paths per revision and prevents referenced-file changes. Gaps were: ordinary identity edits could implicitly start another review; the old submission RPC permitted replacements while Pending/Approved; history decisions lacked a dedicated immutability trigger; and no separate correction UI existed.

An administrator now uses the account verification rejection/correction dialog to specify requested changes. A rejection stores the reason and review date, sends an in-app applicant notification, and exposes **Edit and Resubmit Verification** on the status page. Clicking a profile review notification opens verification status in both dashboards. The status page itself remains a read-only summary/history; editing happens only in a separate correction screen.

That screen loads the current rejected profile, checks database-feature readiness and suspension, displays feedback/review date, and permits correction of full name, phone, gender, birth date and applicable owner business/address/ID/property fields. Email, role, approval, suspension and account identity are not editable. This workflow requires both a replacement Government ID and selfie, with the existing crop/preview/camera experience. Cancel does not save personal information or create a submission.

On submit, authentication and the latest profile/revision are checked again before uploads. Replacement files use fresh owner-folder UUID paths with upsert:false. The dedicated RPC locks the caller's profile and atomically validates rejection, expected revision, identity whitelist/typed values, both private replacement documents, and absence of another Pending request. It records the corrected snapshot and files as a new revision, updates the profile to Pending and reopens the existing administrator review notification. No correction is saved independently before submission.

Only administrators can approve/reject the current Pending revision through the existing review RPC. Further corrections are possible after another rejection; Pending/Approved applicants cannot resubmit or edit reviewed identity through ordinary profile updates. Posting/member restrictions remain active until approval through the existing unchanged RLS/application checks.

## History, notifications and documents

Prior submitted snapshots, dates, decisions and administrator remarks remain read-only. Applicant status and administrator review/directory screens expose review history. Old/new ID and selfie previews use individually requested private signed URLs valid for five minutes, checked by the existing Storage RLS; no public document URLs are created. Historical paths are never overwritten or deleted during resubmission. Upload failures clean up only uncommitted temporary replacements; ambiguous/lost responses re-read the current profile before cleanup and preserve committed files. Existing database path locks also prevent a cleanup attempt from deleting referenced history.

For a legacy rejected account with no versioned review, the new revision stores a server-created previous_review JSON snapshot of the old identity, reason, review date and old document paths. Unknown historical dates remain unknown. Existing records are not backfilled or rewritten.

Applicant notifications are in-app BoardMate notifications, not email/SMS. Each real Pending -> Approved/Rejected decision inserts one targeted profile notification; rejection includes actionable feedback and Philippine review time. Existing frontend notification subscriptions continue to apply to pending/rejected accounts. The existing admin queue notification is reopened for the new revision in the same transaction. Realtime delivery depends on the project's existing publication configuration; preflight includes a publication check. No new email service, Auth/SMTP setting or password-recovery mechanism is involved.

## Reviewed migration (NOT applied live)

`supabase/migrations/20261113000003_verification_resubmission.sql`:

- Requires trusted postgres execution, the existing versioned workflow, routing columns, RLS and immutable Storage protection.
- Adds nullable previous_review to existing submissions; no existing snapshots/remarks are updated.
- Adds a partial unique index enforcing at most one Pending submission per account. Multiple existing Pending rows cause the entire transaction to stop for manual review; no automatic history cleanup occurs.
- Replaces the profile-protection function to freeze already-reviewed identity outside an atomic rejected-account resubmission and reject revisions originating from Pending/Approved profiles. Ordinary approved/pending identity edits now fail explicitly rather than silently starting a review.
- Restricts the existing submission RPC to first-time unsubmitted accounts; clients must use the new correction RPC for rejection resubmission.
- Adds authenticated self-only resubmit_boardmate_verification(text,text,uuid,jsonb), with no caller-selected target account ID. Role/email/protected-field injection is rejected. Enum-backed gender/property fields are normalized to existing enum labels.
- Adds an immutable-history UPDATE/DELETE trigger: only the authorized first decision on a Pending row is allowed; snapshots, paths, prior remarks and approved/rejected decisions cannot be rewritten. Existing trusted service-role account purge and reviewer-FK clearing remain supported.
- Replaces only the profile-review notification attachment with a dedicated decision notification function. Shared listing/post/like notification functions are not replaced. The existing admin-submission notification trigger remains unchanged.
- Adds a readiness RPC so the frontend fails closed before uploading if migration/private storage is unavailable.
- Uses trusted ownership, empty search_path and explicit restricted function grants. Existing RLS policies, table grants, administrator membership, suspension protections, document Storage rules, roles and Auth accounts are retained.

Read-only pre/post review: `supabase/review/verification_resubmission_preflight.sql`. It inspects required objects, duplicate/orphan Pending revisions, live trigger/function definitions/ACLs/RLS, column types, private bucket and realtime publication. It was prepared but not run live.

Review all custom live dependencies first. A lone orphan Pending history row can still block a rejected account's next request even if no duplicate index violation exists; resolve such cases through a separately approved data-review plan, never by silently deleting or rewriting history. The migration is transactional and uses 5-second lock/60-second statement timeouts. It is forward-only and not intended for blind reruns.

If the old registration email guard is still active, its existing confirmation restriction remains effective; this migration does not remove or bypass it. Coordinate with the actual deployed authentication state rather than assuming prior local Auth changes are live.

## Changed files

New production files:

- src/components/VerificationResubmission.jsx: separate rejected-only correction form, file selection, validation, submission and cancellation.
- src/components/VerificationHistory.jsx: paginated read-only snapshots/decisions/legacy feedback for applicants/admins.
- src/components/VerificationDocumentLink.jsx: on-demand RLS-authorized private history previews.
- src/lib/verificationCorrections.js: correction whitelist/validation and filtered history reads.
- The reviewed migration and read-only preflight SQL above.

Modified application files:

- src/App.jsx: correction routing and corrected-profile/Pending result handling.
- src/components/AccountVerificationStatus.jsx: rejected-only correction entry point, retained reason/date and read-only history.
- src/components/AccountReviewScreen.jsx: pass the authorized correction callback through its defensive status fallback.
- src/components/AccountVerificationNotice.jsx: guidance for rejected applicants.
- src/components/AdminDashboard.jsx: specific correction-feedback instructions and review-history access in verification queue and user directory.
- src/components/RenterDashboard.jsx, src/components/OwnerDashboard.jsx: profile decision notification opens verification status.
- src/lib/verification.js: fresh-profile/readiness checks, correction RPC, UUID uploads and existing lost-response/cleanup safeguards.
- src/verificationStatus.css: scoped responsive correction/history styling, shared with admin history.

Tests: new verificationResubmission.database.test.mjs, verificationCorrections.test.mjs, verificationResubmission.browser.mjs; updated verification.test.mjs, verificationStatusFixture.jsx and verificationStatus.browser.mjs (mock support/isolated Chrome debugging port). All are under tests/. Documentation: this report and a historical note on ACCOUNT_VERIFICATION_STATUS_REPORT.md. Generated User/Admin build artifacts were regenerated. No dependencies, package manifests, Auth client, recovery implementation, listings, messages or roommate-post logic were changed.

## Validation and limits

Targeted verification/correction/history/recovery tests: **40 passed, 0 failed, 0 skipped** after final SQL prerequisite checks. Actual new migration was executed only against disposable in-memory PostgreSQL.

Database coverage includes rejection and feedback notification for both roles; atomic corrected identity + replacement paths + Pending revision; new admin notification; approval and repeated rejection/correction; stale decisions/revisions; duplicate-Pending index; denial of role/email injection, missing/invalid personal data, reused/foreign paths, suspended applicants and ordinary/non-admin review; original-file preservation even after it leaves the active profile; immutable reviewed remarks; unrelated-account history/notification denial; preservation of legacy feedback and existing profiles; and whole-transaction rollback on notification failure. Existing RLS/storage controls remain installed in the fixture. Tests serialize operations in PGlite; real multi-connection races still require staging validation.

Client tests cover readiness failure before uploads, Pending/Approved/stale/suspended eligibility, missing replacement files, correction validation, filtered history pagination, separate upload paths and recovery from a lost successful response. Password recovery regressions passed without source changes.

Browser correction run passed **10 role/viewport cases**: two roles x 320/375/390/430/1280px. Uses the actual App/dashboard/status/correction components with mocked Supabase IO. It accepts the real crop dialogs, corrects personal information, uploads both replacements once, preserves old history, returns to Pending, hides further correction controls, and fails closed when the migration is unavailable. This does not establish actual live Storage/realtime delivery.

The first browser attempt correctly encountered the existing crop confirmations; the test harness was updated to accept them before submission. Chrome needed approved execution outside the sandbox. A separate read-only browser regression encountered stalled fixture loading; the harness now uses a unique debugging port to avoid stale browser attachment. Its final result is recorded below.

Both production builds and changed-source lint passed, with existing Tailwind, chunk-size and dynamic-import warnings. Full Node regression suite: **161 total, 155 passed, 2 failed, 4 skipped**. The only failures remain the documented email/phone wording assertions in appNotifications.test.mjs; those tests/message implementation were not modified. Four tests require a disposable local Supabase instance and were not replaced with production access.

## Deployment and rollback review

1. Inspect current live dependencies using the read-only preflight and save the actual definitions/ACLs and release artifacts. Resolve incompatible schemas, duplicate/orphan Pending history and unknown notification aliases before proceeding.
2. Apply the reviewed migration only after explicit approval, first in staging. Do not apply a pending migration bundle indiscriminately or change Auth/SMTP settings as part of this feature.
3. Validate the full User/Owner rejection -> feedback -> correction -> Pending -> administrator decision cycle, old private document access, history immutability, unique pending behavior with separate concurrent sessions, phone uniqueness, enum-backed schemas, in-app/realtime notices, posting restrictions and account deletion on a disposable/staging project.
4. After production approval, pause correction submissions during migration/release, apply only this migration, wait for PostgREST schema reload, then deploy both User and Admin bundles. Keep ordinary password login/recovery intact. Verify readiness with an authenticated controlled account and repeat approved production smoke tests.
5. On failure, close only the correction entry point and preserve all new revisions, files, decisions, passwords and content. Do not drop the new history column/index, remove original files, rewrite submitted snapshots or revert to the earlier broad replacement RPC automatically. The new first-time-only/immutable protections can remain while the UI is disabled. A function-level rollback must be a separately reviewed forward fix based on saved definitions and new history; reverting old permissive behavior would reopen the bypasses this feature closes.

No migration, live testing or deployment is authorized by this report. Live Supabase behavior, realtime delivery, SMTP/email and live account changes were not tested during implementation.

### Final status regression

The isolated-port status browser rerun passed all 30 User/Owner x Pending/Approved/Rejected x mobile/desktop cases, plus three legacy states, first-time upload availability for both roles, SELECT-only refresh/reload behavior and correct dashboard return. The temporary blank-fixture attempts were test-harness/browser-loading failures, not accepted passes. No real Supabase IO occurred in browser tests.
