> Legacy service retained for history. The current BoardMate frontend uses Supabase Auth recovery OTP through the configured SMTP provider and no longer calls this Flask service. Do not deploy this service for the current recovery flow. See `../AUTHENTICATION_UPDATE_REPORT.md` for the approved-change checklist.

# BoardMate SMTP password recovery

This service adds email → 6-digit OTP → new password to the existing React/Supabase login. It applies to confirmed email/password accounts of every role, including administrators; it never changes profile verification, suspension, roles, or existing content. There are no email-provider HTTP APIs or Supabase Auth HTTP calls in this recovery flow. Flask connects directly to PostgreSQL; Python `smtplib` sends through Gmail with STARTTLS.

The current checkout contained React/Vite, Supabase client authentication, a dormant user “Forgot password?” button, and an administrator Supabase reset-link handler. It had no Python backend or private database credentials. Repository migrations were inspected; live Auth schema inspection and real Gmail delivery were **not** performed. At the user's request, tests use a disposable PostgreSQL engine instead.

## 1. Install in VS Code / PowerShell

From the `boardmate` directory (Python 3.11+ and Node.js required):

```powershell
python -m venv server/.venv
server/.venv/Scripts/python.exe -m pip install -r server/requirements.lock.txt
Copy-Item server/.env.example server/.env
```

The virtual environment is already installed in this workspace. `requirements.txt` lists supported dependency ranges; `requirements.lock.txt` records the versions tested here. Keep `.env`, `.venv`, and SMTP credentials out of Git. Only frontend public Supabase values belong in the existing root `.env`; never give backend secrets a `VITE_` prefix.

Generate **two different** secrets with the first command, and a Fernet key with the second. Copy the values into `server/.env`, or use your deployment secret manager:

```powershell
server/.venv/Scripts/python.exe -c "import secrets; print(secrets.token_urlsafe(48)); print(secrets.token_urlsafe(48))"
server/.venv/Scripts/python.exe -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Set `FLASK_SECRET_KEY`, `OTP_HMAC_KEY`, `OTP_ENCRYPTION_KEY`, `DATABASE_URL`, and the Gmail settings:

```ini
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_EMAIL=your_email@gmail.com
SMTP_PASSWORD=your_google_app_password
SMTP_USE_TLS=True
RECOVERY_ORIGIN=http://localhost:5173
COOKIE_SECURE=False
```

Use a Google **App Password** for an account with two-step verification enabled. Do not use the normal Gmail password. The sender is `SMTP_EMAIL`. Production must use HTTPS, `COOKIE_SECURE=True`, and the exact public origin (scheme, hostname, optional port; no trailing slash). No permissive CORS is used.

## 2. Inspect staging, then apply the migration

Use a staging database first. From Supabase SQL Editor, run this read-only inspection. It reveals schema metadata, not account data:

```sql
select table_name, column_name, data_type
from information_schema.columns
where table_schema = 'auth'
  and table_name in ('users', 'sessions', 'refresh_tokens')
order by table_name, ordinal_position;
```

Alternatively set a temporary privileged inspection `DATABASE_URL` in your local environment and run:

```powershell
server/.venv/Scripts/python.exe server/inspect_database.py
```

The migration expects standard Supabase Auth: `auth.users` has UUID `id`, email, bcrypt `encrypted_password`, `email_confirmed_at`, `deleted_at`, `is_sso_user`, `updated_at`, `recovery_token`, `recovery_sent_at`, `reauthentication_token`, and `reauthentication_sent_at`; `auth.sessions.user_id` is UUID; `auth.refresh_tokens.user_id` is text/varchar. Inspect dependent session triggers/foreign keys in staging too. Do not apply unchanged to a customized or incompatible Auth schema.

Apply `supabase/migrations/20261111000003_password_recovery.sql` as `postgres`. It creates a private, unexposed `boardmate_recovery` schema, recovery tables, a `NOLOGIN` backend role, and narrowly scoped account-lookup/password-finalization functions. It does not replace Supabase Auth tables or existing public policies. Do **not** expose this schema through PostgREST.

Create a dedicated database login with a unique generated password using your secure database administration workflow, then grant:

```sql
-- Provision once; substitute a secret through your administration workflow.
create role boardmate_recovery_login login password 'REPLACE_WITH_UNIQUE_SECRET'
  inherit nosuperuser nocreatedb nocreaterole noreplication;
grant connect on database postgres to boardmate_recovery_login;
grant boardmate_recovery_backend to boardmate_recovery_login;
```

Use that login for the service's `DATABASE_URL` and `sslmode=require` for remote connections. Use the Supabase direct connection or session pooler with the supported username format. The runtime account must not be `postgres`, `service_role`, a superuser, or an application browser credential. It needs no direct Auth table privileges; the two private `SECURITY DEFINER` functions provide only lookup and atomic finalization. Keep migration/inspection credentials separate from runtime credentials. URLs containing special password characters must be percent-encoded.

## 3. Run the service, mail worker, and frontend

Open three VS Code terminals in `boardmate`:

```powershell
# Terminal 1: production-capable WSGI server, bound to loopback port 5000
server/.venv/Scripts/python.exe server/recovery.py serve
```

```powershell
# Terminal 2: required encrypted mail-outbox worker
server/.venv/Scripts/python.exe server/recovery.py worker
```

```powershell
# Terminal 3: Vite proxies /api/recovery to Flask
npm.cmd run dev
```

Open the printed Vite URL. Use **Forgot password?** on either user login, or open `/admin.html` on the same Vite origin for administrators. If Vite uses another port, update `RECOVERY_ORIGIN` and restart Flask. Both Vite configurations include the proxy. Recovery uses three screen states in one shared React component; secrets, codes, and reset grants never go into URLs or browser local storage. Success clears the recovery cookie and local Supabase session and returns to the matching login screen.

In production, build both frontends as usual and route `/api/recovery/` from the **same HTTPS origin** to the loopback Flask service. Vite's development proxy is not included in static builds. Run the WSGI service and mail worker as supervised processes with identical environment secrets and database access. Configure `TRUSTED_PROXY` only to your gateway's exact IP after it strips incoming `X-Forwarded-For` headers and supplies the real client IP. Waitress otherwise ignores forwarded headers; without a trusted proxy all requests would share the gateway's IP limit. Do not expose port 5000 directly. A basic Nginx route is:

```nginx
location /api/recovery/ {
    proxy_pass http://127.0.0.1:5000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
}
```

Then set `TRUSTED_PROXY=127.0.0.1` for this local gateway arrangement. Do not log request bodies or cookies at your proxy. Deployment variables replace `.env` in production; dotenv does not override them.

## Security and behavior

- Codes use `secrets.randbelow`, including leading zeroes. Only a purpose-separated HMAC-SHA256 digest is stored in the challenge row. The short-lived mail queue encrypts recipient/code with Fernet so delivery can happen asynchronously without keeping raw OTPs in the database. The worker removes successful, expired, verified, replaced, or exhausted jobs; a crash after sending may deliver the same valid code again. SMTP failures retry up to three times without exposing account existence to the requester.
- OTP lifetime is 5 minutes from request, maximum 5 comparisons per code, global 60-second cooldown per normalized email. Resending after cooldown replaces the challenge and invalidates the previous code and reset grant. Requests during cooldown never send again or transfer the challenge to another browser. Successful verification consumes the OTP and creates a browser-bound, single-use 5-minute reset grant.
- Durable per-hour limits: 20 requests/IP, 5 requests/email, 100 verification attempts/IP, 20 resets/IP. Unknown addresses have dummy challenges and identical request responses/cooldowns/rate handling, with no mail. Confirmed email/password accounts are eligible; OAuth-only, SSO-only, deleted, and unconfirmed users do not receive recovery codes. The server never confirms whether an email exists.
- Counters and challenge transitions use PostgreSQL transactions, unique constraints, advisory locks, and row locks across workers. Rate counters commit even when the action is denied. Changing the password or email elsewhere invalidates an outstanding grant.
- Signed, HttpOnly, SameSite=Strict cookies bind the flow to the browser. All POSTs require a session CSRF token and same-origin checks. The server serves no CORS grants, caches no recovery responses, accepts only bounded JSON bodies, and never logs codes, passwords, SMTP credentials, recipient addresses, or connection strings.
- bcrypt cost 12 hashes are written to `auth.users.encrypted_password`, preserving compatibility with existing Supabase password login. Passwords must have at least 8 characters and at most **72 UTF-8 bytes** to avoid bcrypt truncation. Existing registration rules remain unchanged.
- Finalization updates the password, clears Supabase recovery/reauthentication tokens, deletes the user's refresh tokens and Auth sessions, consumes the grant, and removes queued mail in **one transaction**. It leaves account roles, suspension, verification, MFA, and content alone. Already-issued stateless access JWTs remain valid until their configured expiry; this flow does not claim immediate access-JWT revocation. See [Supabase sessions](https://supabase.com/docs/guides/auth/sessions) and [password hashing](https://github.com/supabase/supabase/blob/master/apps/docs/content/guides/auth/password-security.mdx). CSRF/cookie handling follows [Flask's security guidance](https://flask.palletsprojects.com/en/stable/web-security/).
- The worker cleans challenges older than one day and rate buckets older than 24 hours. Keep all three secrets stable across processes/restarts; rotation invalidates pending sessions/codes/outbox entries. After intentional key rotation, clear recovery tables through the administrator workflow.

## Tests and manual acceptance

```powershell
server/.venv/Scripts/python.exe -m pytest server/tests -q
npm.cmd run build
npm.cmd run build:admin
npx.cmd eslint src/App.jsx src/components/PasswordRecovery.jsx src/components/LoginForm.jsx src/components/AdminDashboard.jsx vite.config.js vite.admin.config.js
```

Python tests send Flask requests through the actual recovery service and run its SQL/migration as the restricted backend role in a fresh PGlite PostgreSQL engine. bcrypt and Fernet are real; SMTP delivery is mocked. Tests cover all account roles, unknown emails, CSRF/origin/cookies, expiry, five guesses, cooldown/resend, browser binding, stale grants, durable rate limiting, SMTP retries, database permissions, and password/session updates. These tests need no SMTP credentials or live Supabase project. PGlite serializes queries, so staging must still validate multi-connection races and the actual installed Auth schema.

Before production, use controlled staging accounts to check:

1. Receive the Gmail code for renter, owner, and admin; verify its 5-minute expiry, spam placement, and resend after 60 seconds. Unknown/unconfirmed emails show the same request message and send nothing.
2. Enter five incorrect codes and confirm even the correct one then fails. Request again after cooldown; only the newest challenge can verify.
3. Verify in one browser; another browser cannot use that code or reset grant. Expired grants, reused codes, mismatched passwords, and repeated reset submissions fail.
4. Log in successfully with the new password via existing Supabase login; the old password and saved refresh sessions fail. MFA/suspension/verification remain enforced. Confirm a second account is unaffected.
5. Race two verification/reset requests on separate database connections: only one grant/reset may succeed. Force a session-deletion failure and verify the password/OTP/grant changes roll back together.
6. Stop the worker: requests stay generic and mail stays encrypted in the queue. Restart before expiry to deliver; expired jobs must not send. Disconnect SMTP and confirm bounded retries with no sensitive logs.
7. Verify the production proxy/cookie/origin setup on Android, including OTP autofill, resend countdown, form validation, and returning to login. Test actual Google SMTP and Supabase login in staging: neither is exercised by the disposable tests.
