alter table public.direct_messages
  add column if not exists deleted_at timestamptz,
  add column if not exists is_forwarded boolean not null default false;

alter table public.direct_messages
  drop constraint if exists direct_messages_content_check;
alter table public.direct_messages
  add constraint direct_messages_content_check
  check (
    deleted_at is not null
    or (
      (
        body is not null
        and char_length(pg_catalog.btrim(body)) between 1 and 2000
      )
      or attachment_path is not null
    )
  );

create table if not exists public.direct_message_user_deletions (
  user_id uuid not null references auth.users(id) on delete cascade,
  message_id bigint not null references public.direct_messages(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, message_id)
);

alter table public.direct_message_user_deletions enable row level security;
grant select, insert on public.direct_message_user_deletions to authenticated;

drop policy if exists "Users view their own hidden messages" on public.direct_message_user_deletions;
create policy "Users view their own hidden messages"
  on public.direct_message_user_deletions for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "Users hide their own messages" on public.direct_message_user_deletions;
create policy "Users hide their own messages"
  on public.direct_message_user_deletions for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (select public.is_boardmate_account_approved((select auth.uid())))
    and exists (
      select 1
      from public.direct_messages message
      where message.id = message_id
        and (message.sender_id = (select auth.uid()) or message.recipient_id = (select auth.uid()))
    )
  );

create table if not exists public.direct_message_reactions (
  message_id bigint not null references public.direct_messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  reaction text not null check (reaction in ('like', 'heart', 'laugh', 'surprise', 'sad', 'angry')),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

alter table public.direct_message_reactions enable row level security;
grant select, insert, update, delete on public.direct_message_reactions to authenticated;

drop policy if exists "Conversation participants view message reactions" on public.direct_message_reactions;
create policy "Conversation participants view message reactions"
  on public.direct_message_reactions for select to authenticated
  using (
    exists (
      select 1 from public.direct_messages message
      where message.id = message_id
        and message.deleted_at is null
        and (message.sender_id = (select auth.uid()) or message.recipient_id = (select auth.uid()))
        and (select public.is_boardmate_account_approved((select auth.uid())))
        and not (select public.is_boardmate_blocked_with(
          case when message.sender_id = (select auth.uid()) then message.recipient_id else message.sender_id end
        ))
    )
  );

drop policy if exists "Users add reactions to their conversations" on public.direct_message_reactions;
create policy "Users add reactions to their conversations"
  on public.direct_message_reactions for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.direct_messages message
      where message.id = message_id
        and message.deleted_at is null
        and (message.sender_id = (select auth.uid()) or message.recipient_id = (select auth.uid()))
        and (select public.is_boardmate_account_approved((select auth.uid())))
        and not (select public.is_boardmate_blocked_with(
          case when message.sender_id = (select auth.uid()) then message.recipient_id else message.sender_id end
        ))
    )
  );

drop policy if exists "Users update their own message reactions" on public.direct_message_reactions;
create policy "Users update their own message reactions"
  on public.direct_message_reactions for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.direct_messages message
      where message.id = message_id
        and message.deleted_at is null
        and (message.sender_id = (select auth.uid()) or message.recipient_id = (select auth.uid()))
        and (select public.is_boardmate_account_approved((select auth.uid())))
        and not (select public.is_boardmate_blocked_with(
          case when message.sender_id = (select auth.uid()) then message.recipient_id else message.sender_id end
        ))
    )
  );

drop policy if exists "Users remove their own message reactions" on public.direct_message_reactions;
create policy "Users remove their own message reactions"
  on public.direct_message_reactions for delete to authenticated
  using (user_id = (select auth.uid()));

create or replace function public.unsend_boardmate_message(
  p_message_id bigint,
  p_for_everyone boolean
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  message_row public.direct_messages%rowtype;
begin
  if (select auth.uid()) is null
    or not (select public.is_boardmate_account_approved((select auth.uid()))) then
    raise exception 'An active, verified account is required to unsend a message.';
  end if;

  select * into message_row
  from public.direct_messages
  where id = p_message_id
    and (
      sender_id = (select auth.uid())
      or recipient_id = (select auth.uid())
    )
  for update;

  if not found or message_row.deleted_at is not null then
    raise exception 'This message no longer exists or is not part of your conversation.';
  end if;

  if (select public.is_boardmate_blocked_with(
    case when message_row.sender_id = (select auth.uid())
      then message_row.recipient_id else message_row.sender_id end
  )) then
    raise exception 'This conversation is blocked.';
  end if;

  if p_for_everyone then
    if message_row.sender_id <> (select auth.uid()) then
      raise exception 'Only the sender can unsend a message for everyone.';
    end if;

    update public.direct_messages
    set body = null,
        attachment_path = null,
        attachment_mime = null,
        attachment_name = null,
        deleted_at = pg_catalog.now()
    where id = p_message_id;

    delete from public.direct_message_reactions
    where message_id = p_message_id;
  else
    insert into public.direct_message_user_deletions (user_id, message_id)
    values ((select auth.uid()), p_message_id)
    on conflict (user_id, message_id) do nothing;
  end if;

  return case when p_for_everyone then message_row.attachment_path else null end;
end;
$$;

revoke all on function public.unsend_boardmate_message(bigint, boolean) from public;
grant execute on function public.unsend_boardmate_message(bigint, boolean) to authenticated;

create or replace function public.react_to_boardmate_message(
  p_message_id bigint,
  p_reaction text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  message_row public.direct_messages%rowtype;
begin
  if (select auth.uid()) is null
    or not (select public.is_boardmate_account_approved((select auth.uid()))) then
    raise exception 'An active, verified account is required to react to messages.';
  end if;

  select * into message_row
  from public.direct_messages
  where id = p_message_id
    and (
      sender_id = (select auth.uid())
      or recipient_id = (select auth.uid())
    );
  if not found or message_row.deleted_at is not null then
    raise exception 'This message no longer exists or is not part of your conversation.';
  end if;

  if (select public.is_boardmate_blocked_with(
    case when message_row.sender_id = (select auth.uid())
      then message_row.recipient_id else message_row.sender_id end
  )) then
    raise exception 'This conversation is blocked.';
  end if;

  if p_reaction is null then
    delete from public.direct_message_reactions
    where message_id = p_message_id
      and user_id = (select auth.uid());
  elsif p_reaction in ('like', 'heart', 'laugh', 'surprise', 'sad', 'angry') then
    insert into public.direct_message_reactions (message_id, user_id, reaction)
    values (p_message_id, (select auth.uid()), p_reaction)
    on conflict (message_id, user_id)
    do update set reaction = excluded.reaction, created_at = pg_catalog.now();
  else
    raise exception 'Choose a supported message reaction.';
  end if;
end;
$$;

revoke all on function public.react_to_boardmate_message(bigint, text) from public;
grant execute on function public.react_to_boardmate_message(bigint, text) to authenticated;

create or replace function public.get_boardmate_message_contacts()
returns table (user_id uuid, full_name text, avatar_url text)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct profile.id, profile.full_name, profile.avatar_url
  from public.profiles profile
  join public.direct_messages dm
    on profile.id = case
      when dm.sender_id = (select auth.uid()) then dm.recipient_id
      else dm.sender_id
    end
  where (dm.sender_id = (select auth.uid()) or dm.recipient_id = (select auth.uid()))
    and (select public.is_boardmate_account_approved((select auth.uid())))
    and profile.verification_status = 'approved'
    and profile.suspended_at is null
    and not (select public.is_boardmate_blocked_with(profile.id))
  order by profile.full_name;
$$;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'direct_message_reactions'
    ) then
      execute 'alter publication supabase_realtime add table public.direct_message_reactions';
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'direct_message_user_deletions'
    ) then
      execute 'alter publication supabase_realtime add table public.direct_message_user_deletions';
    end if;
  end if;
end
$$;

notify pgrst, 'reload schema';
