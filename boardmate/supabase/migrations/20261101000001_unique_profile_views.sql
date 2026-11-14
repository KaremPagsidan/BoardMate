create table if not exists public.boardmate_profile_views (
  owner_id uuid not null references auth.users(id) on delete cascade,
  viewer_id uuid not null references auth.users(id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (owner_id, viewer_id),
  constraint boardmate_profile_views_distinct_users check (owner_id <> viewer_id)
);

alter table public.boardmate_profile_views enable row level security;
revoke all on public.boardmate_profile_views from public, anon, authenticated;

drop policy if exists "Owners can view unique profile visitors" on public.boardmate_profile_views;

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
    or not exists (
      select 1
      from public.profiles viewer
      where viewer.id = current_viewer_id
        and viewer.verification_status = 'approved'
        and viewer.suspended_at is null
    ) then
    raise exception 'An approved account is required to view member profiles.';
  end if;

  if p_owner_id <> current_viewer_id then
    if not exists (
      select 1
      from public.profiles profile
      where profile.id = p_owner_id
        and profile.verification_status = 'approved'
        and profile.suspended_at is null
    ) or (select public.is_boardmate_blocked_with(p_owner_id)) then
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

notify pgrst, 'reload schema';
