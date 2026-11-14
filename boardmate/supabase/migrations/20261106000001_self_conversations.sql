alter table public.direct_messages
  drop constraint if exists direct_messages_distinct_participants;

drop policy if exists "Approved users can send direct messages" on public.direct_messages;
drop policy if exists "Active members can send direct messages" on public.direct_messages;
create policy "Active members can send direct messages"
  on public.direct_messages for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and (select public.is_boardmate_account_active((select auth.uid())))
    and (select public.is_boardmate_account_active(recipient_id))
    and (
      recipient_id = sender_id
      or not (select public.is_boardmate_blocked_with(recipient_id))
    )
    and (
      (body is not null and char_length(pg_catalog.btrim(body)) between 1 and 2000)
      or attachment_path is not null
    )
    and (
      attachment_path is null
      or (
        attachment_mime in ('image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm', 'video/quicktime')
        and pg_catalog.split_part(attachment_path, '/', 1) = sender_id::text
        and pg_catalog.split_part(attachment_path, '/', 2) = recipient_id::text
      )
    )
  );

alter table public.direct_message_hidden_conversations
  drop constraint if exists direct_message_hidden_conversations_distinct_users;

create or replace function public.hide_boardmate_conversation(p_contact_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null
    or p_contact_id is null
    or not (select public.is_boardmate_account_active((select auth.uid())))
    or not (select public.is_boardmate_account_active(p_contact_id))
    or (
      p_contact_id <> (select auth.uid())
      and (select public.is_boardmate_blocked_with(p_contact_id))
    ) then
    raise exception 'An active, unblocked conversation participant is required.';
  end if;

  if not exists (
    select 1
    from public.direct_messages message
    where (message.sender_id = (select auth.uid()) and message.recipient_id = p_contact_id)
       or (message.sender_id = p_contact_id and message.recipient_id = (select auth.uid()))
  ) then
    raise exception 'Conversation not found.';
  end if;

  insert into public.direct_message_hidden_conversations (user_id, contact_id, hidden_at)
  values ((select auth.uid()), p_contact_id, pg_catalog.now())
  on conflict (user_id, contact_id)
  do update set hidden_at = excluded.hidden_at;
end;
$$;

revoke all on function public.hide_boardmate_conversation(uuid) from public;
grant execute on function public.hide_boardmate_conversation(uuid) to authenticated;

notify pgrst, 'reload schema';
