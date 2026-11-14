create or replace function public.save_boardmate_listing_rating(p_listing_id text, p_rating integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  rating_summary jsonb;
  affected_rows integer;
begin
  if current_user_id is null or not (select public.is_boardmate_account_active(current_user_id)) then
    raise exception 'An active account is required to rate a listing.';
  end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'Choose a rating from 1 to 5 stars.';
  end if;
  if not exists (
    select 1
    from public.profiles profile
    where profile.id = current_user_id
      and upper(profile.role::text) in ('RENTER', 'USER')
  ) then
    raise exception 'Only renter accounts can rate accommodation listings.';
  end if;

  execute
    'insert into public.listing_ratings (listing_id, user_id, rating, updated_at)
     select listing.id, $2, $3, pg_catalog.now()
     from public.listings listing
     where listing.id::text = $1
       and listing.owner_id <> $2
       and listing.is_available
       and listing.moderation_status = ''approved''
     on conflict (listing_id, user_id)
     do update set rating = excluded.rating, updated_at = pg_catalog.now()'
  using p_listing_id, current_user_id, p_rating;
  get diagnostics affected_rows = row_count;

  if affected_rows = 0 then
    raise exception 'This listing is not available for rating.';
  end if;

  select pg_catalog.jsonb_build_object(
    'average', pg_catalog.round(pg_catalog.avg(rating.rating)::numeric, 1),
    'count', pg_catalog.count(*),
    'myRating', pg_catalog.max(rating.rating) filter (where rating.user_id = current_user_id)
  )
  into rating_summary
  from public.listing_ratings rating
  where rating.listing_id::text = p_listing_id;

  return rating_summary;
end;
$$;

revoke all on function public.save_boardmate_listing_rating(text, integer) from public;
grant execute on function public.save_boardmate_listing_rating(text, integer) to authenticated;

create table if not exists public.boardmate_profile_views (
  owner_id uuid not null references auth.users(id) on delete cascade,
  viewer_id uuid not null references auth.users(id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (owner_id, viewer_id),
  constraint boardmate_profile_views_distinct_users check (owner_id <> viewer_id)
);

alter table public.boardmate_profile_views enable row level security;
revoke all on public.boardmate_profile_views from public, anon, authenticated;

create or replace function public.record_boardmate_profile_view(p_owner_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_viewer_id uuid := (select auth.uid());
  unique_view_count integer;
begin
  if current_viewer_id is null
    or p_owner_id is null
    or not (select public.is_boardmate_account_active(current_viewer_id)) then
    raise exception 'An active account is required to view member profiles.';
  end if;

  if p_owner_id <> current_viewer_id then
    if not exists (
      select 1
      from public.profiles profile
      where profile.id = p_owner_id
        and profile.verification_status = 'approved'
        and profile.suspended_at is null
    ) or not (select public.is_boardmate_profile_visible(p_owner_id))
      or (select public.is_boardmate_blocked_with(p_owner_id)) then
      raise exception 'This profile is unavailable or not visible to your account.';
    end if;

    insert into public.boardmate_profile_views (owner_id, viewer_id)
    values (p_owner_id, current_viewer_id)
    on conflict (owner_id, viewer_id) do nothing;
  end if;

  select count(*)::integer
    into unique_view_count
    from public.boardmate_profile_views
    where owner_id = p_owner_id;

  return unique_view_count;
end;
$$;

revoke all on function public.record_boardmate_profile_view(uuid) from public;
grant execute on function public.record_boardmate_profile_view(uuid) to authenticated;

drop policy if exists "Users manage their account blocks" on public.blocked_boardmate_users;
drop policy if exists "Active members manage their account blocks" on public.blocked_boardmate_users;
create policy "Active members manage their account blocks"
  on public.blocked_boardmate_users for all to authenticated
  using (
    blocker_id = (select auth.uid())
    and (select public.is_boardmate_account_active((select auth.uid())))
  )
  with check (
    blocker_id = (select auth.uid())
    and (select public.is_boardmate_account_active((select auth.uid())))
    and blocked_user_id <> (select auth.uid())
  );

drop policy if exists "Users can report conversation participants" on public.direct_message_reports;
drop policy if exists "Active users can report conversation participants" on public.direct_message_reports;
create policy "Active users can report conversation participants"
  on public.direct_message_reports for insert to authenticated
  with check (
    reporter_id = (select auth.uid())
    and reporter_id <> reported_user_id
    and (select public.is_boardmate_account_active((select auth.uid())))
    and (evidence_path is null or split_part(evidence_path, '/', 1) = reporter_id::text)
    and exists (
      select 1
      from public.direct_messages message
      where (message.sender_id = (select auth.uid()) and message.recipient_id = reported_user_id)
         or (message.sender_id = reported_user_id and message.recipient_id = (select auth.uid()))
    )
  );

drop policy if exists "Reporters can upload their report evidence" on storage.objects;
drop policy if exists "Active users can upload report evidence" on storage.objects;
create policy "Active users can upload report evidence"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'direct-message-report-evidence'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select public.is_boardmate_account_active((select auth.uid())))
  );

create or replace function public.unsend_boardmate_message(
  p_message_id bigint,
  p_for_everyone boolean
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  message_row public.direct_messages%rowtype;
begin
  if (select auth.uid()) is null
    or not (select public.is_boardmate_account_active((select auth.uid()))) then
    raise exception 'An active account is required to unsend a message.';
  end if;

  select * into message_row
  from public.direct_messages
  where id = p_message_id
    and (sender_id = (select auth.uid()) or recipient_id = (select auth.uid()))
  for update;

  if not found or message_row.deleted_at is not null then
    raise exception 'This message no longer exists or is not part of your conversation.';
  end if;
  if (select public.is_boardmate_blocked_with(
    case when message_row.sender_id = (select auth.uid())
      then message_row.recipient_id else message_row.sender_id end
  )) then
    raise exception 'This conversation is blocked.';
  end if;

  if p_for_everyone then
    if message_row.sender_id <> (select auth.uid()) then
      raise exception 'Only the sender can unsend a message for everyone.';
    end if;

    update public.direct_messages
    set body = null,
        attachment_path = null,
        attachment_mime = null,
        attachment_name = null,
        deleted_at = pg_catalog.now()
    where id = p_message_id;

    delete from public.direct_message_reactions
    where message_id = p_message_id;
  else
    insert into public.direct_message_user_deletions (user_id, message_id)
    values ((select auth.uid()), p_message_id)
    on conflict (user_id, message_id) do nothing;
  end if;

  return case when p_for_everyone then message_row.attachment_path else null end;
end;
$$;

revoke all on function public.unsend_boardmate_message(bigint, boolean) from public;
grant execute on function public.unsend_boardmate_message(bigint, boolean) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'listing_ratings'
    ) then
    execute 'alter publication supabase_realtime add table public.listing_ratings';
  end if;
end
$$;

notify pgrst, 'reload schema';
