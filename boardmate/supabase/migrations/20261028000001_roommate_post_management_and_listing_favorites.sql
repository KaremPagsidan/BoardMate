alter table public.roommate_posts
  add column if not exists deleted_at timestamptz;

create index if not exists roommate_posts_deleted_at_idx
  on public.roommate_posts(deleted_at);

create or replace function public.protect_roommate_post_deletion()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.deleted_at := null;
    return new;
  end if;

  if not public.is_boardmate_admin()
    and old.deleted_at is not distinct from new.deleted_at then
    return new;
  end if;

  if not public.is_boardmate_admin() then
    if old.deleted_at is not null or new.deleted_at is null then
      raise exception 'Deleted roommate posts cannot be restored.';
    end if;
    if new.user_id <> (select auth.uid()) then
      raise exception 'Only the post owner can delete this roommate post.';
    end if;
    new.deleted_at := pg_catalog.now();
  end if;

  return new;
end;
$$;

drop trigger if exists protect_roommate_post_deletion on public.roommate_posts;
create trigger protect_roommate_post_deletion
  before insert or update of deleted_at on public.roommate_posts
  for each row execute function public.protect_roommate_post_deletion();

drop policy if exists "Authenticated users can view roommate posts" on public.roommate_posts;
drop policy if exists "Users can update their roommate posts" on public.roommate_posts;
drop policy if exists "Users can delete their roommate posts" on public.roommate_posts;
drop policy if exists "Users can view visible roommate posts" on public.roommate_posts;
drop policy if exists "Owners can update active roommate posts" on public.roommate_posts;
create policy "Users can view visible roommate posts"
  on public.roommate_posts for select to authenticated
  using (
    (deleted_at is null
      and moderation_status = 'approved'
      and (select public.is_boardmate_account_approved((select auth.uid())))
      and (select public.is_boardmate_account_approved(roommate_posts.user_id)))
    or (user_id = (select auth.uid()) and deleted_at is null)
    or (select public.is_boardmate_admin())
  );

create policy "Owners can update active roommate posts"
  on public.roommate_posts for update to authenticated
  using (
    (user_id = (select auth.uid()) and deleted_at is null)
    or (select public.is_boardmate_admin())
  )
  with check (
    user_id = (select auth.uid())
    or (select public.is_boardmate_admin())
  );

create or replace function public.delete_own_roommate_post(p_post_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_heading text;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in before deleting a roommate post.';
  end if;

  update public.roommate_posts
  set deleted_at = pg_catalog.now()
  where id = p_post_id
    and user_id = (select auth.uid())
    and deleted_at is null
  returning heading into deleted_heading;

  if not found then
    raise exception 'This roommate post was already deleted or is not yours.';
  end if;

  insert into public.activity_history (user_id, action, details)
  values ((select auth.uid()), 'Deleted roommate post', deleted_heading);
end;
$$;

revoke all on function public.delete_own_roommate_post(bigint) from public;
grant execute on function public.delete_own_roommate_post(bigint) to authenticated;

drop policy if exists "Approved users can view visible roommate post likes" on public.roommate_post_likes;
create policy "Approved users can view visible roommate post likes"
  on public.roommate_post_likes for select to authenticated
  using (
    user_id = (select auth.uid())
    or (
      (select public.is_boardmate_account_approved((select auth.uid())))
      and exists (
        select 1
        from public.roommate_posts post
        where post.id = roommate_post_likes.post_id
          and post.deleted_at is null
          and post.moderation_status = 'approved'
          and post.user_id <> (select auth.uid())
          and (select public.is_boardmate_account_approved(post.user_id))
      )
    )
  );

drop policy if exists "Approved users can like visible roommate posts" on public.roommate_post_likes;
create policy "Approved users can like visible roommate posts"
  on public.roommate_post_likes for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (select public.is_boardmate_account_approved((select auth.uid())))
    and exists (
      select 1
      from public.roommate_posts post
      where post.id = roommate_post_likes.post_id
        and post.deleted_at is null
        and post.moderation_status = 'approved'
        and post.user_id <> (select auth.uid())
        and (select public.is_boardmate_account_approved(post.user_id))
    )
  );

do $$
declare
  listing_id_type text;
begin
  select pg_catalog.format_type(a.atttypid, a.atttypmod)
  into listing_id_type
  from pg_catalog.pg_attribute a
  where a.attrelid = 'public.listings'::pg_catalog.regclass
    and a.attname = 'id'
    and not a.attisdropped;

  if listing_id_type is null then
    raise exception 'The public.listings table must have an id column before favourites can be enabled.';
  end if;

  execute pg_catalog.format(
    'create table if not exists public.listing_favorites (
      listing_id %s not null references public.listings(id) on delete cascade,
      user_id uuid not null references auth.users(id) on delete cascade,
      created_at timestamptz not null default pg_catalog.now(),
      primary key (listing_id, user_id)
    )',
    listing_id_type
  );
end
$$;

alter table public.listing_favorites enable row level security;

drop policy if exists "Approved users can view visible listing favorites" on public.listing_favorites;
create policy "Approved users can view visible listing favorites"
  on public.listing_favorites for select to authenticated
  using (
    user_id = (select auth.uid())
    or (
      (select public.is_boardmate_account_approved((select auth.uid())))
      and exists (
        select 1
        from public.listings listing
        where listing.id = listing_favorites.listing_id
          and listing.is_available
          and listing.moderation_status = 'approved'
      )
    )
  );

drop policy if exists "Approved users can favorite visible listings" on public.listing_favorites;
create policy "Approved users can favorite visible listings"
  on public.listing_favorites for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (select public.is_boardmate_account_approved((select auth.uid())))
    and exists (
      select 1
      from public.listings listing
      where listing.id = listing_favorites.listing_id
        and listing.is_available
        and listing.moderation_status = 'approved'
    )
  );

drop policy if exists "Users can remove their listing favorites" on public.listing_favorites;
create policy "Users can remove their listing favorites"
  on public.listing_favorites for delete to authenticated
  using (user_id = (select auth.uid()));

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'listing_favorites'
    ) then
    execute 'alter publication supabase_realtime add table public.listing_favorites';
  end if;
end
$$;
