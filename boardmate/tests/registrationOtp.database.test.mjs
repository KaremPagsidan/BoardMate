import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
test('new unconfirmed accounts cannot enter review or approval; existing accounts preserved', async () => {
 const db = new PGlite();
 try {
 await db.exec(`create role anon; create role authenticated; create schema auth;
 create table auth.users(id uuid primary key, email_confirmed_at timestamptz);
 create table public.profiles(id uuid primary key, verification_status text);
 insert into auth.users values ('00000000-0000-0000-0000-000000000001',null);
 insert into public.profiles values ('00000000-0000-0000-0000-000000000001','approved');`);
 await db.exec(await readFile(new URL('../supabase/migrations/20261113000000_registration_email_otp_guard.sql',import.meta.url),'utf8'));
 await db.exec(`update profiles set verification_status='pending';
 insert into auth.users values ('00000000-0000-0000-0000-000000000002',null);
 insert into profiles values ('00000000-0000-0000-0000-000000000002','not_submitted');`);
 for (const status of ['pending','approved']) await assert.rejects(db.exec(`update profiles set verification_status='${status}' where id='00000000-0000-0000-0000-000000000002'`), /Verify your email/);
 await db.exec(`update auth.users set email_confirmed_at=now() where id='00000000-0000-0000-0000-000000000002'; update profiles set verification_status='pending' where id='00000000-0000-0000-0000-000000000002';`);
 assert.equal((await db.query(`select verification_status from profiles where id='00000000-0000-0000-0000-000000000002'`)).rows[0].verification_status,'pending');
 await db.exec('set role authenticated');
 await assert.rejects(db.exec('delete from public.boardmate_email_verification_required'), /permission denied/);
 } finally { await db.close(); }
});
