create table if not exists public.roommate_post_likes (
  post_id bigint not null references public.roommate_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

alter table public.roommate_post_likes enable row level security;

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
        and post.moderation_status = 'approved'
        and post.user_id <> (select auth.uid())
        and (select public.is_boardmate_account_approved(post.user_id))
    )
  );

drop policy if exists "Users can remove their roommate post likes" on public.roommate_post_likes;
create policy "Users can remove their roommate post likes"
  on public.roommate_post_likes for delete to authenticated
  using (user_id = (select auth.uid()));

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'roommate_post_likes'
    ) then
    execute 'alter publication supabase_realtime add table public.roommate_post_likes';
  end if;
end
$$;
