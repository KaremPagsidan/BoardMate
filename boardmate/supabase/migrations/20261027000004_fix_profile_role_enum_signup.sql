create or replace function public.handle_new_boardmate_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  user_metadata jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  profile_role public.user_role;
  role_labels text[];
begin
  select array_agg(enum_value.enumlabel)
  into role_labels
  from pg_catalog.pg_enum as enum_value
  where enum_value.enumtypid = 'public.user_role'::regtype;

  if upper(coalesce(user_metadata ->> 'role', '')) in ('OWNER', 'LANDLORD') then
    if 'LANDLORD' = any(role_labels) then
      profile_role := 'LANDLORD'::public.user_role;
    elsif 'OWNER' = any(role_labels) then
      profile_role := 'OWNER'::public.user_role;
    else
      raise exception 'The public.user_role enum must contain LANDLORD or OWNER.';
    end if;
  elsif 'RENTER' = any(role_labels) then
    profile_role := 'RENTER'::public.user_role;
  elsif 'USER' = any(role_labels) then
    profile_role := 'USER'::public.user_role;
  else
    raise exception 'The public.user_role enum must contain RENTER or USER.';
  end if;

  insert into public.profiles (
    id,
    full_name,
    email,
    phone,
    role,
    gender,
    dob,
    business_name,
    address,
    gov_id_number,
    property_type,
    id_uploaded,
    selfie_uploaded,
    verification_status,
    created_at
  )
  values (
    new.id,
    coalesce(user_metadata ->> 'full_name', ''),
    coalesce(new.email, ''),
    coalesce(user_metadata ->> 'phone', ''),
    profile_role,
    coalesce(user_metadata ->> 'gender', ''),
    nullif(user_metadata ->> 'dob', '')::date,
    nullif(user_metadata ->> 'business_name', ''),
    nullif(user_metadata ->> 'address', ''),
    nullif(user_metadata ->> 'gov_id_number', ''),
    nullif(user_metadata ->> 'property_type', ''),
    false,
    false,
    'pending',
    now()
  )
  on conflict (id) do nothing;

  return new;
end;
$$;
