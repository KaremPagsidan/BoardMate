alter table public.direct_messages
  drop constraint if exists direct_messages_distinct_participants;

alter table public.direct_messages
  add constraint direct_messages_distinct_participants
  check (sender_id <> recipient_id or is_forwarded);

drop policy if exists "Approved users can send direct messages" on public.direct_messages;
create policy "Approved users can send direct messages"
  on public.direct_messages for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and (recipient_id <> (select auth.uid()) or is_forwarded)
    and (select public.is_boardmate_account_approved((select auth.uid())))
    and (select public.is_boardmate_account_approved(recipient_id))
    and not (select public.is_boardmate_blocked_with(recipient_id))
  );

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

  insert into public.boardmate_presence (user_id, last_seen_at)
  values (current_user_id, pg_catalog.now())
  on conflict (user_id)
  do update set last_seen_at = excluded.last_seen_at;
end;
$$;

revoke all on function public.publish_boardmate_presence() from public;
grant execute on function public.publish_boardmate_presence() to authenticated;

notify pgrst, 'reload schema';
