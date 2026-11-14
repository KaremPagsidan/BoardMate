"""Read-only Auth schema inspection; never prints users, hashes, or credentials."""
import os
from pathlib import Path

import psycopg
from dotenv import load_dotenv

load_dotenv(Path(__file__).with_name('.env'))
if not os.getenv('DATABASE_URL'):
    raise SystemExit('Set a server-only DATABASE_URL first. Use a schema-inspection account for this command.')
try:
    with psycopg.connect(os.environ['DATABASE_URL'], connect_timeout=10) as db:
        db.execute('set transaction read only')
        columns = db.execute('''select table_name, column_name, data_type
            from information_schema.columns where table_schema = 'auth'
            and table_name in ('users', 'sessions', 'refresh_tokens')
            order by table_name, ordinal_position''').fetchall()
        for table, column, kind in columns:
            print(f'auth.{table}.{column}: {kind}')
        if not columns:
            raise SystemExit('Auth schema is not visible to this connection. Use the SQL Editor preflight in README.md.')
except psycopg.Error as error:
    raise SystemExit(f'Inspection failed ({type(error).__name__}). Check database connectivity and permissions; credentials were not printed.') from None
