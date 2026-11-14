create table if not exists public.admin_memberships (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.admin_memberships enable row level security;
revoke all on public.admin_memberships from public, anon, authenticated;

create or replace function public.is_boardmate_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.admin_memberships
    where user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_boardmate_admin() from public;
grant execute on function public.is_boardmate_admin() to authenticated;

alter table public.profiles
  add column if not exists verification_status text not null default 'approved',
  add column if not exists verification_reason text,
  add column if not exists verified_at timestamptz,
  add column if not exists verified_by uuid references public.admin_memberships(user_id) on delete set null,
  add column if not exists id_uploaded boolean not null default false,
  add column if not exists selfie_uploaded boolean not null default false,
  add column if not exists id_document_path text,
  add column if not exists selfie_document_path text,
  add column if not exists created_at timestamptz not null default now();

alter table public.profiles
  drop constraint if exists profiles_verification_status_check;
alter table public.profiles
  add constraint profiles_verification_status_check
  check (verification_status in ('pending', 'approved', 'rejected'));

update public.profiles
set id_uploaded = id_document_path is not null,
    selfie_uploaded = selfie_document_path is not null;

create or replace function public.is_boardmate_account_approved(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = target_user_id
      and verification_status = 'approved'
  );
$$;

revoke all on function public.is_boardmate_account_approved(uuid) from public;
grant execute on function public.is_boardmate_account_approved(uuid) to authenticated;

alter table public.listings
  add column if not exists moderation_status text not null default 'approved',
  add column if not exists moderation_reason text,
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid references public.admin_memberships(user_id) on delete set null;

alter table public.listings
  drop constraint if exists listings_moderation_status_check;
alter table public.listings
  add constraint listings_moderation_status_check
  check (moderation_status in ('pending', 'approved', 'rejected'));

alter table public.roommate_posts
  add column if not exists moderation_status text not null default 'approved',
  add column if not exists moderation_reason text,
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid references public.admin_memberships(user_id) on delete set null;

alter table public.roommate_posts
  drop constraint if exists roommate_posts_moderation_status_check;
alter table public.roommate_posts
  add constraint roommate_posts_moderation_status_check
  check (moderation_status in ('pending', 'approved', 'rejected'));

create or replace function public.handle_new_boardmate_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  user_metadata jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
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
    case
      when upper(coalesce(user_metadata ->> 'role', '')) in ('OWNER', 'LANDLORD') then 'LANDLORD'
      else 'RENTER'
    end,
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

drop trigger if exists on_auth_user_created_boardmate_profile on auth.users;
create trigger on_auth_user_created_boardmate_profile
  after insert on auth.users
  for each row execute function public.handle_new_boardmate_user();

create or replace function public.protect_boardmate_review_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_table_name = 'profiles' then
    if tg_op = 'INSERT' then
      new.verification_status := 'pending';
      new.verification_reason := null;
      new.verified_at := null;
      new.verified_by := null;
      new.id_uploaded := false;
      new.selfie_uploaded := false;
      new.id_document_path := null;
      new.selfie_document_path := null;
      return new;
    end if;

    if not public.is_boardmate_admin()
      and (
        new.verification_status is distinct from old.verification_status
        or new.verification_reason is distinct from old.verification_reason
        or new.verified_at is distinct from old.verified_at
        or new.verified_by is distinct from old.verified_by
      ) then
      raise exception 'Only an administrator can change account verification status.';
    end if;

    if new.id is distinct from old.id
      or (
        not public.is_boardmate_admin()
        and new.created_at is distinct from old.created_at
      ) then
      raise exception 'Profile identity and registration time cannot be changed.';
    end if;

    if not public.is_boardmate_admin()
      and (
        new.email is distinct from old.email
        or new.full_name is distinct from old.full_name
        or new.phone is distinct from old.phone
        or new.role is distinct from old.role
        or new.gender is distinct from old.gender
        or new.dob is distinct from old.dob
        or new.business_name is distinct from old.business_name
        or new.address is distinct from old.address
        or new.gov_id_number is distinct from old.gov_id_number
        or new.property_type is distinct from old.property_type
      ) then
      new.verification_status := 'pending';
      new.verification_reason := null;
      new.verified_at := null;
      new.verified_by := null;
    end if;

    if not public.is_boardmate_admin()
      and (
        new.id_document_path is distinct from old.id_document_path
        or new.selfie_document_path is distinct from old.selfie_document_path
      ) then
      if new.id_document_path is not null
        and split_part(new.id_document_path, '/', 1) <> old.id::text then
        raise exception 'Verification documents must be stored in the account owner folder.';
      end if;
      if new.selfie_document_path is not null
        and split_part(new.selfie_document_path, '/', 1) <> old.id::text then
        raise exception 'Verification documents must be stored in the account owner folder.';
      end if;
      new.verification_status := 'pending';
      new.verification_reason := null;
      new.verified_at := null;
      new.verified_by := null;
    end if;
    new.id_uploaded := new.id_document_path is not null;
    new.selfie_uploaded := new.selfie_document_path is not null;
  else
    if tg_op = 'INSERT' then
      new.moderation_status := 'pending';
      new.moderation_reason := null;
      new.reviewed_at := null;
      new.reviewed_by := null;
      return new;
    end if;

    if not public.is_boardmate_admin()
      and (
        new.created_at is distinct from old.created_at
        or (
          tg_table_name = 'listings'
          and new.owner_id is distinct from old.owner_id
        )
        or (
          tg_table_name = 'roommate_posts'
          and new.user_id is distinct from old.user_id
        )
      ) then
      raise exception 'Post ownership and creation time cannot be changed.';
    end if;

    if not public.is_boardmate_admin()
      and (
        new.moderation_status is distinct from old.moderation_status
        or new.moderation_reason is distinct from old.moderation_reason
        or new.reviewed_at is distinct from old.reviewed_at
        or new.reviewed_by is distinct from old.reviewed_by
      ) then
      raise exception 'Only an administrator can change content moderation status.';
    end if;

    if tg_table_name = 'listings'
      and not public.is_boardmate_admin()
      and (
        new.title is distinct from old.title
        or new.price is distinct from old.price
        or new.location is distinct from old.location
        or new.description is distinct from old.description
        or new.image_url is distinct from old.image_url
      ) then
      new.moderation_status := 'pending';
      new.moderation_reason := null;
      new.reviewed_at := null;
      new.reviewed_by := null;
    elsif tg_table_name = 'roommate_posts'
      and not public.is_boardmate_admin()
      and (
        new.heading is distinct from old.heading
        or new.budget is distinct from old.budget
        or new.description is distinct from old.description
        or new.location is distinct from old.location
        or new.role is distinct from old.role
        or new.author_name is distinct from old.author_name
        or new.author_gender is distinct from old.author_gender
        or new.author_age is distinct from old.author_age
      ) then
      new.moderation_status := 'pending';
      new.moderation_reason := null;
      new.reviewed_at := null;
      new.reviewed_by := null;
    end if;
  end if;

  return new;
end;
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'verification-documents',
  'verification-documents',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users upload their own verification documents" on storage.objects;
create policy "Users upload their own verification documents"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'verification-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Users and admins view verification documents" on storage.objects;
create policy "Users and admins view verification documents"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'verification-documents'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or (select public.is_boardmate_admin())
    )
  );

drop policy if exists "Users replace their own verification documents" on storage.objects;
create policy "Users replace their own verification documents"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'verification-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'verification-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Users delete their own verification documents" on storage.objects;
create policy "Users delete their own verification documents"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'verification-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop trigger if exists protect_profile_verification_fields on public.profiles;
create trigger protect_profile_verification_fields
  before insert or update on public.profiles
  for each row execute function public.protect_boardmate_review_fields();

drop trigger if exists protect_listing_moderation_fields on public.listings;
create trigger protect_listing_moderation_fields
  before insert or update on public.listings
  for each row execute function public.protect_boardmate_review_fields();

drop trigger if exists protect_roommate_moderation_fields on public.roommate_posts;
create trigger protect_roommate_moderation_fields
  before insert or update on public.roommate_posts
  for each row execute function public.protect_boardmate_review_fields();

drop policy if exists "Users can view their own profile" on public.profiles;
create policy "Users can view their own profile"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_boardmate_admin()));

drop policy if exists "Users can insert their own profile" on public.profiles;
create policy "Users can insert their own profile"
  on public.profiles for insert to authenticated
  with check (id = (select auth.uid()));

drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()) or (select public.is_boardmate_admin()))
  with check (id = (select auth.uid()) or (select public.is_boardmate_admin()));

drop policy if exists "Authenticated users can view available listings" on public.listings;
create policy "Authenticated users can view available listings"
  on public.listings for select to authenticated
  using (
    is_available
    and moderation_status = 'approved'
    and exists (
      select 1 from public.profiles
      where profiles.id = (select auth.uid())
        and profiles.verification_status = 'approved'
    )
    and (select public.is_boardmate_account_approved(listings.owner_id))
  );

drop policy if exists "Owners can view their listings" on public.listings;
create policy "Owners can view their listings"
  on public.listings for select to authenticated
  using (owner_id = (select auth.uid()) or (select public.is_boardmate_admin()));

drop policy if exists "Owners can insert their listings" on public.listings;
create policy "Owners can insert their listings"
  on public.listings for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and exists (
      select 1 from public.profiles
      where profiles.id = (select auth.uid())
        and upper(profiles.role::text) in ('OWNER', 'LANDLORD')
        and profiles.verification_status = 'approved'
    )
  );

drop policy if exists "Owners can update their listings" on public.listings;
create policy "Owners can update their listings"
  on public.listings for update to authenticated
  using (
    (owner_id = (select auth.uid()) and exists (
      select 1 from public.profiles
      where profiles.id = (select auth.uid())
        and upper(profiles.role::text) in ('OWNER', 'LANDLORD')
        and profiles.verification_status = 'approved'
    ))
    or (select public.is_boardmate_admin())
  )
  with check (
    owner_id = (select auth.uid())
    or (select public.is_boardmate_admin())
  );

drop policy if exists "Admins can view all listings" on public.listings;
create policy "Admins can view all listings"
  on public.listings for select to authenticated
  using ((select public.is_boardmate_admin()));

drop policy if exists "Admins can update listing moderation" on public.listings;
create policy "Admins can update listing moderation"
  on public.listings for update to authenticated
  using ((select public.is_boardmate_admin()))
  with check ((select public.is_boardmate_admin()));

drop policy if exists "Authenticated users can view roommate posts" on public.roommate_posts;
create policy "Authenticated users can view roommate posts"
  on public.roommate_posts for select to authenticated
  using (
    (moderation_status = 'approved'
      and exists (
        select 1 from public.profiles
        where profiles.id = (select auth.uid())
          and profiles.verification_status = 'approved'
      )
      and (select public.is_boardmate_account_approved(roommate_posts.user_id)))
    or user_id = (select auth.uid())
    or (select public.is_boardmate_admin())
  );

drop policy if exists "Users can create their roommate posts" on public.roommate_posts;
create policy "Users can create their roommate posts"
  on public.roommate_posts for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.profiles
      where profiles.id = (select auth.uid())
        and upper(profiles.role::text) in ('RENTER', 'USER')
        and profiles.verification_status = 'approved'
    )
  );

drop policy if exists "Users can update their roommate posts" on public.roommate_posts;
create policy "Users can update their roommate posts"
  on public.roommate_posts for update to authenticated
  using (user_id = (select auth.uid()) or (select public.is_boardmate_admin()))
  with check (user_id = (select auth.uid()) or (select public.is_boardmate_admin()));

drop policy if exists "Users can delete their roommate posts" on public.roommate_posts;
create policy "Users can delete their roommate posts"
  on public.roommate_posts for delete to authenticated
  using (user_id = (select auth.uid()) or (select public.is_boardmate_admin()));

drop policy if exists "Admins can view all roommate posts" on public.roommate_posts;
create policy "Admins can view all roommate posts"
  on public.roommate_posts for select to authenticated
  using ((select public.is_boardmate_admin()));

drop policy if exists "Admins can update roommate post moderation" on public.roommate_posts;
create policy "Admins can update roommate post moderation"
  on public.roommate_posts for update to authenticated
  using ((select public.is_boardmate_admin()))
  with check ((select public.is_boardmate_admin()));

do $$
declare
  reviewed_table text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach reviewed_table in array array['profiles', 'listings', 'roommate_posts']
    loop
      if not exists (
        select 1
        from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = reviewed_table
      ) then
        execute format('alter publication supabase_realtime add table public.%I', reviewed_table);
      end if;
    end loop;
  end if;
end
$$;

notify pgrst, 'reload schema';
