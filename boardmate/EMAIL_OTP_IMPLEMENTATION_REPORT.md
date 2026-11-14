> Superseded by AUTHENTICATION_UPDATE_REPORT.md: registration OTP has been removed locally; recovery now uses Supabase Auth OTP. This document records the earlier implementation, not current deployment instructions.

# Registration email OTP implementation

Local implementation only. No live Auth settings, SMTP credentials, templates, users, or database records were changed. No real email delivery was tested.

## Inspection and configuration required before deployment

Reviewed the Supabase client, both signup entry points, duplicate validation RPC/migration, private document submission and administrator review workflow, recovery rollback report, and recovery service documentation. The repository has no Supabase config.toml or signup email template. No connected Supabase/Brevo management tool or management credentials were available; live settings, templates, sender verification, and Brevo SMTP configuration could not be inspected. The existing recovery service is separate and was left unchanged.

With owner approval, inspect in the Supabase dashboard and confirm:

1. Email/password signup and Confirm email are enabled. Auto-confirm must be off. The new frontend rejects an immediate signup session and signs it out.
2. Existing custom Brevo SMTP is enabled with the intended verified sender, correct SMTP host/port/credentials, and provider sending limits. Do not place SMTP secrets in frontend environment variables. Verify sender/domain authentication and delivery logs.
3. The **Confirm signup** template displays `{{ .Token }}` as the six-digit code and addresses the actual Auth email recipient. Remove the confirmation URL/link from this signup template to use the single OTP mechanism. Do not alter recovery, magic-link, email-change, or reauthentication templates.
4. Configure email OTP length to six digits, confirm the desired OTP expiry, and review Supabase email rate limits. This screen uses the server's expiry decision, not an invented client validity deadline. Resends have a 60-second UI cooldown; Supabase enforces the actual durable server limits across tabs/devices. If the configured minimum interval is longer, align the UI delay before deployment.
5. Review and manually apply `supabase/migrations/20261113000000_registration_email_otp_guard.sql` after the existing registration/verification migrations and before frontend release. New Auth accounts are enrolled in a protected table; pending/approved profile transitions require Auth email confirmation. Existing accounts are deliberately exempt and unchanged. The guard supplements existing role, document revision, RLS and admin checks; it does not grant approval.

Supabase references: https://supabase.com/docs/guides/auth/auth-email-templates and https://supabase.com/docs/guides/auth/auth-email-passwordless . Implementation retains password signup, verifies with `verifyOtp({email,token,type:'email'})`, and resends with `resend({type:'signup',email})`. No signInWithOtp, custom OTP store, or new recovery path was added.

## Behavior

Both User/Owner signup entry points open the responsive OTP screen. Only verified Auth responses with a matching email and session can continue. The main flow retains selected files in memory and submits them after explicit successful verification; an interrupted flow can resume through email/password login's email_not_confirmed response and return to sign in after verification. It does not re-register the account. Reloading requires signing in to resume and selecting documents again. Ordinary confirmed email/password login remains unchanged and requires no OTP.

Existing duplicate RPC validation and database uniqueness remain authoritative. Empty identities from an obfuscated Auth signup response are handled as an ambiguous registration failure, never claimed to mean an email was delivered. The existing boolean availability RPC already reveals availability; this change adds no new lookup endpoint or account data exposure.

Forgot Password, the Flask service, and its migration were not modified. Neither Admin-Assisted Recovery Phase 1 nor Phase 2 was restored. No email-based password reset API was added or enabled.

## Changed source and added artifacts

- `src/App.jsx`: OTP routing, continuation to existing document submission, unconfirmed login resumption.
- `src/components/LoginForm.jsx`: same OTP requirement for alternate signup entry point.
- `src/lib/registration.js`: obfuscated response handling and auto-confirm configuration guard.
- `src/components/RegistrationOtp.jsx`: responsive six-digit input, countdown, resend, error and success states.
- `src/lib/registrationOtp.js`: supported Supabase verification/resend calls and error mapping.
- `supabase/migrations/20261113000000_registration_email_otp_guard.sql`: reviewed locally, NOT applied live.
- `tests/registrationOtp.test.mjs`, `tests/registrationOtp.database.test.mjs`: mocked Auth and disposable PostgreSQL checks.
- `tests/registrationOtp.browser.mjs`, `tests/registrationOtp.html`, `tests/registrationOtpFixture.jsx`: local smartphone frame checks.
- This report. Production `dist` and `dist-admin` artifacts regenerated by builds.

## Validation

Initial targeted registration/verification regression run: 67 tests, 63 passed, 4 explicitly skipped (disposable local Supabase not configured). New database guard test: passed, covering unconfirmed pending/approved rejection, confirmed pending transition, legacy preservation, and protected enrollment records. New Auth unit tests cover exact normalized recipient, six-digit validation, matching confirmed session, incorrect/expired errors, server resend limits, obfuscated duplicates, and auto-confirm rejection.

User and administrator builds passed with existing Tailwind, chunk size, and dynamic import warnings. Lint of changed application files passed. Browser checks passed at 320, 375, 390 and 430px: OTP input stays inside the smartphone frame, no horizontal page overflow, resend countdown visible, and no browser exceptions. Chrome initially could not launch within the sandbox; the same test passed after approved execution outside it.

Full Node suite: 120 tests, 114 passed, 4 skipped, 2 failed. Both failures are the pre-existing email/phone message wording assertions in `tests/appNotifications.test.mjs`, also recorded in `PHASE1_RECOVERY_UNDO_REPORT.md`. The implementation does not modify those tests or `authErrors.js`. All registration/OTP/database-guard tests passed. Final application build and changed-source lint passed after the interrupted-registration continuation adjustment.

## Live acceptance still required

After approved configuration and staging deployment, use actual controlled Gmail, Yahoo and Outlook inboxes for User and Owner: receive the six-digit code at the entered address, verify it, confirm a reused/wrong/expired code fails, resend after cooldown, test server rate limits, interrupt/reload/resume, and attempt duplicate registrations across roles. Confirm no unverified submission enters admin review and only an administrator can approve a verified document submission. Check existing confirmed accounts, password login, current Forgot Password, both dashboards, messaging, listings, roommate posts and admin decisions. Inspect Supabase/Brevo delivery logs and spam placement. Local mocked tests do not establish SMTP delivery or provider acceptance.
