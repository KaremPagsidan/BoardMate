// Disposable PostgreSQL engine for Flask integration tests; no live DB access.
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated;
  create schema auth;
  create table auth.users (
    id uuid primary key, email text, encrypted_password text,
    email_confirmed_at timestamptz, deleted_at timestamptz, is_sso_user boolean default false,
    updated_at timestamptz, recovery_token text, recovery_sent_at timestamptz,
    reauthentication_token text, reauthentication_sent_at timestamptz,
    raw_user_meta_data jsonb default '{}'::jsonb
  );
  create table auth.sessions (id uuid primary key, user_id uuid references auth.users(id));
  create table auth.refresh_tokens (id integer primary key, user_id varchar(255));
`);
await db.exec(await readFile(new URL('../../supabase/migrations/20261111000003_password_recovery.sql', import.meta.url), 'utf8'));
process.stdout.write('{"ready":true}\n');
for await (const line of createInterface({ input: process.stdin })) {
  try {
    const { sql, params = [] } = JSON.parse(line);
    let index = 0;
    const result = await db.query(sql.replace(/%s/g, () => `$${++index}`), params);
    process.stdout.write(`${JSON.stringify({ rows: result.rows })}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ error: error.message })}\n`);
  }
}
await db.close();
