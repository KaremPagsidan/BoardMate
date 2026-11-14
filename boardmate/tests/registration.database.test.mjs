import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
const repair = await readFile(new URL('../supabase/migrations/20261111000008_repair_registration_profile_trigger.sql', import.meta.url), 'utf8');
const earlier = await readFile(new URL('../supabase/migrations/20261027000004_fix_profile_role_enum_signup.sql', import.meta.url), 'utf8');
for (const variant of ['enum', 'text']) test(`Auth signup works with ${variant} profile roles under RLS`, async () => {
  const db = new PGlite();
  const id = '11111111-1111-4111-8111-111111111111';
  const owner = '22222222-2222-4222-8222-222222222222';
  try {
    await db.exec(`create role anon; create role authenticated; create role supabase_auth_admin;
      create schema auth;
      create table auth.users(id uuid primary key, email text unique, raw_user_meta_data jsonb);
      grant usage on schema auth to supabase_auth_admin;
      grant insert on auth.users to supabase_auth_admin;
      ${variant === 'enum' ? "create type public.user_role as enum ('RENTER','LANDLORD'); create type public.gender_type as enum ('male','female','other');" : ''}
      create table public.profiles(id uuid primary key references auth.users(id), full_name text not null,
        email text not null unique, phone text not null, role ${variant === 'enum' ? 'public.user_role' : 'text'} not null,
        gender ${variant === 'enum' ? 'public.gender_type' : 'text'}, dob date, business_name text, address text, gov_id_number text, property_type text,
        id_uploaded boolean, selfie_uploaded boolean, verification_status text check(verification_status in ('not_submitted','pending','approved','rejected')), created_at timestamptz not null);
      alter table public.profiles enable row level security;
    `);
    // Reproduce the previous trigger's failure with an enum-valued gender.
    if (variant === 'enum') {
      await db.exec(earlier);
      await db.exec('create trigger on_auth_user_created_boardmate_profile after insert on auth.users for each row execute function public.handle_new_boardmate_user()');
      await assert.rejects(db.query('insert into auth.users values($1,$2,$3)', [id, 'renter@example.com', { full_name: 'Renter', role: 'RENTER', gender: 'Male' }]), /gender|enum/);
      assert.equal((await db.query('select * from auth.users')).rows.length, 0);
    }
    await db.exec(repair);
    await db.exec(await readFile(new URL('../supabase/migrations/20261111000009_registration_duplicate_validation.sql', import.meta.url), 'utf8'));
    await db.exec('set role supabase_auth_admin');
    await db.query('insert into auth.users values($1,$2,$3)', [id, 'renter@example.com', { full_name: ' Renter ', role: 'RENTER', gender: 'Male', dob: '2000-02-29', phone: '09123456789', verification_status: 'approved', id_uploaded: true }]);
    await db.query('insert into auth.users values($1,$2,$3)', [owner, 'owner@example.com', { full_name: 'Owner', role: 'OWNER', gender: 'Female', business_name: 'Rooms', address: 'Manila', property_type: 'House' }]);
    await assert.rejects(db.query('insert into auth.users values(gen_random_uuid(),$1,$2)', ['renter@example.com', {}]), /unique/);
    await assert.rejects(db.query('insert into auth.users values(gen_random_uuid(),$1,$2)', ['admin@example.com', { role: 'ADMIN' }]), /account role/);
    await db.exec('reset role');
    await db.exec('set role anon');
    const duplicate = (await db.query('select public.check_boardmate_registration_duplicates($1,$2) as result', [' RENTER@EXAMPLE.COM ', '+63 912 345 6789'])).rows[0].result;
    assert.deepEqual(duplicate, { email_exists: true, phone_exists: true });
    await assert.rejects(db.query('select * from public.profiles'), /permission denied/);
    await assert.rejects(db.query('select * from auth.users'), /permission denied/);
    await db.exec('reset role');
    // A stale preflight must not permit a cross-role duplicate at commit time.
    await db.exec('set role supabase_auth_admin');
    await assert.rejects(db.query('insert into auth.users values(gen_random_uuid(),$1,$2)', ['competing@example.com', { full_name: 'Other role', role: 'OWNER', phone: '+63 912 345 6789' }]), /profiles_registration_phone_unique/);
    await db.exec('reset role');
    assert.equal((await db.query('select count(*)::int as count from auth.users')).rows[0].count, 2);
    const rows = (await db.query('select * from public.profiles order by email')).rows;
    assert.equal(rows.length, 2);
    assert.equal(rows[0].role, 'LANDLORD'); assert.equal(rows[0].business_name, 'Rooms');
    assert.equal(rows[1].full_name, 'Renter');
    assert.equal(rows[1].gender, variant === 'enum' ? 'male' : 'Male');
    for (const row of rows) { assert.equal(row.verification_status, 'not_submitted'); assert.equal(row.id_uploaded, false); assert.equal(row.selfie_uploaded, false); }
    assert.equal((await db.query("select relrowsecurity from pg_class where oid='public.profiles'::regclass")).rows[0].relrowsecurity, true);
  } finally { await db.close(); }
});
