begin;

alter table public.profiles disable trigger protect_profile_verification_fields;

update public.profiles
set verification_status = 'pending',
    verification_reason = null,
    verified_at = null,
    verified_by = null
where verification_status = 'approved'
  and role::text in ('LANDLORD', 'OWNER', 'RENTER', 'USER');

alter table public.profiles enable trigger protect_profile_verification_fields;

commit;
