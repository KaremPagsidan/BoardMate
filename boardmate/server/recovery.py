"""Direct PostgreSQL + SMTP recovery. No Supabase service key or HTTP Auth API."""
import hashlib
import hmac
import json
import logging
import os
import re
import secrets
import smtplib
import ssl
import time
import uuid
from datetime import timedelta
from email.message import EmailMessage
from pathlib import Path

import bcrypt
import psycopg
from cryptography.fernet import Fernet
from dotenv import load_dotenv
from flask import Flask, jsonify, request, session
from psycopg.rows import dict_row

load_dotenv(Path(__file__).with_name('.env'))
GENERIC = 'If an eligible account exists, a code will be sent to that email. Check your inbox and spam folder.'
INVALID = 'The code is invalid, expired, or has reached its attempt limit. Request a new code.'


def digest(secret, purpose, value):
    return hmac.new(secret.encode(), f'{purpose}:{value}'.encode(), hashlib.sha256).hexdigest()


def password_error(password, confirmation):
    if not isinstance(password, str) or not isinstance(confirmation, str):
        return 'Enter and confirm your new password.'
    if len(password) < 8 or len(password.encode('utf-8')) > 72:
        return 'Use at least 8 characters and no more than 72 UTF-8 bytes.'
    if password != confirmation:
        return 'Passwords do not match.'
    return None


class RecoveryStore:
    def __init__(self, config):
        self.config = config
        self.key = config['OTP_HMAC_KEY']
        self.cipher = Fernet(config['OTP_ENCRYPTION_KEY'].encode())

    def connect(self):
        return psycopg.connect(self.config['DATABASE_URL'], row_factory=dict_row, connect_timeout=10)

    def hash(self, purpose, value):
        return digest(self.key, purpose, value)

    def allow(self, db, scope, value, limit):
        # PostgreSQL counters are shared across processes, restarts and workers.
        row = db.execute('''insert into boardmate_recovery.rate_limits(key, window_start, hits)
            values (%s, floor(extract(epoch from now()) / 3600)::bigint, 1)
            on conflict (key, window_start) do update
            set hits = boardmate_recovery.rate_limits.hits + 1 returning hits''',
            (self.hash(scope, value),)).fetchone()
        return row['hits'] <= limit

    def start(self, email, browser, ip):
        email_key = self.hash('email', email)
        with self.connect() as db:
            ip_ok = self.allow(db, 'request-ip', ip, 20)
            email_ok = self.allow(db, 'request-email', email, 5)
            if not ip_ok or not email_ok:
                return None, 429, 3600
            # Serialize requests for the same email, including the first insert.
            db.execute('select pg_advisory_xact_lock(hashtextextended(%s, 0))', (email_key,))
            old = db.execute('''select *, greatest(0, ceil(extract(epoch from resend_at - now())))::int as wait
                from boardmate_recovery.challenges where email_key = %s for update''', (email_key,)).fetchone()
            if old and old['wait'] > 0:
                challenge = str(old['id']) if hmac.compare_digest(old['browser_hash'], browser) else str(uuid.uuid4())
                return challenge, 200, old['wait']
            account = db.execute('select * from boardmate_recovery.find_account(%s)', (email,)).fetchone()
            challenge = str(uuid.uuid4())
            code = f'{secrets.randbelow(1_000_000):06d}'
            if old:
                db.execute('delete from boardmate_recovery.challenges where id = %s', (old['id'],))
            db.execute('''insert into boardmate_recovery.challenges
                (id, email_key, user_id, password_version, browser_hash, otp_hash, expires_at, resend_at)
                values (%s, %s, %s, %s, %s, %s, now() + interval '5 minutes', now() + interval '60 seconds')''',
                (challenge, email_key, account['id'] if account else None,
                 account['password_version'] if account else None, browser, self.hash('otp', f'{challenge}:{code}')))
            if account:
                payload = self.cipher.encrypt(json.dumps({'email': account['email'], 'code': code}).encode()).decode()
                db.execute('insert into boardmate_recovery.outbox(challenge_id, payload) values (%s, %s)', (challenge, payload))
            return challenge, 200, 60

    def verify(self, challenge, browser, code, ip):
        with self.connect() as db:
            if not self.allow(db, 'verify-ip', ip, 100):
                return None, 429
            row = db.execute('''select *, expires_at > clock_timestamp() as valid
                from boardmate_recovery.challenges where id = %s for update''', (challenge,)).fetchone()
            if not row or not hmac.compare_digest(row['browser_hash'], browser):
                return None, 400
            if not row['valid'] or row['attempts'] >= 5 or not row['otp_hash'] or row['consumed_at']:
                return None, 400
            db.execute('update boardmate_recovery.challenges set attempts = attempts + 1 where id = %s', (challenge,))
            if not hmac.compare_digest(row['otp_hash'], self.hash('otp', f'{challenge}:{code}')) or not row['user_id']:
                if row['attempts'] == 4:
                    db.execute('update boardmate_recovery.challenges set otp_hash = null where id = %s', (challenge,))
                return None, 400
            grant = secrets.token_urlsafe(32)
            db.execute('''update boardmate_recovery.challenges set otp_hash = null, grant_hash = %s,
                grant_expires_at = now() + interval '5 minutes' where id = %s''', (self.hash('grant', grant), challenge))
            db.execute('delete from boardmate_recovery.outbox where challenge_id = %s', (challenge,))
            return grant, 200

    def finish(self, challenge, browser, grant, password, ip):
        with self.connect() as db:
            if not self.allow(db, 'reset-ip', ip, 20):
                return False, 429
            # Check the grant before doing expensive bcrypt work.
            row = db.execute('''select id from boardmate_recovery.challenges where id = %s
                and browser_hash = %s and grant_hash = %s and consumed_at is null
                and grant_expires_at > clock_timestamp()''', (challenge, browser, self.hash('grant', grant))).fetchone()
            if not row:
                return False, 400
            password_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=12)).decode()
            ok = db.execute('select boardmate_recovery.finish_reset(%s, %s, %s, %s) as ok',
                (challenge, browser, self.hash('grant', grant), password_hash)).fetchone()['ok']
            return ok, 200 if ok else 400

    def deliver_one(self):
        with self.connect() as db:
            # Consistent lock order: challenge, then outbox (also used by requests).
            row = db.execute('''select c.id, c.expires_at > clock_timestamp() as valid,
                c.otp_hash, o.payload, o.attempts from boardmate_recovery.challenges c
                join boardmate_recovery.outbox o on o.challenge_id = c.id
                where o.next_attempt_at <= now() order by o.next_attempt_at
                limit 1 for update of c skip locked''').fetchone()
            if not row:
                return False
            if not row['valid'] or not row['otp_hash'] or row['attempts'] >= 3:
                db.execute('delete from boardmate_recovery.outbox where challenge_id = %s', (row['id'],))
                return True
            try:
                payload = json.loads(self.cipher.decrypt(row['payload'].encode(), ttl=300))
                send_code(self.config, payload['email'], payload['code'])
            except Exception as error:
                # Do not log recipient, code, SMTP credentials, payload, or DSN.
                logging.warning('Recovery mail delivery failed (%s)', type(error).__name__)
                db.execute('''update boardmate_recovery.outbox set attempts = attempts + 1,
                    next_attempt_at = now() + interval '15 seconds' where challenge_id = %s''', (row['id'],))
            else:
                db.execute('delete from boardmate_recovery.outbox where challenge_id = %s', (row['id'],))
            return True

    def cleanup(self):
        with self.connect() as db:
            db.execute("delete from boardmate_recovery.challenges where greatest(expires_at, coalesce(grant_expires_at, expires_at)) < now() - interval '1 day'")
            db.execute('delete from boardmate_recovery.rate_limits where window_start < floor(extract(epoch from now()) / 3600)::bigint - 24')


def send_code(config, email, code):
    message = EmailMessage()
    message['Subject'] = 'Your BoardMate password reset code'
    message['From'] = config['SMTP_EMAIL']
    message['To'] = email
    message.set_content(f'Your BoardMate code is: {code}\n\nIt expires 5 minutes after your request. Never share this code.\nIf you did not request a password reset, ignore this email.')
    with smtplib.SMTP(config['SMTP_HOST'], int(config['SMTP_PORT']), timeout=10) as smtp:
        smtp.ehlo()
        smtp.starttls(context=ssl.create_default_context())
        smtp.ehlo()
        smtp.login(config['SMTP_EMAIL'], config['SMTP_PASSWORD'])
        smtp.send_message(message)


def create_app(config=None, store=None):
    app = Flask(__name__)
    app.config.update({name: os.getenv(name, '') for name in (
        'DATABASE_URL', 'FLASK_SECRET_KEY', 'OTP_HMAC_KEY', 'OTP_ENCRYPTION_KEY',
        'RECOVERY_ORIGIN', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_EMAIL', 'SMTP_PASSWORD', 'SMTP_USE_TLS')})
    app.config.update(SECRET_KEY=app.config['FLASK_SECRET_KEY'],
        SESSION_COOKIE_NAME='boardmate_recovery', SESSION_COOKIE_PATH='/api/recovery',
        SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE='Strict',
        SESSION_COOKIE_SECURE=os.getenv('COOKIE_SECURE', 'True').lower() == 'true',
        PERMANENT_SESSION_LIFETIME=timedelta(minutes=15), MAX_CONTENT_LENGTH=4096)
    if config:
        app.config.update(config)
    if not app.config.get('TESTING'):
        for name in ('DATABASE_URL', 'OTP_ENCRYPTION_KEY', 'RECOVERY_ORIGIN', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_EMAIL', 'SMTP_PASSWORD'):
            if not app.config[name]:
                raise RuntimeError(f'Missing server setting: {name}')
        if any(len(app.config[name]) < 32 for name in ('SECRET_KEY', 'OTP_HMAC_KEY')):
            raise RuntimeError('Use separate random session and OTP keys of at least 32 characters.')
        if app.config['SECRET_KEY'] == app.config['OTP_HMAC_KEY']:
            raise RuntimeError('Session and OTP secrets must differ.')
        if app.config['SMTP_USE_TLS'].lower() != 'true':
            raise RuntimeError('SMTP_USE_TLS=True is required.')
        if not app.config['RECOVERY_ORIGIN'].startswith('https://') and app.config['SESSION_COOKIE_SECURE']:
            raise RuntimeError('Secure cookies require an HTTPS recovery origin.')
        if app.config['RECOVERY_ORIGIN'].startswith('https://') and not app.config['SESSION_COOKIE_SECURE']:
            raise RuntimeError('Production HTTPS requires COOKIE_SECURE=True.')
    app.extensions['recovery_store'] = store or RecoveryStore(app.config)

    @app.before_request
    def protect():
        if not request.path.startswith('/api/recovery/'):
            return jsonify(error='Not found.'), 404
        if request.headers.get('Sec-Fetch-Site') == 'cross-site':
            return jsonify(error='Cross-site requests are not allowed.'), 403
        origin = request.headers.get('Origin')
        if origin and origin != app.config['RECOVERY_ORIGIN']:
            return jsonify(error='Invalid request origin.'), 403
        if request.method == 'POST':
            token = request.headers.get('X-CSRF-Token', '')
            if not session.get('csrf') or not hmac.compare_digest(session['csrf'], token):
                return jsonify(error='Your recovery session expired. Reload and try again.'), 403
            if not request.is_json or not isinstance(request.get_json(silent=True), dict):
                return jsonify(error='Send a JSON object.'), 400

    @app.after_request
    def headers(response):
        response.headers['Cache-Control'] = 'no-store'
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['Referrer-Policy'] = 'no-referrer'
        response.headers['Content-Security-Policy'] = "default-src 'none'; frame-ancestors 'none'"
        return response

    @app.get('/api/recovery/session')
    def initialize():
        session.permanent = True
        if 'browser' not in session:
            session['browser'] = secrets.token_urlsafe(32)
            session['csrf'] = secrets.token_urlsafe(32)
        return jsonify(csrfToken=session['csrf'])

    def binding():
        return app.extensions['recovery_store'].hash('browser', session['browser'])

    @app.post('/api/recovery/request')
    def start():
        email = request.json.get('email', '')
        if not isinstance(email, str) or len(email) > 254 or not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', email.strip()):
            return jsonify(error='Enter a valid email address.'), 400
        challenge, status, wait = app.extensions['recovery_store'].start(email.strip().lower(), binding(), request.remote_addr or 'unknown')
        session.pop('grant', None)
        if challenge:
            session['challenge'] = challenge
        response = jsonify(message=GENERIC, retryAfter=wait)
        if status == 429:
            response.headers['Retry-After'] = str(wait)
        return response, status

    @app.post('/api/recovery/verify')
    def verify():
        code = request.json.get('code', '')
        if not isinstance(code, str) or not re.fullmatch(r'[0-9]{6}', code) or not session.get('challenge'):
            return jsonify(error=INVALID), 400
        grant, status = app.extensions['recovery_store'].verify(session['challenge'], binding(), code, request.remote_addr or 'unknown')
        if not grant:
            return jsonify(error=INVALID if status != 429 else 'Too many requests. Please try again later.'), status
        session['grant'] = grant
        return jsonify(message='Code verified. Create your new password.')

    @app.post('/api/recovery/reset')
    def finish():
        password = request.json.get('password')
        error = password_error(password, request.json.get('confirmPassword'))
        if error:
            return jsonify(error=error), 400
        if not session.get('grant') or not session.get('challenge'):
            return jsonify(error='Verify a new code before resetting your password.'), 400
        ok, status = app.extensions['recovery_store'].finish(session['challenge'], binding(), session['grant'], password, request.remote_addr or 'unknown')
        if not ok:
            return jsonify(error='Your reset session expired or is unavailable. Request a new code.'), status
        session.clear()
        return jsonify(message='Password updated. Sign in with your new password.')

    @app.errorhandler(psycopg.Error)
    def database_failure(error):
        logging.error('Recovery database operation failed (%s)', type(error).__name__)
        return jsonify(error='Password recovery is temporarily unavailable. Please try again later.'), 503

    return app


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['serve', 'worker'])
    args = parser.parse_args()
    application = create_app()
    if args.command == 'serve':
        from waitress import serve
        proxy = os.getenv('TRUSTED_PROXY', '')
        options = {'trusted_proxy': proxy, 'trusted_proxy_count': 1,
            'trusted_proxy_headers': {'x-forwarded-for'}} if proxy else {}
        serve(application, host='127.0.0.1', port=5000, **options)
    else:
        recovery_store = application.extensions['recovery_store']
        last_cleanup = 0
        while True:
            try:
                recovery_store.deliver_one()
                if time.monotonic() - last_cleanup > 3600:
                    recovery_store.cleanup()
                    last_cleanup = time.monotonic()
            except psycopg.Error as error:
                logging.error('Recovery worker database unavailable (%s)', type(error).__name__)
            time.sleep(1)
