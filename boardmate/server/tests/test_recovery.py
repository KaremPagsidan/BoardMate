import json
import subprocess
import sys
from pathlib import Path
from unittest.mock import patch

import bcrypt
import pytest
from cryptography.fernet import Fernet

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from recovery import GENERIC, RecoveryStore, create_app, password_error


class Rows:
    def __init__(self, rows):
        self.rows = rows

    def fetchone(self):
        return self.rows[0] if self.rows else None


class Bridge:
    def __init__(self):
        self.process = subprocess.Popen(['node', str(Path(__file__).with_name('postgres_bridge.mjs'))],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        ready = self.process.stdout.readline()
        if not ready:
            raise RuntimeError(self.process.stderr.read())
        assert json.loads(ready)['ready']

    def execute(self, sql, params=()):
        self.process.stdin.write(json.dumps({'sql': sql, 'params': params}) + '\n')
        self.process.stdin.flush()
        result = json.loads(self.process.stdout.readline())
        if 'error' in result:
            raise RuntimeError(result['error'])
        return Rows(result['rows'])

    def __enter__(self):
        self.execute('begin')
        return self

    def __exit__(self, kind, *_):
        self.execute('rollback' if kind else 'commit')

    def close(self):
        self.process.stdin.close()
        self.process.wait(timeout=10)


@pytest.fixture
def setup():
    bridge = Bridge()
    config = dict(TESTING=True, SECRET_KEY='session-test-key-' * 3,
        OTP_HMAC_KEY='otp-test-key-' * 4, OTP_ENCRYPTION_KEY=Fernet.generate_key().decode(),
        SESSION_COOKIE_SECURE=False, RECOVERY_ORIGIN='http://localhost:5173', DATABASE_URL='unused')
    store = RecoveryStore(config)
    store.connect = lambda: bridge
    # Run the application SQL as its restricted backend role, not postgres.
    bridge.execute('set role boardmate_recovery_backend')
    app = create_app(config, store)
    yield app, store, bridge
    bridge.close()


def seed(db, role='RENTER', email='member@example.com', index=1):
    user = f'11111111-1111-4111-8111-{index:012d}'
    password_hash = bcrypt.hashpw(b'Original-password', bcrypt.gensalt(rounds=4)).decode()
    db.execute('reset role')
    db.execute('''insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data,
        recovery_token, reauthentication_token) values (%s,%s,%s,now(),%s::jsonb,'old-recovery','old-reauth')''',
        (user, email, password_hash, json.dumps({'role': role})))
    db.execute('insert into auth.sessions values (%s,%s)', (user, user))
    db.execute('insert into auth.refresh_tokens values (%s,%s)', (index, user))
    db.execute('set role boardmate_recovery_backend')
    return user


def csrf(client):
    result = client.get('/api/recovery/session')
    assert result.status_code == 200
    return {'X-CSRF-Token': result.json['csrfToken']}


def post(client, headers, action, **body):
    return client.post('/api/recovery/' + action, json=body, headers=headers)


def queued_code(store, db):
    payload = db.execute('select payload from boardmate_recovery.outbox').fetchone()['payload']
    return json.loads(store.cipher.decrypt(payload.encode()))['code']


@pytest.mark.parametrize('role', ['RENTER', 'OWNER', 'ADMIN'])
def test_complete_flow_changes_real_auth_hash_and_revokes_sessions(setup, role):
    app, store, db = setup
    user = seed(db, role)
    client = app.test_client()
    headers = csrf(client)
    assert post(client, headers, 'request', email=' Member@Example.com ').json['message'] == GENERIC
    code = queued_code(store, db)
    assert len(code) == 6 and code.isdigit()
    row = db.execute('select * from boardmate_recovery.challenges').fetchone()
    assert row['otp_hash'] != code and len(row['otp_hash']) == 64
    assert post(client, headers, 'verify', code=code).status_code == 200
    assert post(client, headers, 'verify', code=code).status_code == 400
    result = post(client, headers, 'reset', password='New-password-123', confirmPassword='New-password-123')
    assert result.status_code == 200
    assert 'boardmate_recovery=;' in result.headers['Set-Cookie']
    db.execute('reset role')
    account = db.execute('select * from auth.users where id = %s', (user,)).fetchone()
    assert bcrypt.checkpw(b'New-password-123', account['encrypted_password'].encode())
    assert not bcrypt.checkpw(b'Original-password', account['encrypted_password'].encode())
    assert account['raw_user_meta_data']['role'] == role
    assert account['recovery_token'] == account['reauthentication_token'] == ''
    assert db.execute('select count(*)::int as n from auth.sessions').fetchone()['n'] == 0
    assert db.execute('select count(*)::int as n from auth.refresh_tokens').fetchone()['n'] == 0
    row = db.execute('select * from boardmate_recovery.challenges').fetchone()
    assert row['otp_hash'] is None and row['grant_hash'] is None and row['consumed_at']
    assert post(client, headers, 'reset', password='Again-password', confirmPassword='Again-password').status_code == 403


def test_unknown_email_generic_and_no_mail_or_password_grant(setup):
    app, _, db = setup
    client = app.test_client()
    headers = csrf(client)
    result = post(client, headers, 'request', email='unknown@example.com')
    assert result.status_code == 200 and result.json == {'message': GENERIC, 'retryAfter': 60}
    assert db.execute('select count(*)::int as n from boardmate_recovery.outbox').fetchone()['n'] == 0
    assert post(client, headers, 'verify', code='000000').status_code == 400
    assert post(client, headers, 'reset', password='New-password', confirmPassword='New-password').status_code == 400


def test_five_failed_attempts_and_expiration(setup):
    app, store, db = setup
    seed(db)
    client = app.test_client(); headers = csrf(client)
    post(client, headers, 'request', email='member@example.com')
    code = queued_code(store, db)
    wrong = '000001' if code == '000000' else '000000'
    for _ in range(5):
        assert post(client, headers, 'verify', code=wrong).status_code == 400
    assert post(client, headers, 'verify', code=code).status_code == 400
    row = db.execute('select attempts, otp_hash from boardmate_recovery.challenges').fetchone()
    assert row == {'attempts': 5, 'otp_hash': None}
    db.execute("update boardmate_recovery.challenges set resend_at = now() - interval '1 second'")
    post(client, headers, 'request', email='member@example.com')
    code = queued_code(store, db)
    db.execute("update boardmate_recovery.challenges set expires_at = now() - interval '1 second'")
    assert post(client, headers, 'verify', code=code).status_code == 400


def test_resend_cooldown_rotates_code_and_invalidates_previous_grant(setup):
    app, store, db = setup
    seed(db)
    client = app.test_client(); headers = csrf(client)
    post(client, headers, 'request', email='member@example.com')
    first = db.execute('select * from boardmate_recovery.challenges').fetchone()
    code = queued_code(store, db)
    post(client, headers, 'request', email='member@example.com')
    assert db.execute('select id from boardmate_recovery.challenges').fetchone()['id'] == first['id']
    assert post(client, headers, 'verify', code=code).status_code == 200
    with client.session_transaction('/api/recovery/session') as browser:
        grant = browser['grant']
        binding = store.hash('browser', browser['browser'])
    db.execute("update boardmate_recovery.challenges set resend_at = now() - interval '1 second'")
    post(client, headers, 'request', email='member@example.com')
    assert db.execute('select id from boardmate_recovery.challenges').fetchone()['id'] != first['id']
    assert store.finish(first['id'], binding, grant, 'New-password', '127.0.0.1') == (False, 400)


def test_browser_binding_expired_grant_and_changed_password(setup):
    app, store, db = setup
    user = seed(db)
    client = app.test_client(); headers = csrf(client)
    post(client, headers, 'request', email='member@example.com')
    code = queued_code(store, db)
    other = app.test_client(); other_headers = csrf(other)
    post(other, other_headers, 'request', email='member@example.com')
    assert post(other, other_headers, 'verify', code=code).status_code == 400
    assert post(client, headers, 'verify', code=code).status_code == 200
    db.execute("update boardmate_recovery.challenges set grant_expires_at = now() - interval '1 second'")
    assert post(client, headers, 'reset', password='New-password', confirmPassword='New-password').status_code == 400
    db.execute("update boardmate_recovery.challenges set grant_expires_at = now() + interval '1 minute'")
    db.execute('reset role')
    db.execute("update auth.users set encrypted_password = 'changed-elsewhere' where id = %s", (user,))
    db.execute('set role boardmate_recovery_backend')
    assert post(client, headers, 'reset', password='New-password', confirmPassword='New-password').status_code == 400


def test_csrf_origin_json_and_cookie_security(setup):
    app, _, _ = setup
    client = app.test_client(); headers = csrf(client)
    assert post(client, {}, 'request', email='member@example.com').status_code == 403
    assert post(client, {**headers, 'Origin': 'https://attacker.example'}, 'request', email='member@example.com').status_code == 403
    assert client.get('/api/recovery/session', headers={'Sec-Fetch-Site': 'cross-site'}).status_code == 403
    assert client.post('/api/recovery/request', data='not json', headers=headers).status_code == 400
    assert client.post('/api/recovery/request', json=[], headers=headers).status_code == 400
    response = client.get('/api/recovery/session')
    assert response.headers['Cache-Control'] == 'no-store'
    assert 'HttpOnly' in response.headers['Set-Cookie'] and 'SameSite=Strict' in response.headers['Set-Cookie']
    assert 'Path=/api/recovery' in response.headers['Set-Cookie']
    app.config['SESSION_COOKIE_SECURE'] = True
    assert 'Secure;' in client.get('/api/recovery/session').headers['Set-Cookie']


def test_rate_limits_persist_in_database_across_clients(setup):
    app, _, _ = setup
    for index in range(6):
        client = app.test_client(); headers = csrf(client)
        result = post(client, headers, 'request', email='unknown@example.com')
        assert result.status_code == (200 if index < 5 else 429)
    for index in range(15):
        client = app.test_client(); headers = csrf(client)
        result = post(client, headers, 'request', email=f'other{index}@example.com')
    assert result.status_code == 429 and result.headers['Retry-After'] == '3600'


def test_mail_worker_decrypts_only_for_delivery_and_retries(setup):
    app, store, db = setup
    seed(db)
    client = app.test_client(); headers = csrf(client)
    post(client, headers, 'request', email='member@example.com')
    code = queued_code(store, db)
    with patch('recovery.send_code', side_effect=OSError('smtp unavailable')):
        assert store.deliver_one()
    assert db.execute('select attempts from boardmate_recovery.outbox').fetchone()['attempts'] == 1
    db.execute('update boardmate_recovery.outbox set next_attempt_at = now()')
    with patch('recovery.send_code') as send:
        assert store.deliver_one()
        send.assert_called_once_with(store.config, 'member@example.com', code)
    assert not store.deliver_one()


def test_anonymous_roles_cannot_read_recovery_or_execute_reset(setup):
    _, _, db = setup
    for role in ('anon', 'authenticated'):
        db.execute('reset role'); db.execute('set role ' + role)
        with pytest.raises(RuntimeError, match='permission denied'):
            db.execute('select * from boardmate_recovery.challenges')
        with pytest.raises(RuntimeError, match='permission denied'):
            db.execute("select boardmate_recovery.find_account('member@example.com')")
    db.execute('reset role'); db.execute('set role boardmate_recovery_backend')
    with pytest.raises(RuntimeError, match='permission denied'):
        db.execute("update auth.users set encrypted_password = 'attacker'")


def test_password_validation():
    assert password_error('short', 'short')
    assert password_error('valid-password', 'different')
    assert password_error('😀' * 19, '😀' * 19)
    assert password_error(None, None)
    assert password_error('Long-valid-password!', 'Long-valid-password!') is None


def test_finalization_rolls_back_all_changes_if_session_revocation_fails(setup):
    app, store, db = setup
    user = seed(db)
    client = app.test_client(); headers = csrf(client)
    post(client, headers, 'request', email='member@example.com')
    assert post(client, headers, 'verify', code=queued_code(store, db)).status_code == 200
    db.execute('reset role')
    db.execute("""create function auth.reject_delete() returns trigger language plpgsql as $$
        begin raise exception 'Simulated session revocation failure'; end $$""")
    db.execute('create trigger reject_delete before delete on auth.sessions for each row execute function auth.reject_delete()')
    db.execute('set role boardmate_recovery_backend')
    with pytest.raises(RuntimeError, match='Simulated session revocation failure'):
        post(client, headers, 'reset', password='New-password', confirmPassword='New-password')
    db.execute('reset role')
    row = db.execute('select encrypted_password from auth.users where id = %s', (user,)).fetchone()
    assert bcrypt.checkpw(b'Original-password', row['encrypted_password'].encode())
    assert db.execute('select count(*)::int as n from auth.refresh_tokens').fetchone()['n'] == 1
    assert db.execute('select count(*)::int as n from auth.sessions').fetchone()['n'] == 1
    assert db.execute('select consumed_at from boardmate_recovery.challenges').fetchone()['consumed_at'] is None
    db.execute('drop trigger reject_delete on auth.sessions')
    db.execute('set role boardmate_recovery_backend')
    assert post(client, headers, 'reset', password='New-password', confirmPassword='New-password').status_code == 200


def test_verified_grant_is_bound_to_browser_and_consumed_exactly_once(setup):
    app, store, db = setup
    seed(db)
    client = app.test_client(); headers = csrf(client)
    post(client, headers, 'request', email='member@example.com')
    assert post(client, headers, 'verify', code=queued_code(store, db)).status_code == 200
    with client.session_transaction('/api/recovery/session') as browser:
        grant = browser['grant']; binding = store.hash('browser', browser['browser'])
        challenge = browser['challenge']
    assert store.finish(challenge, 'wrong-browser', grant, 'New-password', '127.0.0.1') == (False, 400)
    assert store.finish(challenge, binding, grant, 'New-password', '127.0.0.1') == (True, 200)
    assert store.finish(challenge, binding, grant, 'Other-password', '127.0.0.1') == (False, 400)


def test_expired_mail_is_not_sent_and_cleanup_preserves_live_challenges(setup):
    app, store, db = setup
    seed(db)
    client = app.test_client(); headers = csrf(client)
    post(client, headers, 'request', email='member@example.com')
    store.cleanup()
    assert db.execute('select count(*)::int as n from boardmate_recovery.challenges').fetchone()['n'] == 1
    db.execute("update boardmate_recovery.challenges set expires_at = now() - interval '1 second'")
    with patch('recovery.send_code') as send:
        assert store.deliver_one()
        send.assert_not_called()
    db.execute("update boardmate_recovery.challenges set expires_at = now() - interval '2 days'")
    store.cleanup()
    assert db.execute('select count(*)::int as n from boardmate_recovery.challenges').fetchone()['n'] == 0


def test_password_confirmation_and_database_failure_responses(setup):
    import psycopg
    app, store, db = setup
    seed(db)
    client = app.test_client(); headers = csrf(client)
    post(client, headers, 'request', email='member@example.com')
    assert post(client, headers, 'verify', code=queued_code(store, db)).status_code == 200
    assert post(client, headers, 'reset', password='New-password', confirmPassword='Different').status_code == 400
    assert post(client, headers, 'reset', password='😀' * 19, confirmPassword='😀' * 19).status_code == 400
    with patch.object(store, 'finish', side_effect=psycopg.OperationalError('Do not expose this error')):
        response = post(client, headers, 'reset', password='New-password', confirmPassword='New-password')
    assert response.status_code == 503 and 'Do not expose' not in response.get_data(as_text=True)


def test_smtp_uses_starttls_login_and_plain_email_without_http_apis():
    from recovery import send_code
    config = dict(SMTP_HOST='smtp.gmail.com', SMTP_PORT='587',
        SMTP_EMAIL='sender@example.com', SMTP_PASSWORD='app-password')
    with patch('recovery.smtplib.SMTP') as smtp:
        send_code(config, 'recipient@example.com', '012345')
        smtp.assert_called_once_with('smtp.gmail.com', 587, timeout=10)
        transport = smtp.return_value.__enter__.return_value
        transport.starttls.assert_called_once()
        transport.login.assert_called_once_with('sender@example.com', 'app-password')
        message = transport.send_message.call_args.args[0]
        assert message['To'] == 'recipient@example.com'
        assert '012345' in message.get_content()
