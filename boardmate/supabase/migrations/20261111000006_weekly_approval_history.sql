begin;
set local lock_timeout = '5s';
-- Serialize installation/backfill with approvals so none can fall into a gap.
lock table public.profiles, public.listings, public.roommate_posts in share row exclusive mode;
create table public.boardmate_approval_events (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('accounts', 'listings', 'posts')),
  target_id text not null,
  approved_at timestamptz not null,
  source text not null,
  unique(kind, target_id, approved_at)
);
create index boardmate_approval_events_time_idx on public.boardmate_approval_events(approved_at, kind);
create table public.boardmate_statistics_metadata(id boolean primary key default true check(id), tracking_started_at timestamptz not null default now());
insert into public.boardmate_statistics_metadata(id) values(true);
alter table public.boardmate_approval_events enable row level security;
alter table public.boardmate_statistics_metadata enable row level security;
revoke all on public.boardmate_approval_events, public.boardmate_statistics_metadata from public, anon, authenticated;
grant select on public.boardmate_approval_events, public.boardmate_statistics_metadata to authenticated;
create policy "Admins read approval history" on public.boardmate_approval_events for select to authenticated using (public.is_boardmate_admin());
create policy "Admins read history coverage" on public.boardmate_statistics_metadata for select to authenticated using (public.is_boardmate_admin());

create function public.record_boardmate_approval_event() returns trigger
language plpgsql security definer set search_path = '' as $$
declare n jsonb := to_jsonb(new); o jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  category text; status_column text; timestamp_column text;
begin
  if tg_table_name = 'profiles' then category := 'accounts'; status_column := 'verification_status'; timestamp_column := 'verified_at';
  else category := case when tg_table_name = 'listings' then 'listings' else 'posts' end; status_column := 'moderation_status'; timestamp_column := 'reviewed_at'; end if;
  if n->>status_column = 'approved' and o->>status_column is distinct from 'approved' then
    insert into public.boardmate_approval_events(kind, target_id, approved_at, source)
    values(category, n->>'id', coalesce((n->>timestamp_column)::timestamptz, clock_timestamp()), 'live') on conflict do nothing;
  end if;
  return null;
end;
$$;
alter function public.record_boardmate_approval_event() owner to postgres;
revoke all on function public.record_boardmate_approval_event() from public, anon, authenticated;
create trigger preserve_account_approvals after insert or update on public.profiles for each row execute function public.record_boardmate_approval_event();
create trigger preserve_listing_approvals after insert or update on public.listings for each row execute function public.record_boardmate_approval_event();
create trigger preserve_roommate_approvals after insert or update on public.roommate_posts for each row execute function public.record_boardmate_approval_event();

insert into public.boardmate_approval_events(kind, target_id, approved_at, source)
select 'accounts', id::text, verified_at, 'legacy_current' from public.profiles where verification_status = 'approved' and verified_at is not null
union all select 'listings', id::text, reviewed_at, 'legacy_current' from public.listings where moderation_status = 'approved' and reviewed_at is not null
union all select 'posts', id::text, reviewed_at, 'legacy_current' from public.roommate_posts where moderation_status = 'approved' and reviewed_at is not null
on conflict do nothing;
-- Retained snapshots and audit entries can recover approvals no longer reflected
-- in current rows. Missing legacy events cannot safely be invented.
do $$ begin
  if to_regclass('public.boardmate_verification_submissions') is not null then
    insert into public.boardmate_approval_events(kind, target_id, approved_at, source)
    select 'accounts', user_id::text, reviewed_at, 'legacy_submission'
    from public.boardmate_verification_submissions where status = 'approved' and reviewed_at is not null
    on conflict do nothing;
  end if;
  if to_regclass('public.admin_activity_logs') is not null then
    insert into public.boardmate_approval_events(kind, target_id, approved_at, source)
    select case target_table when 'profiles' then 'accounts' when 'listings' then 'listings' else 'posts' end,
      target_id, created_at, 'legacy_audit' from public.admin_activity_logs a
    where target_id is not null and action in ('Account verification approved', 'listings approved', 'roommate_posts approved')
      and target_table in ('profiles', 'listings', 'roommate_posts')
      and not exists(select 1 from public.boardmate_approval_events e where e.target_id = a.target_id
        and e.kind = case a.target_table when 'profiles' then 'accounts' when 'listings' then 'listings' else 'posts' end
        and abs(extract(epoch from e.approved_at - a.created_at)) < 1)
    on conflict do nothing;
  end if;
end $$;

create function public.get_boardmate_weekly_statistics(p_week date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare monday date; today date := (now() at time zone 'Asia/Manila')::date; result jsonb;
begin
  if auth.uid() is null or public.is_boardmate_admin() is not true then raise exception 'Administrator access required.' using errcode = '42501'; end if;
  if p_week is null then raise exception 'Choose a week.'; end if;
  monday := date_trunc('week', p_week::timestamp)::date;
  if monday > date_trunc('week', today::timestamp)::date then raise exception 'Future weeks are unavailable.'; end if;
  with counts as (
    select (approved_at at time zone 'Asia/Manila')::date as day,
      count(*) filter(where kind = 'accounts') as accounts,
      count(*) filter(where kind = 'listings') as listings,
      count(*) filter(where kind = 'posts') as posts
    from public.boardmate_approval_events
    where approved_at >= ((monday - 49)::timestamp at time zone 'Asia/Manila')
      and approved_at < ((monday + 7)::timestamp at time zone 'Asia/Manila') group by 1
  ), days as (
    select d::date as day, coalesce(c.accounts,0) as accounts, coalesce(c.listings,0) as listings, coalesce(c.posts,0) as posts
    from generate_series((monday-49)::timestamp, (monday+6)::timestamp, interval '1 day') d left join counts c on c.day = d::date
  ), weeks as (
    select date_trunc('week',day::timestamp)::date as week, sum(accounts) as accounts, sum(listings) as listings, sum(posts) as posts
    from days group by 1
  ) select jsonb_build_object(
    'week', monday, 'current_week', date_trunc('week',today::timestamp)::date,
    'days', (select jsonb_agg(to_jsonb(d) order by day) from days d where day >= monday),
    'previous', (select to_jsonb(w) from weeks w where week = monday-7),
    'trend', (select jsonb_agg(to_jsonb(w) order by week) from weeks w),
    'first_week', (select date_trunc('week',min(approved_at) at time zone 'Asia/Manila')::date from public.boardmate_approval_events),
    'tracking_started_at', (select tracking_started_at from public.boardmate_statistics_metadata where id),
    'as_of', now()
  ) into result;
  return result;
end;
$$;
alter function public.get_boardmate_weekly_statistics(date) owner to postgres;
revoke all on function public.get_boardmate_weekly_statistics(date) from public, anon;
grant execute on function public.get_boardmate_weekly_statistics(date) to authenticated;
notify pgrst, 'reload schema';
commit;
