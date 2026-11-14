> Current navigation: ACCOUNT_VERIFICATION_SETTINGS_REPORT.md moves status and the authorized correction workflow exclusively into Settings & Privacy > Account Verification and removes the old banners/links and phone OTP UI. This earlier report records the previous implementation.

> Follow-up: VERIFICATION_RESUBMISSION_REPORT.md adds the now-authorized, separate rejected-account correction workflow and read-only history. Status viewing remains read-only; the earlier statement that no resubmission workflow exists is historical.

# Account Verification Status: read-only User and Owner interface

Implemented locally. No live Supabase changes, database migrations, account updates, Storage changes or document deletions were performed. Browser tests use mocked Supabase IO; database regressions use disposable local PostgreSQL.

## Root cause and correction

Both dashboard callbacks previously opened ACCOUNT_REVIEW, the same AccountReviewScreen used to upload documents. That component unconditionally mounted Government ID inputs, selfie upload/camera controls and replacement previews, with resubmission actions for rejected or legacy accounts. Hiding only a submit button would have left the wrong workflow accessible.

Both dashboards now route submitted accounts to the dedicated VERIFICATION_STATUS screen. The first-time route is available only when verification_status is not_submitted and there is no revision, document path or uploaded-document flag. AccountReviewScreen independently checks the same rule and falls back to the read-only view if a submitted account reaches the old route. Legacy Pending/Approved/Rejected accounts remain read-only even if their old paths/revisions/flags are missing.

The initial form no longer contains legacy/rejection/resubmission branches. The main App calls submitInitialVerificationDocuments, which re-reads the authenticated profile and rejects existing submissions BEFORE any Storage upload or submission write. Existing expected-revision handling and database guards still protect concurrent submissions. Initial failure can still be retried while no persisted submission exists. A successful initial submission replaces the upload UI with status information.

Dashboard notices now say View Verification Status for submitted states, including Rejected, rather than Update verification. Approved accounts also retain a visible status link. First-time accounts retain Submit verification documents. No separate resubmission workflow has been created or authorized.

## Status data and presentation

AccountVerificationStatus has no file inputs, camera, replacement previews, form, submit handler or upload/submission callback. It performs profile/submission SELECTs only on opening, Refresh status, focus/visibility changes and existing realtime profile updates. In-flight results are ignored after unmount or when superseded by another read.

It displays Pending/Approved/Rejected, the requested exact Pending/Approved messages, administrator feedback/rejection reason, submission and review dates, current account restrictions and Return to Dashboard. Rejected accounts are directed to contact the administrator; the page explicitly does not offer document resubmission. Existing suspension restrictions take precedence over approved-member guidance. Listings/posts still require their own moderation.

Submission dates come from boardmate_verification_submissions.submitted_at for the user's current verification_revision, filtered by BOTH user_id and revision. Review date/remarks use that same submission, with existing profile verified_at/verification_reason as available historical fallbacks. Account creation time is never presented as a submission date. Missing legacy dates say Not recorded; loading and read failures are shown explicitly. Dates use Asia/Manila. Administrator remarks are rendered as React text, not HTML.

The current submission's decision is used if an administrator reviews it between profile and submission reads. Profile realtime updates trigger a fresh status read. No document contents or signed Storage URLs are fetched by the status view.

## Preserved behavior and data

- Original private ID/selfie paths and files are never replaced/deleted by opening, refreshing or returning from status.
- No status action creates a verification revision/request or changes approval state.
- First-time registration/document upload remains available for User and Owner.
- Existing database RLS, immutable documents, versioned submission/review RPCs, administrator approval/rejection, suspension controls and content features are unchanged.
- The existing general/versioned submission helper remains for compatibility, but current App navigation uses only the guarded first-time entry point. Status never imports/calls either write helper. This change does not add a new database-wide ban or a future resubmission interface.
- Login, password recovery, User/Owner roles, listings, roommate posts, messaging and administrator features were not modified.

## Modified files

Existing files:

- src/App.jsx: submitted-account status route, shared routing decision for both dashboards, guarded first-time submission entry point.
- src/components/AccountReviewScreen.jsx: first-time-only uploads; defensive read-only fallback; remove replacement/resubmission UI and instructions.
- src/components/AccountVerificationNotice.jsx: correct status labels/actions for Pending/Approved/Rejected and initial accounts.
- src/lib/verification.js: first-time-only submission entry point with fresh profile validation; existing persistence/review logic retained.
- tests/verification.test.mjs: load the new helper dependency and test first-time submission restrictions/success.

New files:

- src/components/AccountVerificationStatus.jsx: read-only status page and refresh behavior.
- src/lib/verificationStatus.js: first-time eligibility/routing, SELECT-only metadata reads and date formatting.
- src/verificationStatus.css: scoped beige/white/charcoal/sage styling, long-text wrapping, frame-safe sizing and scrolling.
- tests/verificationStatus.test.mjs: routing, metadata dates, legacy records, wrong-account/revision and denied-read cases.
- tests/verificationStatus.browser.mjs, tests/verificationStatus.html, tests/verificationStatusFixture.jsx: actual App/dashboard navigation with mocked Supabase IO.
- This report. Generated dist/ and dist-admin/ assets were rebuilt.

No SQL migration, Supabase setting, policy, function or trigger change is required. Existing profile/submission SELECT grants and RLS are used. No new grants are added; if live reads are denied, the page shows an error rather than attempting a write or weakening access controls.

## Validation

Targeted Node/database tests: 51 passed, 0 failed, 0 skipped:

    node --test tests/verification.database.test.mjs tests/verificationStatus.test.mjs tests/verification.test.mjs tests/registration.database.test.mjs

Covers existing administrator approvals/rejections for both roles, immutable files, RLS, stale/concurrent decisions, initial upload success, and rejection of every already-submitted state before upload/write.

Changed-source ESLint passed. Both User and Admin production builds passed with the existing Tailwind, dynamic-import and bundle-size warnings.

Browser run passed:

- 30 cases: two roles x three submitted statuses x 320/375/390/430/1280px viewports.
- Actual User/Owner dashboard View Verification Status buttons and correct Return to Dashboard navigation.
- No file input, form, submit button, video/camera or canvas on status screens.
- Actual submission/review dates and administrator feedback, including long rejection text with no horizontal overflow.
- Opening and Refresh status issue SELECT calls only; original mocked profile/document paths remain byte-for-byte unchanged.
- Three legacy statuses with absent document metadata remain read-only and show unknown historical dates.
- Both roles' first-time verification workflows retain their two file inputs.
- Reload and reopening remain SELECT-only, with no browser runtime exceptions.

Chrome initially could not launch within the sandbox; the browser run passed after approved execution outside it. Supabase IO was mocked, so these checks do not claim live database verification. The existing database security suite ran against disposable in-memory PostgreSQL, not production.

The full regression result is appended below. Production smoke testing should still use a controlled submitted User and Owner to confirm live status metadata and the unchanged administrator review updates. No production write or deployment is authorized by this report.

### Full regression result

`node --test tests/*.test.mjs`: **148 total, 142 passed, 2 failed, 4 skipped**. The only failures are the previously documented duplicate-email/phone wording assertions in `tests/appNotifications.test.mjs` (lines 19 and 24). Those tests and unrelated authentication message code were not changed. All newly added status and initial-submission tests passed. The four skipped cases require an explicitly configured disposable local Supabase instance.
