create or replace function public.notify_boardmate_marketplace_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  recipient_id uuid;
  actor_id uuid;
  item_title text;
  actor_name text;
  notice_title text;
  notice_body text;
  status_value text;
  previous_status text;
begin
  if tg_table_name = 'roommate_post_likes' then
    actor_id := new.user_id;
    select post.user_id, post.heading
      into recipient_id, item_title
      from public.roommate_posts post
      where post.id = new.post_id
        and post.deleted_at is null
        and post.moderation_status = 'approved';
    notice_title := 'New like on your roommate post';
    notice_body := 'Someone liked your post "' || coalesce(item_title, 'roommate post') || '".';
  elsif tg_table_name = 'listing_favorites' then
    actor_id := new.user_id;
    select listing.owner_id, listing.title
      into recipient_id, item_title
      from public.listings listing
      where listing.id = new.listing_id
        and listing.moderation_status = 'approved';
    notice_title := 'New like on your accommodation listing';
    notice_body := 'Someone liked your listing "' || coalesce(item_title, 'accommodation listing') || '".';
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
  elsif tg_table_name = 'listings' then
    recipient_id := new.owner_id;
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
  elsif tg_table_name = 'roommate_posts' then
    recipient_id := new.user_id;
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

  insert into public.boardmate_notifications (user_id, title, body)
  values (recipient_id, notice_title, notice_body);
  return new;
end;
$$;

drop trigger if exists notify_boardmate_roommate_post_like on public.roommate_post_likes;
create trigger notify_boardmate_roommate_post_like
  after insert on public.roommate_post_likes
  for each row execute function public.notify_boardmate_marketplace_activity();

drop trigger if exists notify_boardmate_listing_favorite on public.listing_favorites;
create trigger notify_boardmate_listing_favorite
  after insert on public.listing_favorites
  for each row execute function public.notify_boardmate_marketplace_activity();

drop trigger if exists notify_boardmate_profile_review on public.profiles;
create trigger notify_boardmate_profile_review
  after update of verification_status on public.profiles
  for each row execute function public.notify_boardmate_marketplace_activity();

drop trigger if exists notify_boardmate_listing_review on public.listings;
create trigger notify_boardmate_listing_review
  after update of moderation_status on public.listings
  for each row execute function public.notify_boardmate_marketplace_activity();

drop trigger if exists notify_boardmate_roommate_post_review on public.roommate_posts;
create trigger notify_boardmate_roommate_post_review
  after update of moderation_status on public.roommate_posts
  for each row execute function public.notify_boardmate_marketplace_activity();

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
    and profile.verification_status = 'approved'
    and profile.suspended_at is null
    and (select auth.uid()) is not null
    and (select public.is_boardmate_account_approved((select auth.uid())))
    and not (select public.is_boardmate_blocked_with(profile.id));
$$;

revoke all on function public.get_boardmate_public_profile(uuid) from public;
grant execute on function public.get_boardmate_public_profile(uuid) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'boardmate_notifications'
    ) then
    execute 'alter publication supabase_realtime add table public.boardmate_notifications';
  end if;
end
$$;
