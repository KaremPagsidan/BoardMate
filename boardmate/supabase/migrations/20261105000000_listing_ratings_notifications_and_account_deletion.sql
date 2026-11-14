alter table public.boardmate_notifications
  add column if not exists target_type text,
  add column if not exists target_id text;

create or replace function public.notify_boardmate_marketplace_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  recipient_id uuid;
  actor_id uuid;
  item_id text;
  item_title text;
  actor_name text;
  notice_title text;
  notice_body text;
  notice_target_type text;
  notice_target_id text;
  status_value text;
  previous_status text;
begin
  if tg_table_name = 'roommate_post_likes' then
    actor_id := new.user_id;
    select post.user_id, post.id::text, post.heading
      into recipient_id, item_id, item_title
      from public.roommate_posts post
      where post.id = new.post_id
        and post.deleted_at is null
        and post.moderation_status = 'approved';
    notice_title := 'New like on your roommate post';
    notice_body := 'Someone liked your post "' || coalesce(item_title, 'roommate post') || '".';
    notice_target_type := 'roommate_post';
    notice_target_id := item_id;
  elsif tg_table_name = 'listing_favorites' then
    actor_id := new.user_id;
    select listing.owner_id, listing.id::text, listing.title
      into recipient_id, item_id, item_title
      from public.listings listing
      where listing.id = new.listing_id
        and listing.moderation_status = 'approved';
    notice_title := 'New like on your accommodation listing';
    notice_body := 'Someone liked your listing "' || coalesce(item_title, 'accommodation listing') || '".';
    notice_target_type := 'listing';
    notice_target_id := item_id;
  elsif tg_table_name = 'profiles' then
    recipient_id := new.id;
    status_value := new.verification_status::text;
    previous_status := old.verification_status::text;
    if status_value not in ('approved', 'rejected') or status_value = previous_status then
      return new;
    end if;
    notice_title := case status_value
      when 'approved' then 'Your account has been approved'
      else 'Your account verification needs attention'
    end;
    notice_body := case status_value
      when 'approved' then 'An administrator approved your account. You can now use verified-member features.'
      else 'An administrator reviewed your account. ' || coalesce(nullif(new.verification_reason, ''), 'Please review your verification details.')
    end;
    notice_target_type := 'profile';
  elsif tg_table_name = 'listings' then
    recipient_id := new.owner_id;
    item_id := new.id::text;
    status_value := new.moderation_status::text;
    previous_status := old.moderation_status::text;
    if status_value not in ('approved', 'rejected') or status_value = previous_status then
      return new;
    end if;
    notice_title := case status_value
      when 'approved' then 'Your listing has been approved'
      else 'Your listing needs changes'
    end;
    notice_body := case status_value
      when 'approved' then 'An administrator approved "' || coalesce(new.title, 'your listing') || '". It is now visible to members.'
      else 'An administrator reviewed "' || coalesce(new.title, 'your listing') || '". ' || coalesce(nullif(new.moderation_reason, ''), 'Please review the listing and update it.')
    end;
    notice_target_type := 'listing';
    notice_target_id := item_id;
  elsif tg_table_name = 'roommate_posts' then
    recipient_id := new.user_id;
    item_id := new.id::text;
    status_value := new.moderation_status::text;
    previous_status := old.moderation_status::text;
    if status_value not in ('approved', 'rejected') or status_value = previous_status then
      return new;
    end if;
    notice_title := case status_value
      when 'approved' then 'Your roommate post has been approved'
      else 'Your roommate post needs changes'
    end;
    notice_body := case status_value
      when 'approved' then 'An administrator approved "' || coalesce(new.heading, 'your roommate post') || '". It is now visible to members.'
      else 'An administrator reviewed "' || coalesce(new.heading, 'your roommate post') || '". ' || coalesce(nullif(new.moderation_reason, ''), 'Please review the post and update it.')
    end;
    notice_target_type := 'roommate_post';
    notice_target_id := item_id;
  else
    return new;
  end if;

  if recipient_id is null or recipient_id = actor_id then
    return new;
  end if;

  if actor_id is not null then
    select profile.full_name into actor_name
      from public.profiles profile
      where profile.id = actor_id;
    if actor_name is not null then
      notice_body := pg_catalog.replace(notice_body, 'Someone', actor_name);
    end if;
  end if;

  insert into public.boardmate_notifications (user_id, title, body, target_type, target_id)
  values (recipient_id, notice_title, notice_body, notice_target_type, notice_target_id);
  return new;
end;
$$;

do $$
declare
  listing_id_type text;
begin
  select pg_catalog.format_type(attribute.atttypid, attribute.atttypmod)
    into listing_id_type
    from pg_catalog.pg_attribute attribute
    where attribute.attrelid = 'public.listings'::pg_catalog.regclass
      and attribute.attname = 'id'
      and not attribute.attisdropped;

  if listing_id_type is null then
    raise exception 'The public.listings table must have an id column before listing ratings can be enabled.';
  end if;

  execute pg_catalog.format(
    'create table if not exists public.listing_ratings (
      listing_id %s not null references public.listings(id) on delete cascade,
      user_id uuid not null references auth.users(id) on delete cascade,
      rating integer not null check (rating between 1 and 5),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      primary key (listing_id, user_id)
    )',
    listing_id_type
  );
end
$$;

alter table public.listing_ratings enable row level security;
revoke all on public.listing_ratings from public, anon, authenticated;
grant insert, update on public.listing_ratings to authenticated;

drop policy if exists "Active renters can rate other owners listings" on public.listing_ratings;
create policy "Active renters can rate other owners listings"
  on public.listing_ratings for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1
      from public.profiles profile
      where profile.id = (select auth.uid())
        and upper(profile.role::text) in ('RENTER', 'USER')
        and profile.suspended_at is null
    )
    and coalesce((
      select preference.is_active
      from public.boardmate_account_preferences preference
      where preference.user_id = (select auth.uid())
    ), true)
    and exists (
      select 1
      from public.listings listing
      where listing.id = listing_ratings.listing_id
        and listing.owner_id <> (select auth.uid())
        and listing.is_available
        and listing.moderation_status = 'approved'
    )
  );

drop policy if exists "Active renters can update their listing ratings" on public.listing_ratings;
create policy "Active renters can update their listing ratings"
  on public.listing_ratings for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1
      from public.profiles profile
      where profile.id = (select auth.uid())
        and upper(profile.role::text) in ('RENTER', 'USER')
        and profile.suspended_at is null
    )
    and coalesce((
      select preference.is_active
      from public.boardmate_account_preferences preference
      where preference.user_id = (select auth.uid())
    ), true)
    and exists (
      select 1
      from public.listings listing
      where listing.id = listing_ratings.listing_id
        and listing.owner_id <> (select auth.uid())
        and listing.is_available
        and listing.moderation_status = 'approved'
    )
  );

create or replace function public.get_boardmate_listing_rating_summaries(p_listing_ids text[])
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  summaries jsonb;
begin
  if current_user_id is null then
    raise exception 'Authentication is required to view listing ratings.';
  end if;
  if coalesce(cardinality(p_listing_ids), 0) > 100 then
    raise exception 'A maximum of 100 listing ratings can be requested at once.';
  end if;

  select coalesce(
    jsonb_object_agg(
      rating_summary.listing_id,
      jsonb_build_object(
        'average', rating_summary.average,
        'count', rating_summary.rating_count,
        'myRating', rating_summary.my_rating
      )
    ),
    '{}'::jsonb
  )
    into summaries
    from (
      select
        ratings.listing_id::text as listing_id,
        round(avg(ratings.rating)::numeric, 1) as average,
        count(*) as rating_count,
        max(ratings.rating) filter (where ratings.user_id = current_user_id) as my_rating
      from public.listing_ratings ratings
      join public.listings listing on listing.id = ratings.listing_id
      where ratings.listing_id::text = any(coalesce(p_listing_ids, array[]::text[]))
        and (
          listing.owner_id = current_user_id
          or (listing.is_available and listing.moderation_status = 'approved')
        )
      group by ratings.listing_id
    ) rating_summary;

  return summaries;
end;
$$;

revoke all on function public.get_boardmate_listing_rating_summaries(text[]) from public;
grant execute on function public.get_boardmate_listing_rating_summaries(text[]) to authenticated;

alter table public.boardmate_account_deletion_requests
  add column if not exists scheduled_for timestamptz,
  add column if not exists purge_claimed_at timestamptz;

alter table public.boardmate_account_deletion_requests
  drop constraint if exists boardmate_account_deletion_requests_status_check;
alter table public.boardmate_account_deletion_requests
  add constraint boardmate_account_deletion_requests_status_check
  check (status in ('open', 'approved', 'scheduled', 'purging', 'cancelled'));

update public.boardmate_account_deletion_requests
set status = 'cancelled'
where status in ('open', 'approved');

revoke insert on public.boardmate_account_deletion_requests from authenticated;

create unique index if not exists boardmate_account_one_scheduled_deletion_idx
  on public.boardmate_account_deletion_requests(user_id)
  where status in ('scheduled', 'purging');

create or replace function public.schedule_boardmate_account_deletion()
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  deletion_deadline timestamptz;
begin
  if current_user_id is null then
    raise exception 'Authentication is required to schedule account deletion.';
  end if;

  perform 1
    from public.profiles profile
    where profile.id = current_user_id
    for update;

  select request.scheduled_for
    into deletion_deadline
    from public.boardmate_account_deletion_requests request
    where request.user_id = current_user_id
      and request.status = 'scheduled'
    order by request.id desc
    limit 1
    for update;

  if deletion_deadline is not null then
    return deletion_deadline;
  end if;

  deletion_deadline := now() + interval '5 days';
  insert into public.boardmate_account_deletion_requests (user_id, status, scheduled_for)
  values (current_user_id, 'scheduled', deletion_deadline);
  return deletion_deadline;
end;
$$;

create or replace function public.cancel_boardmate_account_deletion()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null then
    raise exception 'Authentication is required to cancel account deletion.';
  end if;

  update public.boardmate_account_deletion_requests
    set status = 'cancelled'
    where user_id = current_user_id
      and status = 'scheduled'
      and scheduled_for > now();
  return found;
end;
$$;

create or replace function public.claim_due_boardmate_account_deletions()
returns table (request_id bigint, user_id uuid)
language sql
security definer
set search_path = ''
as $$
  with due as (
    select request.id
    from public.boardmate_account_deletion_requests request
    where (
      request.status = 'scheduled'
      and request.scheduled_for <= now()
    ) or (
      request.status = 'purging'
      and request.purge_claimed_at < now() - interval '1 hour'
    )
    order by request.scheduled_for
    limit 25
    for update skip locked
  )
  update public.boardmate_account_deletion_requests request
    set status = 'purging',
        purge_claimed_at = now()
    where request.id in (select due.id from due)
    returning request.id, request.user_id;
$$;

revoke all on function public.schedule_boardmate_account_deletion() from public;
revoke all on function public.cancel_boardmate_account_deletion() from public;
revoke all on function public.claim_due_boardmate_account_deletions() from public, anon, authenticated;
grant execute on function public.schedule_boardmate_account_deletion() to authenticated;
grant execute on function public.cancel_boardmate_account_deletion() to authenticated;
grant execute on function public.claim_due_boardmate_account_deletions() to service_role;

notify pgrst, 'reload schema';
