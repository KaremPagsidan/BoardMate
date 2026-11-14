-- Migration: 20261029000000_fix_listing_photos_storage_policies.sql
-- Description: Ensures the listing-photos storage bucket exists, is public,
-- and has full INSERT, UPDATE, DELETE, and SELECT policies for approved OWNER/LANDLORD users.

-- 1. Ensure listing-photos bucket exists and is public
insert into storage.buckets (id, name, public)
values ('listing-photos', 'listing-photos', true)
on conflict (id) do update set public = true;

-- 2. Clean up old policies on storage.objects for listing-photos
drop policy if exists "Users can upload their listing photos" on storage.objects;
drop policy if exists "Users can update their listing photos" on storage.objects;
drop policy if exists "Users can delete their listing photos" on storage.objects;
drop policy if exists "Public listing photos view" on storage.objects;
drop policy if exists "Anyone can view listing photos" on storage.objects;

-- 3. INSERT policy: Allow verified owners/landlords to upload photos to their own folder
create policy "Users can upload their listing photos"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'listing-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select public.is_boardmate_account_approved((select auth.uid())))
    and exists (
      select 1 from public.profiles
      where profiles.id = (select auth.uid())
        and upper(profiles.role::text) in ('OWNER', 'LANDLORD')
    )
  );

-- 4. UPDATE policy: Required when uploads use upsert or replace existing photos
create policy "Users can update their listing photos"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'listing-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select public.is_boardmate_account_approved((select auth.uid())))
    and exists (
      select 1 from public.profiles
      where profiles.id = (select auth.uid())
        and upper(profiles.role::text) in ('OWNER', 'LANDLORD')
    )
  )
  with check (
    bucket_id = 'listing-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select public.is_boardmate_account_approved((select auth.uid())))
    and exists (
      select 1 from public.profiles
      where profiles.id = (select auth.uid())
        and upper(profiles.role::text) in ('OWNER', 'LANDLORD')
    )
  );

-- 5. DELETE policy: Allow owners to remove their listing photos
create policy "Users can delete their listing photos"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'listing-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select public.is_boardmate_account_approved((select auth.uid())))
    and exists (
      select 1 from public.profiles
      where profiles.id = (select auth.uid())
        and upper(profiles.role::text) in ('OWNER', 'LANDLORD')
    )
  );

-- 6. SELECT policy: Allow public to view listing photos
create policy "Public listing photos view"
  on storage.objects for select to public
  using (bucket_id = 'listing-photos');

