# Phase 1 recovery undo report

Completed 2026-11-12. This is a local source rollback only. No live Supabase,
SMTP, credentials, users, policies, records or authentication settings were changed.
No destructive Git commands were used.

## Scope and restoration evidence

Reviewed the Phase 1 implementation and deployment reports, Git status/history,
and the original session patches. Git tracks none of the application files, so
the earlier session record supplied the precise restoration source and inverse
hunks. No Phase 2 implementation or dependent code was found.

The Forgot Password component was recovered from the original restoration command,
preserving UTF-8 and CRLF bytes. Its SHA-256 is
`faeedf94da5411f5e29c5de1e61ce129e21779ba828a942774984f0fdd45c934`.
The rebuilt User assets match the recorded pre-Phase-1 names exactly:
`index-DOvUwNrS.js` and `index-BdQ4SN6k.css`.

Restored existing files (only historical Phase 1 hunks reversed):

- `src/components/PasswordRecovery.jsx`: original email, verification-code and new-password screens.
- `src/passwordRecovery.css`: original recovery styling, retaining prior phone-frame scrolling.
- `src/App.jsx`: original recovery completion handler and login return.
- `src/components/LoginForm.jsx`: original completion handler.
- `src/components/AdminDashboard.jsx`: removed request queue integration; restored existing recovery completion handler.
- `vite.config.js` and `vite.admin.config.js`: original local Flask recovery proxies.
- `package.json`: removed only the two Phase 1 test scripts; dependencies unchanged.
- `server/README.md`: removed only the Phase 1 notice.

Removed 18 Phase 1-only files:

- `src/components/RecoveryCaptcha.jsx`
- `src/components/AdminRecoveryRequests.jsx`
- `src/lib/recoveryRequests.js`
- `src/recoveryRequests.css`
- `supabase/functions/submit-password-recovery-request/index.ts`
- `supabase/functions/submit-password-recovery-request/handler.mjs`
- `supabase/functions/submit-password-recovery-request/deno.json`
- `supabase/review/password_recovery_phase1_preflight.sql`
- `supabase/review/password_recovery_phase1_postflight.sql`
- `supabase/review/password_recovery_requests_phase1.sql`
- `supabase/review/PASSWORD_RECOVERY_PHASE1.md`
- `supabase/review/PASSWORD_RECOVERY_PHASE1_REPORT.md`
- `supabase/review/PASSWORD_RECOVERY_PHASE1_DEPLOYMENT.md`
- `tests/recoveryRequests.test.mjs`
- `tests/recoveryRequests.browser.mjs`
- `tests/recoveryRequestsFixture.jsx`
- `tests/recoveryRequests.html`
- `.env.example` (Phase 1-created placeholders only; real `.env` untouched)

A before/after SHA-256 inventory confirms exactly these nine existing files
changed and these 18 files were removed; 200 other inventoried files remained
byte-for-byte unchanged. The inventory excludes generated builds, dependency
directories, Git metadata and runtime caches. No remaining application/test/SQL
references to the removed feature were found. Production build outputs were
regenerated. This report is the only new project file.

Preserved: Supabase client and existing authentication, registration and email
verification, administrator membership and approval logic, User/Owner dashboards,
messaging, listings, roommate posts, detail pages, media and mobile responsiveness,
legacy Flask service and its existing migration/tests, package lock and all shared
dependencies. No database migration was executed or reversed.

## Validation

- User and Admin production builds: passed; existing Tailwind directive,
  dynamic-import and bundle-size warnings remain.
- Application source lint: passed. Repository lint excluding generated
  `dist-admin/**` and installed `server/.venv/**`: passed. Plain `npm run lint`
  fails because its existing configuration scans those generated/vendor files;
  the unrelated lint configuration was preserved.
- Legacy recovery backend: 17 isolated tests passed, with disposable PostgreSQL
  and mocked SMTP; no live emails or password changes.
- Existing Node regressions: 116 tests, 110 passed, 4 skipped, 2 failed. The
  skipped cases require an explicit disposable local Supabase instance.
  Both failures are existing `appNotifications.test.mjs` assertions expecting
  different duplicate-email/phone wording from unchanged `authErrors.js`.
  Both files match their pre-undo hashes; they were preserved.
- UTF-8 source checks passed after recovering the original source directly,
  avoiding terminal-decoded text.
- Mobile browser checks: 84 cases passed at 320/375/390/430px and desktop/short
  frame sizes, including zoom, scrolling and Escape. The first attempt could
  not start Chrome in the sandbox; a later attempt encountered a stale Vite
  dependency cache. After refreshing only that generated cache, the complete
  local fixture suite passed.

Restoring the prior interface also restores its existing dependency on the
Flask `/api/recovery/*` backend. This rollback does not configure that backend or
fix its pre-existing unavailable-service error. Live recovery delivery remains
unverified; no service was deployed, started against production, or reconfigured.
