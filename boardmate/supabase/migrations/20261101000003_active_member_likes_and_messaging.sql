create or replace function public.is_boardmate_account_active(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles profile
    left join public.boardmate_account_preferences preference
      on preference.user_id = profile.id
    where profile.id = target_user_id
      and profile.suspended_at is null
      and coalesce(preference.is_active, true)
  );
$$;

revoke all on function public.is_boardmate_account_active(uuid) from public;
grant execute on function public.is_boardmate_account_active(uuid) to authenticated;

drop policy if exists "Participants can view their direct messages" on public.direct_messages;
drop policy if exists "Active members can view their direct messages" on public.direct_messages;
create policy "Participants can view their direct messages"
  on public.direct_messages for select to authenticated
  using (
    (sender_id = (select auth.uid()) or recipient_id = (select auth.uid()))
    and (select public.is_boardmate_account_active((select auth.uid())))
    and (select public.is_boardmate_account_active(
      case when sender_id = (select auth.uid()) then recipient_id else sender_id end
    ))
    and not (select public.is_boardmate_blocked_with(
      case when sender_id = (select auth.uid()) then recipient_id else sender_id end
    ))
  );

drop policy if exists "Approved users can send direct messages" on public.direct_messages;
drop policy if exists "Active members can send direct messages" on public.direct_messages;
create policy "Active members can send direct messages"
  on public.direct_messages for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and (recipient_id <> (select auth.uid()) or is_forwarded)
    and (select public.is_boardmate_account_active((select auth.uid())))
    and (select public.is_boardmate_account_active(recipient_id))
    and not (select public.is_boardmate_blocked_with(recipient_id))
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

drop policy if exists "Users manage their hidden conversations" on public.direct_message_hidden_conversations;
drop policy if exists "Active members manage their hidden conversations" on public.direct_message_hidden_conversations;
create policy "Users manage their hidden conversations"
  on public.direct_message_hidden_conversations for all to authenticated
  using (
    user_id = (select auth.uid())
    and (select public.is_boardmate_account_active((select auth.uid())))
    and not (select public.is_boardmate_blocked_with(contact_id))
  )
  with check (
    user_id = (select auth.uid())
    and (select public.is_boardmate_account_active((select auth.uid())))
    and not (select public.is_boardmate_blocked_with(contact_id))
  );

create or replace function public.get_boardmate_message_contacts()
returns table (user_id uuid, full_name text, avatar_url text)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct profile.id, profile.full_name, profile.avatar_url
  from public.profiles profile
  join public.direct_messages message
    on profile.id = case
      when message.sender_id = (select auth.uid()) then message.recipient_id
      else message.sender_id
    end
  where (message.sender_id = (select auth.uid()) or message.recipient_id = (select auth.uid()))
    and (select public.is_boardmate_account_active((select auth.uid())))
    and (select public.is_boardmate_account_active(profile.id))
    and not (select public.is_boardmate_blocked_with(profile.id));
$$;

revoke all on function public.get_boardmate_message_contacts() from public;
grant execute on function public.get_boardmate_message_contacts() to authenticated;

create or replace function public.get_boardmate_message_contact(p_contact_id uuid)
returns table (user_id uuid, full_name text, avatar_url text)
language sql
stable
security definer
set search_path = ''
as $$
  select profile.id, profile.full_name, profile.avatar_url
  from public.profiles profile
  where profile.id = p_contact_id
    and (select auth.uid()) is not null
    and (select public.is_boardmate_account_active((select auth.uid())))
    and (select public.is_boardmate_account_active(profile.id))
    and not (select public.is_boardmate_blocked_with(profile.id))
    and (
      exists (
        select 1
        from public.listings listing
        where listing.owner_id = profile.id
          and listing.is_available
          and listing.moderation_status = 'approved'
          and (select public.is_boardmate_profile_visible(profile.id))
      )
      or exists (
        select 1
        from public.roommate_posts post
        where post.user_id = profile.id
          and post.deleted_at is null
          and post.moderation_status = 'approved'
          and (select public.is_boardmate_profile_visible(profile.id))
      )
      or exists (
        select 1
        from public.direct_messages message
        where (message.sender_id = (select auth.uid()) and message.recipient_id = profile.id)
           or (message.sender_id = profile.id and message.recipient_id = (select auth.uid()))
      )
    );
$$;

revoke all on function public.get_boardmate_message_contact(uuid) from public;
grant execute on function public.get_boardmate_message_contact(uuid) to authenticated;

drop policy if exists "Approved users can view visible listing favorites" on public.listing_favorites;
drop policy if exists "Active members can view visible listing favorites" on public.listing_favorites;
create policy "Active members can view visible listing favorites"
  on public.listing_favorites for select to authenticated
  using (
    user_id = (select auth.uid())
    or (
      (select public.is_boardmate_account_active((select auth.uid())))
      and exists (
        select 1
        from public.listings listing
        where listing.id = listing_favorites.listing_id
          and (
            listing.owner_id = (select auth.uid())
            or (
              listing.is_available
              and listing.moderation_status = 'approved'
              and (select public.is_boardmate_profile_visible(listing.owner_id))
              and not (select public.is_boardmate_blocked_with(listing.owner_id))
            )
          )
      )
    )
  );

drop policy if exists "Approved users can favorite visible listings" on public.listing_favorites;
drop policy if exists "Active members can favorite visible listings" on public.listing_favorites;
create policy "Active members can favorite visible listings"
  on public.listing_favorites for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (select public.is_boardmate_account_active((select auth.uid())))
    and exists (
      select 1
      from public.listings listing
      where listing.id = listing_favorites.listing_id
        and listing.is_available
        and listing.moderation_status = 'approved'
        and (select public.is_boardmate_profile_visible(listing.owner_id))
        and not (select public.is_boardmate_blocked_with(listing.owner_id))
    )
  );

drop policy if exists "Users can remove their listing favorites" on public.listing_favorites;
drop policy if exists "Active members can remove their listing favorites" on public.listing_favorites;
create policy "Active members can remove their listing favorites"
  on public.listing_favorites for delete to authenticated
  using (
    user_id = (select auth.uid())
    and (select public.is_boardmate_account_active((select auth.uid())))
  );

drop policy if exists "Approved users can view visible roommate post likes" on public.roommate_post_likes;
drop policy if exists "Roommate authors can see likes on their posts" on public.roommate_post_likes;
drop policy if exists "Active members can view visible roommate post likes" on public.roommate_post_likes;
create policy "Active members can view visible roommate post likes"
  on public.roommate_post_likes for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1
      from public.roommate_posts post
      where post.id = roommate_post_likes.post_id
        and post.user_id = (select auth.uid())
    )
    or (
      (select public.is_boardmate_account_active((select auth.uid())))
      and exists (
        select 1
        from public.roommate_posts post
        where post.id = roommate_post_likes.post_id
          and post.deleted_at is null
          and post.moderation_status = 'approved'
          and (select public.is_boardmate_profile_visible(post.user_id))
          and not (select public.is_boardmate_blocked_with(post.user_id))
      )
    )
  );

drop policy if exists "Approved users can like visible roommate posts" on public.roommate_post_likes;
drop policy if exists "Active members can like visible roommate posts" on public.roommate_post_likes;
create policy "Active members can like visible roommate posts"
  on public.roommate_post_likes for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (select public.is_boardmate_account_active((select auth.uid())))
    and exists (
      select 1
      from public.roommate_posts post
      where post.id = roommate_post_likes.post_id
        and post.deleted_at is null
        and post.moderation_status = 'approved'
        and post.user_id <> (select auth.uid())
        and (select public.is_boardmate_profile_visible(post.user_id))
        and not (select public.is_boardmate_blocked_with(post.user_id))
    )
  );

drop policy if exists "Users can remove their roommate post likes" on public.roommate_post_likes;
drop policy if exists "Active members can remove their roommate post likes" on public.roommate_post_likes;
create policy "Active members can remove their roommate post likes"
  on public.roommate_post_likes for delete to authenticated
  using (
    user_id = (select auth.uid())
    and (select public.is_boardmate_account_active((select auth.uid())))
  );

drop policy if exists "Participants can upload direct message attachments" on storage.objects;
drop policy if exists "Active members can upload direct message attachments" on storage.objects;
create policy "Active members can upload direct message attachments"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'direct-message-attachments'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select public.is_boardmate_account_active((select auth.uid())))
    and (select public.is_boardmate_account_active(((storage.foldername(name))[2])::uuid))
    and not (select public.is_boardmate_blocked_with(((storage.foldername(name))[2])::uuid))
  );

drop policy if exists "Participants can view direct message attachments" on storage.objects;
drop policy if exists "Active members can view direct message attachments" on storage.objects;
create policy "Active members can view direct message attachments"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'direct-message-attachments'
    and (select public.is_boardmate_account_active((select auth.uid())))
    and exists (
      select 1
      from public.direct_messages message
      where message.attachment_path = storage.objects.name
        and (message.sender_id = (select auth.uid()) or message.recipient_id = (select auth.uid()))
        and not (select public.is_boardmate_blocked_with(
          case when message.sender_id = (select auth.uid()) then message.recipient_id else message.sender_id end
        ))
    )
  );

drop policy if exists "Users hide their own messages" on public.direct_message_user_deletions;
drop policy if exists "Active members hide their own messages" on public.direct_message_user_deletions;
create policy "Active members hide their own messages"
  on public.direct_message_user_deletions for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (select public.is_boardmate_account_active((select auth.uid())))
    and exists (
      select 1
      from public.direct_messages message
      where message.id = message_id
        and (message.sender_id = (select auth.uid()) or message.recipient_id = (select auth.uid()))
        and not (select public.is_boardmate_blocked_with(
          case when message.sender_id = (select auth.uid()) then message.recipient_id else message.sender_id end
        ))
    )
  );

drop policy if exists "Conversation participants view message reactions" on public.direct_message_reactions;
drop policy if exists "Active members view message reactions" on public.direct_message_reactions;
create policy "Active members view message reactions"
  on public.direct_message_reactions for select to authenticated
  using (
    exists (
      select 1
      from public.direct_messages message
      where message.id = message_id
        and message.deleted_at is null
        and (message.sender_id = (select auth.uid()) or message.recipient_id = (select auth.uid()))
        and (select public.is_boardmate_account_active((select auth.uid())))
        and (select public.is_boardmate_account_active(
          case when message.sender_id = (select auth.uid()) then message.recipient_id else message.sender_id end
        ))
        and not (select public.is_boardmate_blocked_with(
          case when message.sender_id = (select auth.uid()) then message.recipient_id else message.sender_id end
        ))
    )
  );

drop policy if exists "Users add reactions to their conversations" on public.direct_message_reactions;
drop policy if exists "Active members add reactions to their conversations" on public.direct_message_reactions;
create policy "Active members add reactions to their conversations"
  on public.direct_message_reactions for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1
      from public.direct_messages message
      where message.id = message_id
        and message.deleted_at is null
        and (message.sender_id = (select auth.uid()) or message.recipient_id = (select auth.uid()))
        and (select public.is_boardmate_account_active((select auth.uid())))
        and (select public.is_boardmate_account_active(
          case when message.sender_id = (select auth.uid()) then message.recipient_id else message.sender_id end
        ))
        and not (select public.is_boardmate_blocked_with(
          case when message.sender_id = (select auth.uid()) then message.recipient_id else message.sender_id end
        ))
    )
  );

drop policy if exists "Users update their own message reactions" on public.direct_message_reactions;
drop policy if exists "Active members update their own message reactions" on public.direct_message_reactions;
create policy "Active members update their own message reactions"
  on public.direct_message_reactions for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1
      from public.direct_messages message
      where message.id = message_id
        and message.deleted_at is null
        and (message.sender_id = (select auth.uid()) or message.recipient_id = (select auth.uid()))
        and (select public.is_boardmate_account_active((select auth.uid())))
        and (select public.is_boardmate_account_active(
          case when message.sender_id = (select auth.uid()) then message.recipient_id else message.sender_id end
        ))
        and not (select public.is_boardmate_blocked_with(
          case when message.sender_id = (select auth.uid()) then message.recipient_id else message.sender_id end
        ))
    )
  );

create or replace function public.hide_boardmate_conversation(p_contact_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null
    or p_contact_id = (select auth.uid())
    or not (select public.is_boardmate_account_active((select auth.uid())))
    or not (select public.is_boardmate_account_active(p_contact_id))
    or (select public.is_boardmate_blocked_with(p_contact_id)) then
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

create or replace function public.mark_boardmate_conversation_seen(p_contact_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null
    or p_contact_id = (select auth.uid())
    or not (select public.is_boardmate_account_active((select auth.uid())))
    or not (select public.is_boardmate_account_active(p_contact_id))
    or (select public.is_boardmate_blocked_with(p_contact_id)) then
    raise exception 'An active, unblocked conversation participant is required.';
  end if;

  update public.direct_messages
  set seen_at = pg_catalog.now()
  where sender_id = p_contact_id
    and recipient_id = (select auth.uid())
    and seen_at is null;
end;
$$;

revoke all on function public.mark_boardmate_conversation_seen(uuid) from public;
grant execute on function public.mark_boardmate_conversation_seen(uuid) to authenticated;

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
    or not (select public.is_boardmate_account_active((select auth.uid()))) then
    raise exception 'An active account is required to unsend a message.';
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

  if not (select public.is_boardmate_account_active(
    case when message_row.sender_id = (select auth.uid())
      then message_row.recipient_id else message_row.sender_id end
  )) or (select public.is_boardmate_blocked_with(
    case when message_row.sender_id = (select auth.uid())
      then message_row.recipient_id else message_row.sender_id end
  )) then
    raise exception 'This conversation is unavailable.';
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
    or not (select public.is_boardmate_account_active((select auth.uid()))) then
    raise exception 'An active account is required to react to messages.';
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

  if not (select public.is_boardmate_account_active(
    case when message_row.sender_id = (select auth.uid())
      then message_row.recipient_id else message_row.sender_id end
  )) or (select public.is_boardmate_blocked_with(
    case when message_row.sender_id = (select auth.uid())
      then message_row.recipient_id else message_row.sender_id end
  )) then
    raise exception 'This conversation is unavailable.';
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

notify pgrst, 'reload schema';
