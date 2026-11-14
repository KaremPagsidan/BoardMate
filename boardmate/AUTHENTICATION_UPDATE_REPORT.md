# Authentication update: signup without OTP, Supabase recovery OTP

Local implementation only. No live Supabase settings, templates, SMTP credentials, objects, accounts or passwords were changed. Real email delivery and real login following a reset are NOT verified. Deployment requires explicit approval.

## Inspection and behavior

Reviewed both signup entry points, login/session restore, Supabase client, duplicate validation, PasswordRecovery, Flask recovery, original OTP guard and timing correction, and actual local document-protection/submission/review definitions. The user previously confirmed the original OTP objects exist live, but full live definitions were not supplied. No connected Supabase/Brevo management access, live Auth config export or current Reset Password template is available. Live settings, template and sender configuration could not be inspected or changed.

The unavailable error came from /api/recovery/session on the separate Flask service. No current frontend recovery calls depend on Flask now. Both Vite recovery proxies were removed. Legacy server files and old migrations remain unused for history; no custom OTP database or administrator-assisted Phase 1/Phase 2 feature was added.

Registration: main signup accepts the immediate Auth session and continues to private ID/selfie document submission and administrator review. The alternate LoginForm creates an account and returns to Login for document submission. Roles, metadata, duplicates, private storage, document revisions, administrator approval, suspension, RLS and existing records remain intact. No registration OTP page, countdown, resend, routing or unconfirmed-login OTP diversion remains. With Confirm email still ON, a no-session signup reports a configuration mismatch instead of requesting an OTP or uploading unauthenticated. An account may have been created in that case; try signing in/contact the administrator before retrying registration.

Normal email/password login is unchanged and requires no OTP. Recovery entry points remain available for User and Owner; the existing shared administrator recovery component also uses the supported provider flow without new role-discovery endpoints.

Recovery calls resetPasswordForEmail(normalizedEmail), then verifyOtp({email,token,type:'recovery'}), then updateUser({password}). No account-availability or role lookup occurs in recovery. Unknown addresses and account-specific provider request errors receive the same conditional message; server 429 errors show a generic wait message. Transport failures use a generic connection/recovery error. A successful request response is not proof of delivery.

A separate client uses a unique storage key, persistSession:false, autoRefreshToken:false and detectSessionInUrl:false. Recovery does not restore/replace the normal dashboard session and tokens are not persisted. Only successful recovery OTP verification creates an in-memory proof bound to the returned user/email/token. Reset checks proof, token expiration, a maximum ten-minute post-verification window, getSession token and authenticated getUser identity/email. A normal existing login alone cannot unlock this reset flow. Passwords must match, have at least eight characters, fit within 72 UTF-8 bytes and satisfy the live Supabase policy. updateUser sends only password; no role, approval or other profile fields are changed.

After success, global recovery sign-out is attempted, with local cleanup fallback; the current browser app session is cleared and the caller returns to Login. This does not promise immediate invalidation of all outstanding access JWTs or successful remote revocation if global sign-out fails. Cancellation clears only the isolated recovery session. Reloading loses the recovery proof and requires another code.

The 60-second UI request/resend cooldown prevents accidental repeats/concurrency. Supabase enforces durable cross-device rate limits and code expiry. Resend uses resetPasswordForEmail again, never signup resend. No five-minute OTP expiry or five-attempt policy is invented by the UI. The ten-minute reset-form window is separate from the configured email-code lifetime.

## Security implications and required approved configuration

1. Turn Supabase Email provider **Confirm email OFF**, leaving email/password signup enabled. This project-wide switch makes newly registered emails implicitly confirmed WITHOUT inbox ownership proof. Someone may register another person's address first, creating a duplicate-address conflict. Administrator document review remains required but is not proof of inbox ownership. Later recovery OTP verifies inbox access for password recovery. This tradeoff follows from the requested signup behavior.
2. Do not bulk-confirm, delete, reapprove or rewrite existing accounts. Older unconfirmed accounts may need individual review if Auth still blocks their login. No existing confirmation timestamps are changed by this implementation.
3. Inspect the existing **Reset Password** email template. After approval, use `supabase/templates/recovery-email-otp.html`: six-digit `{{ .Token }}`, no reset/confirmation link. Use only the Reset Password template, not Confirm signup/Magic Link/email-change. The signup template can remain unused with confirmation OFF.
4. Confirm email OTP length **6**, choose/review OTP expiry (e.g. 600 seconds if approved), minimum send interval, project email quotas and Brevo limits. Align the UI cooldown if the live minimum is longer than 60 seconds. Do not disable existing abuse controls, CAPTCHA, secure password-change rules or other restrictions to force delivery. If CAPTCHA is enabled, its integration must be reviewed before deployment.
5. Inspect existing Brevo SMTP in Supabase: sender/domain verification, host/port/credentials, SPF/DKIM and sending permissions/quotas. Keep SMTP secrets server-side. The actual normalized entered email is sent to Supabase; no hardcoded inbox exists. No SMTP credentials were read or changed. Shared project template/limit changes may affect other clients.
6. Apply only the reviewed new migration below and deploy the updated frontend in a coordinated window. Running old signup OTP frontend with confirmation OFF, or new no-OTP frontend with confirmation ON, is unsupported. No live step is authorized by this report.

## Database artifacts and rollout

Forward migration: `supabase/migrations/20261113000002_remove_registration_email_otp_triggers.sql`.

It removes only `public.profiles.enforce_boardmate_email_before_review` (original BEFORE or corrected AFTER) and `auth.users.boardmate_require_signup_email`. It preserves the enrollment table/history, both functions, all accounts, policies, Auth profile-creation trigger, document/admin guards, suspension controls and notification/history triggers. It checks the expected OTP trigger bindings and required document/admin protection before removal. No data manipulation occurs. Lock timeout is 5 seconds, statement timeout 30 seconds; review and roll back a failed transaction before retrying. Do not rerun the original OTP migration or timing correction.

Read-only pre/post queries: `supabase/review/registration_without_otp_verification.sql`. Review complete live definitions first. After retirement all six summary booleans should be true. Query success alone does not prove live behavior. Keep old enrollment rows as historical data; no backfill, deletion or status remediation is performed.

Manual sequence after approval: inspect live configuration/definitions; test in staging; approve the concrete migration, Confirm email OFF, recovery template and any OTP/rate setting changes; deploy approved settings/migration/frontend together; run controlled-inbox acceptance. Existing listings, messages, roommate posts and admin data are untouched.

## Changed files

Modified application/configuration files:

- `src/App.jsx`: remove signup OTP routes/state and resume diversion; continue signup to documents; remove obsolete confirmation instructions; clear local profile on recovery completion.
- `src/components/LoginForm.jsx`: remove alternate signup OTP; return to Login after creation.
- `src/components/PasswordRecovery.jsx`: replace Flask/CSRF calls with Supabase recovery; three stages, countdown, verification/reset/cleanup and safe errors.
- `src/lib/registration.js`: accept immediate signup session while preserving duplicate/obfuscation checks.
- `src/lib/registrationErrors.js`: remove obsolete confirmation-link instructions.
- `src/supabaseClient.js`: isolated nonpersistent recovery client factory.
- `src/passwordRecovery.css`: explicit border-box sizing.
- `vite.config.js`, `vite.admin.config.js`: remove obsolete Flask recovery proxies.

Added `src/lib/passwordRecovery.js`, the forward migration/read-only query above, and `supabase/templates/recovery-email-otp.html`.

Removed unused registration OTP files: `src/components/RegistrationOtp.jsx`, `src/lib/registrationOtp.js`, `tests/registrationOtp.test.mjs`, `tests/registrationOtp.browser.mjs`, `tests/registrationOtp.html`, `tests/registrationOtpFixture.jsx`. Historical guard/timing database tests and migrations remain unchanged to validate historical installations independently.

Tests added: `tests/passwordRecovery.test.mjs`, `tests/registrationWithoutOtp.database.test.mjs`, `tests/authRecovery.browser.mjs`, `tests/authRecovery.html`, `tests/authRecoveryFixture.jsx`. Updated `tests/registrationDuplicates.test.mjs` for immediate signup sessions. Documentation: this report; superseded notice in `EMAIL_OTP_IMPLEMENTATION_REPORT.md`; legacy notice in `server/README.md`. Generated `dist/` and `dist-admin/` were rebuilt. Dependencies, manifests and lockfiles were unchanged.

## Validation

Targeted authentication/database regressions: **50 passed, 0 failed, 0 skipped**. Includes actual disposable PostgreSQL migration retirement, account/enrollment/function/unrelated-trigger preservation, User/Owner signup and document submission without confirmed email, administrator-only approval, malformed documents, forged approval restrictions, existing approval/rejection/suspension/RLS checks, duplicates and mocked recovery/password/login scenarios. Recovery tests cover incorrect/expired codes, resend/server limits, session expiry, mismatched user/email/token, ordinary-login rejection, password policy and cleanup. No production database connection is supported by these fixtures.

Both User/Admin production builds and changed-source/configuration ESLint passed. Existing Tailwind, dynamic-import and bundle-size warnings remain.

Initial full Node suite: 138 tests, 132 passed, 4 skipped (disposable Supabase not configured), 2 failed. Both failures are previously documented duplicate-message wording assertions in `tests/appNotifications.test.mjs`; those tests and `authErrors.js` were left unchanged. Two additional recovery security tests then passed in the targeted run. Final full-suite/browser results are appended below.

Initial browser pass: 28 auth screen/frame checks at 320/375/390/430px, including both role registration/login and all recovery stages, wrong-code handling and mocked password update/sign-out. Browser uses the real Supabase SDK with fake HTTP, not real Auth or email. Expanded checks add resend cooldown, password mismatch, server rate limiting and isolation from main session/storage. Chrome required approved execution outside the sandbox; stale Vite dependency loading caused one subsequent attempt to stall, so the harness now uses a disposable isolated cache.

## Acceptance still needed after approval

No real SMTP delivery, live OTP consumption/expiry, live password update or real new-password login was tested. Mocks cannot establish those facts. Validate actual controlled Gmail/Yahoo/Outlook inboxes for both roles, unknown-address privacy, wrong/expired/reused codes, resend limits, password policy/reset/new-vs-old login, session cleanup, duplicate signup, documents and admin approval, existing accounts, dashboards, messaging, listings, roommate posts and administrative operations. Review Supabase/Brevo logs and spam placement.

Official references: [password recovery](https://supabase.com/docs/guides/auth/passwords), [verifyOtp](https://supabase.com/docs/reference/javascript/auth-verifyotp), [email templates](https://supabase.com/docs/guides/auth/auth-email-templates), [signOut](https://supabase.com/docs/reference/javascript/auth-signout).

### Final browser result

Expanded browser run passed all 28 screen/frame checks at 320/375/390/430px, plus wrong/expired-code errors, a full resend cooldown and resend request, password mismatch, server 429 handling, SDK password update, recovery sign-out, and proof that the main client session stays null and no recovery token appears in sessionStorage. Test responses were mocked HTTP; no actual email was sent. The fixture now defers the existing external Tailwind script so a slow CDN cannot block the entire document; production asset loading was not changed. An isolated temporary Vite cache avoids cross-test stale dependencies. No GoTrue duplicate-storage-key warnings remain after assigning unique nonpersistent client keys.

The migration retirement test also covers original BEFORE and corrected AFTER guards, plus safe repeated retirement. Final full-suite summary is recorded below.

### Final full regression result

`node --test tests/*.test.mjs`: **142 total, 136 passed, 2 failed, 4 skipped**. The only failures remain the two pre-existing duplicate-email/phone message wording assertions in `tests/appNotifications.test.mjs`. All newly added signup retirement, recovery and security tests passed. The four skipped cases need a disposable local Supabase installation; no live test was substituted.

All live actions remain pending explicit approval: the two-trigger retirement migration, Confirm email OFF, Reset Password Token template and any approved OTP/rate-limit adjustments. No SMTP credential or database data change is proposed as part of this deployment.
