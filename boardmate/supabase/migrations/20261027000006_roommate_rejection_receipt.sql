create or replace function public.reject_roommate_post(p_post_id bigint, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  post_owner_id uuid;
  post_heading text;
  clean_reason text := nullif(pg_catalog.btrim(p_reason), '');
begin
  if not public.is_boardmate_admin() then
    raise exception 'Only an administrator can reject a roommate post.';
  end if;
  if clean_reason is null then
    raise exception 'A rejection reason is required.';
  end if;

  select user_id, heading
  into post_owner_id, post_heading
  from public.roommate_posts
  where id = p_post_id
    and moderation_status = 'pending'
  for update;

  if not found then
    raise exception 'This roommate post was already reviewed or no longer exists.';
  end if;

  update public.roommate_posts
  set moderation_status = 'rejected',
      moderation_reason = clean_reason,
      reviewed_at = pg_catalog.now(),
      reviewed_by = (select auth.uid())
  where id = p_post_id;

  insert into public.activity_history (user_id, action, details)
  values (
    post_owner_id,
    'Roommate post rejected and removed',
    post_heading || E'\nYour post was rejected and removed by an administrator.\nReason: ' || clean_reason
  );

  delete from public.roommate_posts
  where id = p_post_id;
end;
$$;

revoke all on function public.reject_roommate_post(bigint, text) from public;
grant execute on function public.reject_roommate_post(bigint, text) to authenticated;
