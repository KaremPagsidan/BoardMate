# Account verification in Settings & Privacy only

Implemented locally for User/Renter and Owner/Landlord. No production SQL, deployment, Auth/SMTP setting, account/profile record or verification document was changed. Email OTP password recovery and the authentication client were not modified.

## Result and root-cause fix

The recurring account banners came from AccountVerificationNotice mounted globally in RenterDashboard and in multiple OwnerDashboard tabs, including extra Home, Messages and Profile copies. All mounts/imports and the unused component are removed. Own-account approval badges and permanent VERIFICATION REQUIRED publish-button text were also removed. Public content moderation labels, suspension controls and unrelated listing/post behavior are retained.

Settings & Privacy now has an Account Verification tab for both roles. It hosts the existing current status, submission/review dates, administrator remarks and read-only review history. Approved accounts remain read-only. Rejected accounts can enter the existing separately authorized correction/resubmission form inside this same settings section; its database readiness and eligibility checks remain intact. Missing history dates still say Not recorded.

There are no standalone status/resubmission routes or dashboard View Verification Status links. Both notification destinations and correction returns select the Account Verification settings panel. Back to Settings returns to the general settings panel; the portal Back control returns to the correct dashboard.

Registration still uses the same Auth signup, duplicate validation, selected ID/selfie and initial submission API. Only post-submission navigation now opens the settings section instead of a standalone status view. Normal login/session restore goes to the dashboard; an existing account that still needs its first documents can complete them through Settings. No Auth confirmation settings, recovery flow, registration fields or server verification requirements were changed.

Posting and sending messages retain their approval checks. An unapproved applicant attempting a protected action gets a short dismissible message directing them to Settings & Privacy > Account Verification, without automatic redirection or a permanent banner. Existing backend-denied likes/favourites/ratings use the same contextual guidance for unapproved accounts; their API authorization is not changed. The publish action can be pressed to obtain guidance, but its existing approval guard returns before writing/uploading. Server RLS and approval controls remain authoritative.

## Phone verification removal

Removed the Phone tab, linked-phone lookup effect, phone OTP state, phone-change verification handlers and all phone code request/entry forms from the shared settings UI. Stale initialSection=phone values fall back to general settings rather than reviving the old tab. No phone-related Auth update/verify call remains in that component.

Existing Auth-linked phone values and profile contact numbers were not altered. Registration and profile editing still contain their normal phone-number fields; browser tests confirm the displayed/editable contact value remains available. The Send verification code button in Forgot Password remains intentionally unchanged: it is email recovery, not phone verification.

## Decision notifications and reviewed database draft

Existing account decision notifications, including recognized older notices, now link directly to Settings & Privacy with Account Verification selected. NotificationCard displays an explicit destination and wraps long remarks. Other listing/post/report destinations remain unchanged.

Draft migration: `supabase/migrations/20261113000004_account_verification_settings_notifications.sql`.

It changes only notification infrastructure:

- Adds nullable verification_event_key metadata and a unique index for one notice per account/revision/decision. Existing notification contents are not backfilled, deleted or rewritten.
- Adds a narrow guard against changing that event identity while preserving ordinary read/unread/hide/delete operations under existing permissions.
- Creates a private trusted notification producer with decision, administrator remarks, Philippine review date and the settings destination. Existing profile target routing is retained for compatibility.
- Replaces only notify_boardmate_profile_review's decision-notification attachment. It does not replace shared marketplace notification functions, approval/submission RPCs, profile/document protection, roles or any RLS policy.
- Produces Approved and Rejected/corrections-requested notices on actual status changes. The current correction request workflow still uses rejection with specific feedback; no new decision type or approval rule is introduced.
- Checks trusted ownership/RLS/destination prerequisites and stops for review if known duplicate/custom producer attachments are found. Uses a transaction and bounded lock/statement timeouts. It is a forward migration, not a script to rerun blindly.

Read-only preflight: `supabase/review/account_verification_settings_notifications_preflight.sql`. Review current notification RLS, grants, producer attachments, core security definitions, schema and realtime publication before approving any migration. The live policies/SMTP settings were not queried by this task. Existing older notices already work with the new frontend destination; durable new event-key deduplication requires the reviewed migration.

No approval workflow or historical notification deduplication is performed automatically. If a live policy exposes other accounts' notices, stop and request a separately approved correction; this task does not silently rewrite existing RLS. Confirm which prior migrations are actually installed, rather than applying all pending drafts. If the earlier resubmission draft is also being deployed, arrange reviewed migrations so this notification producer is the final attachment; a later producer-replacing migration needs its own forward compatibility review.

## Changed files

Application:

- src/App.jsx: remove standalone verification screens, pass settings/initial-submission context, route initial completion into settings, preserve Auth/document calls.
- src/components/AccountToolsDialog.jsx: Account Verification panel; remove phone OTP UI/state/handlers/lookup; responsive tab navigation.
- src/components/AccountVerificationSettings.jsx (new): compose first-time documents, read-only status and authorized corrections within settings.
- src/components/AccountVerificationStatus.jsx: embedded rendering/back-label support; existing status reads/history retained.
- src/components/VerificationResubmission.jsx: embedded rendering support; existing submission/auth checks retained.
- src/components/AccountReviewScreen.jsx: settings back-label support and no standalone submitted-status fallback.
- src/components/RenterDashboard.jsx, src/components/OwnerDashboard.jsx: remove banners/own status badges, settings destinations, contextual action guidance and accessible menu/create controls.
- src/components/NotificationCard.jsx: explicit settings destination and safe wrapping.
- src/lib/verificationSettings.js (new): notification recognition, UI guidance, correction result mapping.
- src/lib/verificationStatus.js: remove obsolete standalone screen-routing helper; eligibility/status/date logic retained.
- src/lib/verification.js: update first-time guard guidance to point to settings; no persistence logic changes.
- src/verificationStatus.css: responsive settings tabs and embedded panel styling.
- src/components/AccountVerificationNotice.jsx: removed.

Database review artifacts: the migration and preflight above. No older migration or RLS definition was modified.

Tests: new tests/verificationSettings.database.test.mjs, tests/verificationSettings.test.mjs and tests/verificationSettings.browser.mjs. Updated tests/verificationStatus.test.mjs, tests/verificationStatus.browser.mjs, tests/verificationResubmission.browser.mjs and tests/verificationStatusFixture.jsx for settings navigation, notifications, contact data and mocked existing preferences behavior. New tests/localBrowserStyles.mjs serves the same public Tailwind runtime from a temporary test cache to avoid CDN stalls; production style loading and dependencies were not changed.

Documentation: this report and a superseding location note in the earlier status/resubmission reports. Generated dist/ and dist-admin/ outputs rebuilt. Package manifests, dependencies, authentication.js, supabaseClient.js, password recovery, administrator review code, verification SQL security controls, messaging/listing/post backend logic and user records were not changed.

## Validation

Browser checks passed using the actual App/User/Owner/settings components with mocked Supabase IO:

- 30 Settings cases: two roles x Pending/Approved/Rejected x 320/375/390/430/1280px.
- 150 banner-free page checks across Home, Listings/Favourites, Messages, Profile and renter Accommodation Search/Roommate Finder.
- Correct verification panel and decision notification destination for every role/status; no Phone tab/code forms or phone Auth calls.
- Rejected-only correction entry point, Approved read-only view, contextual restricted publishing feedback, and unchanged contact number display/edit field.
- Settings/tab layout stays inside phone frames without horizontal overflow; original profile/document metadata unchanged by viewing/refreshing.
- The adapted status regression passed another 30 role/status/viewport cases, legacy records, first-time document controls, refresh/reload and dashboard return.
- The adapted correction regression passed 10 role/viewport cases with real image-crop confirmation, separate replacement documents, immutable prior history, Pending transition and missing-migration fail-closed behavior, all within settings.

Notification SQL tests run only against disposable PGlite PostgreSQL. They cover User/Owner approval/rejection, feedback/date/destination, duplicated producer events creating one notice, separate revision events, no notice for unchanged Pending status, own-only SELECT/UPDATE, immutable event identity, normal read/unread updates, and preservation of existing account/profile rows, RLS definitions and core verification function definitions. No live SQL was executed.

Existing preferences can autosave under the original dashboard/settings behavior; the browser mock permits that unrelated existing operation. Claims of read-only verification mean no profile/document/submission writes from viewing status, not that every existing settings operation is a SELECT.

Email recovery regression tests passed without source changes. Builds and changed-source lint passed with the existing Tailwind, dynamic-import and bundle-size warnings. Initial browser attempts encountered sandbox/remote-script loading and mock coverage problems; only completed successful reruns are reported as passes.

Final full-suite results are appended below. Live realtime delivery, live notification RLS and production settings integration still need staging/approved production smoke checks. No real emails or real account/password changes were used in this task.

## Deployment boundary and rollback

Review the notification-only migration/preflight and installed producer definitions first. Test the actual live schema in staging, including any existing correction workflow, notification ownership, duplicate events, ordinary mark-read/hide/delete, mobile layouts and unchanged posting restrictions. Deploy the prepared User/Admin artifacts only after approval; do not modify Auth confirmation, phone provider, SMTP or password recovery settings for this task.

If a rollback is needed, preserve all account/document/submission data and new notifications. Restore a saved notification producer attachment only through a separately reviewed forward correction; keep metadata/index history rather than deleting rows or dropping account tables. Do not automatically deploy older registration/recovery migrations to reverse this presentation change.

## Final regression totals

Full local suite: 170 tests; 164 passed, 2 failed, 4 skipped. The two failures are existing duplicate email/phone wording assertions in tests/appNotifications.test.mjs. The four skips require a disposable local Supabase environment. All new Settings, notification database security and helper tests passed. Browser results are recorded above. No production SQL, Auth settings, SMTP settings or deployments were applied.

