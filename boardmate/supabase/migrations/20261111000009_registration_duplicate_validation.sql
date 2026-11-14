begin;
set local lock_timeout = '5s';
create or replace function public.normalize_boardmate_registration_phone(p_phone text)
returns text language sql immutable set search_path = '' as $$
  select case
    when digits ~ '^09[0-9]{9}$' then '63' || substr(digits, 2)
    when digits ~ '^9[0-9]{9}$' then '63' || digits
    when digits ~ '^00639[0-9]{9}$' then substr(digits, 3)
    else digits end
  from (select regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g') as digits) n;
$$;
-- These indexes enforce uniqueness across all roles and competing requests.
-- Existing collisions must be reviewed rather than silently deleting accounts.
create unique index if not exists profiles_registration_email_unique
  on public.profiles (lower(btrim(email))) where nullif(btrim(email), '') is not null;
create unique index if not exists profiles_registration_phone_unique
  on public.profiles (public.normalize_boardmate_registration_phone(phone))
  where public.normalize_boardmate_registration_phone(phone) <> '';

create or replace function public.check_boardmate_registration_duplicates(p_email text, p_phone text default '')
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'email_exists', nullif(btrim(p_email), '') is not null and (
      exists(select 1 from auth.users u where lower(btrim(u.email)) = lower(btrim(p_email)))
      or exists(select 1 from public.profiles p where lower(btrim(p.email)) = lower(btrim(p_email)))),
    'phone_exists', public.normalize_boardmate_registration_phone(p_phone) <> '' and (
      exists(select 1 from public.profiles p where public.normalize_boardmate_registration_phone(p.phone) = public.normalize_boardmate_registration_phone(p_phone))
      or exists(select 1 from auth.users u where public.normalize_boardmate_registration_phone(u.raw_user_meta_data->>'phone') = public.normalize_boardmate_registration_phone(p_phone)
        and not exists(select 1 from public.profiles p where p.id = u.id))));
$$;
alter function public.check_boardmate_registration_duplicates(text,text) owner to postgres;
revoke all on function public.check_boardmate_registration_duplicates(text,text) from public;
grant execute on function public.check_boardmate_registration_duplicates(text,text) to anon, authenticated;
-- Only availability booleans are exposed. Profile/Auth table grants and RLS
-- remain unchanged; no account IDs, roles or personal details are returned.
notify pgrst, 'reload schema';
commit;
