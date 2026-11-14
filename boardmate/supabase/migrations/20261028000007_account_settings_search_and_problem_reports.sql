alter table public.listings
  add column if not exists property_type text;

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

revoke all on function public.is_boardmate_account_approved(uuid) from public;
grant execute on function public.is_boardmate_account_approved(uuid) to authenticated;
revoke all on function public.is_boardmate_profile_visible(uuid) from public;
grant execute on function public.is_boardmate_profile_visible(uuid) to authenticated;

drop policy if exists "Authenticated users can view available listings" on public.listings;
create policy "Authenticated users can view available listings"
  on public.listings for select to authenticated
  using (
    is_available
    and moderation_status = 'approved'
    and (select public.is_boardmate_account_approved((select auth.uid())))
    and (select public.is_boardmate_profile_visible(listings.owner_id))
  );

drop policy if exists "Owners can insert their listings" on public.listings;
create policy "Owners can insert their listings"
  on public.listings for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and (select public.is_boardmate_account_approved((select auth.uid())))
    and exists (
      select 1 from public.profiles
      where profiles.id = (select auth.uid())
        and upper(profiles.role::text) in ('OWNER', 'LANDLORD')
    )
  );

drop policy if exists "Owners can update their listings" on public.listings;
create policy "Owners can update their listings"
  on public.listings for update to authenticated
  using (
    (owner_id = (select auth.uid())
      and (select public.is_boardmate_account_approved((select auth.uid())))
      and exists (
        select 1 from public.profiles
        where profiles.id = (select auth.uid())
          and upper(profiles.role::text) in ('OWNER', 'LANDLORD')
      ))
    or (select public.is_boardmate_admin())
  )
  with check (owner_id = (select auth.uid()) or (select public.is_boardmate_admin()));

drop policy if exists "Authenticated users can view roommate posts" on public.roommate_posts;
create policy "Authenticated users can view roommate posts"
  on public.roommate_posts for select to authenticated
  using (
    (moderation_status = 'approved'
      and deleted_at is null
      and (select public.is_boardmate_account_approved((select auth.uid())))
      and (select public.is_boardmate_profile_visible(roommate_posts.user_id)))
    or user_id = (select auth.uid())
    or (select public.is_boardmate_admin())
  );

drop policy if exists "Users can create their roommate posts" on public.roommate_posts;
create policy "Users can create their roommate posts"
  on public.roommate_posts for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (select public.is_boardmate_account_approved((select auth.uid())))
    and exists (
      select 1 from public.profiles
      where profiles.id = (select auth.uid())
        and upper(profiles.role::text) in ('RENTER', 'USER')
    )
  );

create table if not exists public.boardmate_problem_reports (
  id bigint generated by default as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null default 'other' check (category in ('technical', 'account', 'safety', 'suggestion', 'other')),
  details text not null check (char_length(details) between 3 and 2000),
  status text not null default 'open' check (status in ('open', 'in_review', 'resolved')),
  admin_note text,
  reviewed_by uuid references public.admin_memberships(user_id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists boardmate_problem_reports_user_created_idx
  on public.boardmate_problem_reports(user_id, created_at desc);
alter table public.boardmate_problem_reports enable row level security;
grant select, insert on public.boardmate_problem_reports to authenticated;
grant usage, select on sequence public.boardmate_problem_reports_id_seq to authenticated;

drop policy if exists "Users can submit and view their problem reports" on public.boardmate_problem_reports;
create policy "Users can submit and view their problem reports"
  on public.boardmate_problem_reports for select to authenticated
  using (user_id = (select auth.uid()));
create policy "Users can submit own problem reports"
  on public.boardmate_problem_reports for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "Admins can view problem reports"
  on public.boardmate_problem_reports for select to authenticated
  using ((select public.is_boardmate_admin()));
grant update on public.boardmate_problem_reports to authenticated;
create policy "Admins can resolve problem reports"
  on public.boardmate_problem_reports for update to authenticated
  using ((select public.is_boardmate_admin()))
  with check ((select public.is_boardmate_admin()));

create table if not exists public.boardmate_account_deletion_requests (
  id bigint generated by default as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'open' check (status in ('open', 'approved', 'cancelled')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.admin_memberships(user_id) on delete set null
);

alter table public.boardmate_account_deletion_requests enable row level security;
grant select, insert on public.boardmate_account_deletion_requests to authenticated;
grant usage, select on sequence public.boardmate_account_deletion_requests_id_seq to authenticated;
create policy "Users can view their account deletion requests"
  on public.boardmate_account_deletion_requests for select to authenticated
  using (user_id = (select auth.uid()));
create policy "Users can request their account deletion"
  on public.boardmate_account_deletion_requests for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "Admins manage account deletion requests"
  on public.boardmate_account_deletion_requests for all to authenticated
  using ((select public.is_boardmate_admin()))
  with check ((select public.is_boardmate_admin()));

create or replace function public.publish_boardmate_presence()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null then
    raise exception 'Sign in before publishing presence.';
  end if;

  if not (select public.is_boardmate_account_approved(current_user_id)) then
    return;
  end if;

  if exists (
    select 1 from public.boardmate_account_preferences
    where user_id = current_user_id and not show_active_status
  ) then
    delete from public.boardmate_presence where user_id = current_user_id;
    return;
  end if;

  insert into public.boardmate_presence (user_id, last_seen_at)
  values (current_user_id, pg_catalog.now())
  on conflict (user_id)
  do update set last_seen_at = excluded.last_seen_at;
end;
$$;

revoke all on function public.publish_boardmate_presence() from public;
grant execute on function public.publish_boardmate_presence() to authenticated;

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
          'id', post.id, 'title', post.heading, 'budget', post.budget,
          'location', post.location, 'description', post.description, 'createdAt', post.created_at
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
          'id', listing.id, 'title', listing.title, 'price', listing.price,
          'location', listing.location, 'description', listing.description,
          'imageUrl', listing.image_url, 'createdAt', listing.created_at
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
