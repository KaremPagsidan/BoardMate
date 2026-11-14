-- Forward repair: keep Auth/profile creation atomic; never suppress insert errors.
begin;
set local lock_timeout = '5s';
create or replace function public.handle_new_boardmate_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  metadata jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  payload jsonb;
  profile public.profiles%rowtype;
  requested_role text := upper(coalesce(nullif(btrim(new.raw_user_meta_data->>'role'), ''), 'RENTER'));
  role_aliases text[];
  role_label text;
  field_name text;
  field_type oid;
  enum_label text;
begin
  -- Role comes only from the member roles supported by registration. Metadata
  -- can never grant admin membership or set verification/document fields.
  if requested_role in ('OWNER', 'LANDLORD') then role_aliases := array['LANDLORD', 'OWNER'];
  elsif requested_role in ('RENTER', 'USER') then role_aliases := array['RENTER', 'USER'];
  else raise exception 'Choose a renter or owner account role.' using errcode = '22023'; end if;
  select a.atttypid into field_type from pg_catalog.pg_attribute a
    where a.attrelid = 'public.profiles'::regclass and a.attname = 'role' and not a.attisdropped;
  if exists(select 1 from pg_catalog.pg_type where oid = field_type and typtype = 'e') then
    select e.enumlabel into role_label from pg_catalog.pg_enum e
      where e.enumtypid = field_type and upper(e.enumlabel) = any(role_aliases)
      order by array_position(role_aliases, upper(e.enumlabel)) limit 1;
    if role_label is null then raise exception 'Profile role enum does not support this account role.' using errcode = '22023'; end if;
  else role_label := role_aliases[1]; end if;
  payload := jsonb_build_object(
    'id', new.id, 'email', lower(btrim(coalesce(new.email, ''))),
    'full_name', btrim(coalesce(metadata->>'full_name', '')),
    'phone', btrim(coalesce(metadata->>'phone', '')), 'role', role_label,
    'gender', nullif(btrim(metadata->>'gender'), ''), 'dob', nullif(metadata->>'dob', ''),
    'business_name', nullif(btrim(metadata->>'business_name'), ''),
    'address', nullif(btrim(metadata->>'address'), ''),
    'gov_id_number', nullif(btrim(metadata->>'gov_id_number'), ''),
    'property_type', nullif(btrim(metadata->>'property_type'), ''));
  -- Accept text or enum columns (including enum labels with different case).
  foreach field_name in array array['gender', 'property_type'] loop
    if payload->>field_name is not null then
      select a.atttypid into field_type from pg_catalog.pg_attribute a
        where a.attrelid = 'public.profiles'::regclass and a.attname = field_name and not a.attisdropped;
      if exists(select 1 from pg_catalog.pg_type where oid = field_type and typtype = 'e') then
        select e.enumlabel into enum_label from pg_catalog.pg_enum e
          where e.enumtypid = field_type and lower(e.enumlabel) = lower(payload->>field_name) limit 1;
        if enum_label is null then raise exception 'Invalid registration value for %.', field_name using errcode = '22023'; end if;
        payload := jsonb_set(payload, array[field_name], to_jsonb(enum_label));
      end if;
    end if;
  end loop;
  -- Populate through the table's own types instead of assuming public.user_role
  -- exists or assigning text expressions to enum columns.
  profile := jsonb_populate_record(null::public.profiles, payload);
  insert into public.profiles(id, full_name, email, phone, role, gender, dob,
    business_name, address, gov_id_number, property_type,
    id_uploaded, selfie_uploaded, verification_status, created_at)
  values(profile.id, profile.full_name, profile.email, profile.phone, profile.role,
    profile.gender, profile.dob, profile.business_name, profile.address,
    profile.gov_id_number, profile.property_type, false, false, 'not_submitted', now());
  return new;
end;
$$;
alter function public.handle_new_boardmate_user() owner to postgres;
revoke all on function public.handle_new_boardmate_user() from public, anon, authenticated;
drop trigger if exists on_auth_user_created_boardmate_profile on auth.users;
create trigger on_auth_user_created_boardmate_profile after insert on auth.users
  for each row execute function public.handle_new_boardmate_user();
notify pgrst, 'reload schema';
commit;
