create table if not exists public.boardmate_account_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  is_active boolean not null default true,
  show_profile boolean not null default true,
  show_active_status boolean not null default true,
  search_location text not null default '',
  search_property_type text not null default '',
  search_max_price integer not null default 200000 check (search_max_price between 0 and 200000),
  updated_at timestamptz not null default now()
);

alter table public.boardmate_account_preferences enable row level security;
grant select, insert, update on public.boardmate_account_preferences to authenticated;

drop policy if exists "Users manage their account preferences" on public.boardmate_account_preferences;
create policy "Users manage their account preferences"
  on public.boardmate_account_preferences for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create or replace function public.is_boardmate_account_approved(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles profile
    left join public.boardmate_account_preferences preference on preference.user_id = profile.id
    where profile.id = target_user_id
      and profile.verification_status = 'approved'
      and profile.suspended_at is null
      and coalesce(preference.is_active, true)
  );
$$;

revoke all on function public.is_boardmate_account_approved(uuid) from public;
grant execute on function public.is_boardmate_account_approved(uuid) to authenticated;

create or replace function public.is_boardmate_profile_visible(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles profile
    left join public.boardmate_account_preferences preference on preference.user_id = profile.id
    where profile.id = target_user_id
      and profile.verification_status = 'approved'
      and profile.suspended_at is null
      and coalesce(preference.is_active, true)
      and coalesce(preference.show_profile, true)
  );
$$;

revoke all on function public.is_boardmate_profile_visible(uuid) from public;
grant execute on function public.is_boardmate_profile_visible(uuid) to authenticated;

create or replace function public.is_boardmate_account_active(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles profile
    left join public.boardmate_account_preferences preference
      on preference.user_id = profile.id
    where profile.id = target_user_id
      and profile.suspended_at is null
      and coalesce(preference.is_active, true)
  );
$$;

revoke all on function public.is_boardmate_account_active(uuid) from public;
grant execute on function public.is_boardmate_account_active(uuid) to authenticated;

alter table public.roommate_posts
  add column if not exists photos jsonb not null default '[]'::jsonb;

insert into storage.buckets (id, name, public)
values ('roommate-post-photos', 'roommate-post-photos', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "Renter can upload roommate post photos" on storage.objects;
create policy "Renter can upload roommate post photos"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'roommate-post-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (
      select 1
      from public.profiles profile
      where profile.id = (select auth.uid())
        and upper(profile.role::text) in ('RENTER', 'USER')
        and profile.suspended_at is null
        and profile.verification_status = 'approved'
    )
  );

drop policy if exists "Renter can delete roommate post photos" on storage.objects;
create policy "Renter can delete roommate post photos"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'roommate-post-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (
      select 1
      from public.profiles profile
      where profile.id = (select auth.uid())
        and upper(profile.role::text) in ('RENTER', 'USER')
        and profile.suspended_at is null
    )
  );

create or replace function public.get_boardmate_message_contact(p_contact_id uuid)
returns table (user_id uuid, full_name text, avatar_url text)
language sql
stable
security definer
set search_path = ''
as $$
  select profile.id, profile.full_name, profile.avatar_url
  from public.profiles profile
  where profile.id = p_contact_id
    and (select auth.uid()) is not null
    and (select public.is_boardmate_account_active((select auth.uid())))
    and (select public.is_boardmate_account_active(profile.id))
    and not (select public.is_boardmate_blocked_with(profile.id))
    and (
      exists (
        select 1
        from public.listings listing
        where listing.owner_id = profile.id
          and listing.is_available
          and listing.moderation_status = 'approved'
          and (select public.is_boardmate_profile_visible(profile.id))
      )
      or exists (
        select 1
        from public.roommate_posts post
        where post.user_id = profile.id
          and post.deleted_at is null
          and post.moderation_status = 'approved'
          and (select public.is_boardmate_profile_visible(profile.id))
      )
      or exists (
        select 1
        from public.direct_messages message
        where (message.sender_id = (select auth.uid()) and message.recipient_id = profile.id)
           or (message.sender_id = profile.id and message.recipient_id = (select auth.uid()))
      )
    );
$$;

revoke all on function public.get_boardmate_message_contact(uuid) from public;
grant execute on function public.get_boardmate_message_contact(uuid) to authenticated;

create or replace function public.get_boardmate_public_profile(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'id', profile.id,
    'fullName', profile.full_name,
    'avatarUrl', profile.avatar_url,
    'verificationStatus', profile.verification_status,
    'photos', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object('id', gallery.id, 'url', gallery.photo_url, 'createdAt', gallery.created_at)
        order by gallery.created_at desc
      )
      from public.profile_photo_gallery gallery
      where gallery.user_id = profile.id
    ), '[]'::jsonb),
    'roommatePosts', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', post.id,
          'title', post.heading,
          'budget', post.budget,
          'location', post.location,
          'description', post.description,
          'photos', coalesce(post.photos, '[]'::jsonb),
          'createdAt', post.created_at
        )
        order by post.created_at desc
      )
      from public.roommate_posts post
      where post.user_id = profile.id
        and post.deleted_at is null
        and post.moderation_status = 'approved'
    ), '[]'::jsonb),
    'listings', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', listing.id,
          'title', listing.title,
          'price', listing.price,
          'location', listing.location,
          'description', listing.description,
          'imageUrl', listing.image_url,
          'photos', coalesce(listing.photos, '[]'::jsonb),
          'createdAt', listing.created_at
        )
        order by listing.created_at desc
      )
      from public.listings listing
      where listing.owner_id = profile.id
        and listing.is_available
        and listing.moderation_status = 'approved'
    ), '[]'::jsonb)
  )
  from public.profiles profile
  where profile.id = p_user_id
    and (select public.is_boardmate_profile_visible(profile.id))
    and (select auth.uid()) is not null
    and (select public.is_boardmate_account_approved((select auth.uid())))
    and not (select public.is_boardmate_blocked_with(profile.id));
$$;

revoke all on function public.get_boardmate_public_profile(uuid) from public;
grant execute on function public.get_boardmate_public_profile(uuid) to authenticated;

notify pgrst, 'reload schema';
