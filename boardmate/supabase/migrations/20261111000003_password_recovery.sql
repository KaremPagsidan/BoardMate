-- Server-only SMTP recovery. Apply as postgres after checking the Auth schema.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
do $$ begin
  if to_regclass('auth.users') is null or to_regclass('auth.sessions') is null
    or to_regclass('auth.refresh_tokens') is null then
    raise exception 'Inspect the installed Supabase Auth schema before applying recovery.';
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'boardmate_recovery_backend') then
    create role boardmate_recovery_backend nologin;
  end if;
end $$;
create schema boardmate_recovery;
revoke all on schema boardmate_recovery from public, anon, authenticated;
grant usage on schema boardmate_recovery to boardmate_recovery_backend;

create table boardmate_recovery.challenges (
  id uuid primary key,
  email_key text not null unique,
  user_id uuid references auth.users(id) on delete cascade,
  password_version text,
  browser_hash text not null,
  otp_hash text,
  expires_at timestamptz not null,
  resend_at timestamptz not null,
  attempts integer not null default 0 check (attempts between 0 and 5),
  grant_hash text,
  grant_expires_at timestamptz,
  consumed_at timestamptz
);
create table boardmate_recovery.rate_limits (
  key text not null,
  window_start bigint not null,
  hits integer not null,
  primary key (key, window_start)
);
create table boardmate_recovery.outbox (
  challenge_id uuid primary key references boardmate_recovery.challenges(id) on delete cascade,
  payload text not null,
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now()
);
alter table boardmate_recovery.challenges enable row level security;
alter table boardmate_recovery.rate_limits enable row level security;
alter table boardmate_recovery.outbox enable row level security;
revoke all on all tables in schema boardmate_recovery from public, anon, authenticated;
grant select, insert, update, delete on all tables in schema boardmate_recovery to boardmate_recovery_backend;
create policy backend_only on boardmate_recovery.challenges to boardmate_recovery_backend using (true) with check (true);
create policy backend_only on boardmate_recovery.rate_limits to boardmate_recovery_backend using (true) with check (true);
create policy backend_only on boardmate_recovery.outbox to boardmate_recovery_backend using (true) with check (true);

-- No role filtering: verified email/password users include renters, owners, admins.
create function boardmate_recovery.find_account(p_email text)
returns table(id uuid, email text, password_version text)
language sql stable security definer set search_path = '' as $$
  select u.id, u.email::text, pg_catalog.md5(u.encrypted_password || lower(u.email))
  from auth.users u
  where lower(u.email) = lower(p_email) and u.email_confirmed_at is not null
    and u.deleted_at is null and not coalesce(u.is_sso_user, false)
    and coalesce(u.encrypted_password, '') <> '';
$$;

-- Atomically consume the browser-bound grant, change the Auth password, and
-- revoke refresh sessions. Existing access JWTs expire on their normal schedule.
create function boardmate_recovery.finish_reset(p_id uuid, p_browser text, p_grant text, p_hash text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare c boardmate_recovery.challenges; u auth.users;
begin
  if p_hash is null or p_hash !~ '^\$2b\$12\$[./A-Za-z0-9]{53}$' then
    raise exception 'Invalid password hash';
  end if;
  select * into c from boardmate_recovery.challenges where id = p_id for update;
  if not found or c.consumed_at is not null or c.user_id is null
    or c.browser_hash is distinct from p_browser or c.grant_hash is distinct from p_grant
    or c.grant_hash is null or c.grant_expires_at is null
    or c.grant_expires_at <= clock_timestamp() then
    return false;
  end if;
  select * into u from auth.users where id = c.user_id for update;
  if not found or u.deleted_at is not null or u.email_confirmed_at is null
    or c.grant_expires_at <= clock_timestamp()
    or pg_catalog.md5(u.encrypted_password || lower(u.email)) is distinct from c.password_version then
    return false;
  end if;
  update auth.users set encrypted_password = p_hash, updated_at = now(),
    recovery_token = '', recovery_sent_at = null,
    reauthentication_token = '', reauthentication_sent_at = null
    where id = c.user_id;
  delete from auth.refresh_tokens where user_id = c.user_id::text;
  delete from auth.sessions where user_id = c.user_id;
  update boardmate_recovery.challenges set consumed_at = now(), otp_hash = null,
    grant_hash = null, grant_expires_at = null where id = c.id;
  delete from boardmate_recovery.outbox where challenge_id = c.id;
  return true;
end;
$$;
alter function boardmate_recovery.find_account(text) owner to postgres;
alter function boardmate_recovery.finish_reset(uuid, text, text, text) owner to postgres;
revoke all on all functions in schema boardmate_recovery from public, anon, authenticated;
grant execute on all functions in schema boardmate_recovery to boardmate_recovery_backend;
commit;
