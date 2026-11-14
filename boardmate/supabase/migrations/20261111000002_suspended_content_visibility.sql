-- Suspension visibility restrictions. No moderation/availability values are rewritten.
begin;
do $$ begin
  if exists(select 1 from pg_catalog.pg_class
    where oid in ('public.listings'::regclass, 'public.roommate_posts'::regclass, 'public.direct_messages'::regclass)
      and not relrowsecurity) then
    raise exception 'Existing listings, posts and messaging RLS must be enabled before this migration.';
  end if;
end $$;
create function public.boardmate_account_not_suspended(p_user_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles where id = p_user_id and suspended_at is null);
$$;
create function public.boardmate_content_owner_accessible(p_user_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select (auth.uid() is not null and (p_user_id = auth.uid() or public.is_boardmate_admin()))
    or public.boardmate_account_not_suspended(p_user_id);
$$;
alter function public.boardmate_account_not_suspended(uuid) owner to postgres;
alter function public.boardmate_content_owner_accessible(uuid) owner to postgres;
revoke all on function public.boardmate_account_not_suspended(uuid) from public;
revoke all on function public.boardmate_content_owner_accessible(uuid) from public;
grant execute on function public.boardmate_account_not_suspended(uuid), public.boardmate_content_owner_accessible(uuid) to anon, authenticated;

-- Restrictive policies AND with all existing permissive policies; an additional
-- permissive SELECT policy cannot accidentally reopen suspended content.
create policy "Suspended owner listing visibility" on public.listings as restrictive
  for select to public using (public.boardmate_content_owner_accessible(owner_id));
create policy "Suspended author post visibility" on public.roommate_posts as restrictive
  for select to public using (public.boardmate_content_owner_accessible(user_id));
create policy "Non suspended message participants" on public.direct_messages as restrictive
  for insert to authenticated with check (
    public.boardmate_account_not_suspended(sender_id) and public.boardmate_account_not_suspended(recipient_id)
  );

-- Serialize sends against suspension so a send started after a suspension
-- commits cannot succeed using a stale preflight result. Existing policies still
-- enforce identity, blocks, active-account preferences and attachment constraints.
create function public.guard_boardmate_message_suspension() returns trigger
language plpgsql security definer set search_path = '' as $$
declare participant record; participant_count integer := 0;
begin
  for participant in select id, suspended_at from public.profiles
    where id in (new.sender_id, new.recipient_id) order by id for share loop
    participant_count := participant_count + 1;
    if participant.suspended_at is not null then
      raise exception 'This conversation is unavailable while an account is suspended.' using errcode = '42501';
    end if;
  end loop;
  if participant_count <> (case when new.sender_id = new.recipient_id then 1 else 2 end) then
    raise exception 'This conversation is unavailable.' using errcode = '42501';
  end if;
  return new;
end;
$$;
alter function public.guard_boardmate_message_suspension() owner to postgres;
revoke all on function public.guard_boardmate_message_suspension() from public, anon, authenticated;
create trigger guard_boardmate_message_suspension before insert on public.direct_messages
  for each row execute function public.guard_boardmate_message_suspension();

-- Only a revision is broadcast, never private profile fields or suspension reasons.
create table public.boardmate_visibility_revision (
  id boolean primary key default true check (id),
  revision bigint not null default 0
);
insert into public.boardmate_visibility_revision(id) values(true);
alter table public.boardmate_visibility_revision enable row level security;
revoke all on public.boardmate_visibility_revision from public, anon, authenticated;
grant select on public.boardmate_visibility_revision to authenticated;
create policy "Members read visibility revision" on public.boardmate_visibility_revision
  for select to authenticated using (true);
create function public.publish_boardmate_visibility_revision() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.boardmate_visibility_revision set revision = revision + 1 where id;
  return null;
end;
$$;
alter function public.publish_boardmate_visibility_revision() owner to postgres;
revoke all on function public.publish_boardmate_visibility_revision() from public, anon, authenticated;
create trigger publish_boardmate_visibility_revision after update of suspended_at on public.profiles
  for each row when (old.suspended_at is distinct from new.suspended_at)
  execute function public.publish_boardmate_visibility_revision();
-- Supabase publication must exist in staging/production. Local fixtures may omit it.
do $$ begin
  if exists(select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.boardmate_visibility_revision;
  end if;
end $$;
commit;
