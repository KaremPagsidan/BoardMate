alter table public.profiles
  add column if not exists suspended_at timestamptz,
  add column if not exists suspended_by uuid references public.admin_memberships(user_id) on delete set null,
  add column if not exists suspension_reason text;

create or replace function public.is_boardmate_account_approved(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = target_user_id
      and verification_status = 'approved'
      and suspended_at is null
  );
$$;

revoke all on function public.is_boardmate_account_approved(uuid) from public;
grant execute on function public.is_boardmate_account_approved(uuid) to authenticated;

create table if not exists public.blocked_boardmate_users (
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_user_id),
  constraint blocked_boardmate_users_distinct_users check (blocker_id <> blocked_user_id)
);

create index if not exists blocked_boardmate_users_blocked_idx
  on public.blocked_boardmate_users(blocked_user_id);

alter table public.blocked_boardmate_users enable row level security;
grant select, insert, delete on public.blocked_boardmate_users to authenticated;

drop policy if exists "Users manage their account blocks" on public.blocked_boardmate_users;
create policy "Users manage their account blocks"
  on public.blocked_boardmate_users for all to authenticated
  using (blocker_id = (select auth.uid()))
  with check (
    blocker_id = (select auth.uid())
    and (select public.is_boardmate_account_approved((select auth.uid())))
  );

create or replace function public.is_boardmate_blocked_with(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.blocked_boardmate_users
    where (blocker_id = (select auth.uid()) and blocked_user_id = target_user_id)
       or (blocker_id = target_user_id and blocked_user_id = (select auth.uid()))
  );
$$;

revoke all on function public.is_boardmate_blocked_with(uuid) from public;
grant execute on function public.is_boardmate_blocked_with(uuid) to authenticated;

create or replace function public.get_boardmate_blocked_users()
returns table (user_id uuid, full_name text, avatar_url text)
language sql
stable
security definer
set search_path = ''
as $$
  select profile.id, profile.full_name, profile.avatar_url
  from public.blocked_boardmate_users blocked
  join public.profiles profile on profile.id = blocked.blocked_user_id
  where blocked.blocker_id = (select auth.uid())
  order by blocked.created_at desc;
$$;

revoke all on function public.get_boardmate_blocked_users() from public;
grant execute on function public.get_boardmate_blocked_users() to authenticated;

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
    and not (select public.is_boardmate_blocked_with(profile.id));
$$;

alter table public.direct_message_reports
  add column if not exists category text not null default 'other',
  add column if not exists evidence_path text,
  add column if not exists resolution_note text,
  add column if not exists reviewed_by uuid references public.admin_memberships(user_id) on delete set null;

alter table public.direct_message_reports
  drop constraint if exists direct_message_reports_status_check;
update public.direct_message_reports
set status = 'dismissed'
where status = 'reviewed';
alter table public.direct_message_reports
  add constraint direct_message_reports_status_check
  check (status in ('open', 'dismissed', 'warning_issued', 'suspended'));

alter table public.direct_message_reports
  drop constraint if exists direct_message_reports_category_check;
alter table public.direct_message_reports
  add constraint direct_message_reports_category_check
  check (category in ('harassment', 'scam', 'safety', 'inappropriate', 'other'));

drop policy if exists "Users can report conversation participants" on public.direct_message_reports;
create policy "Users can report conversation participants"
  on public.direct_message_reports for insert to authenticated
  with check (
    reporter_id = (select auth.uid())
    and reporter_id <> reported_user_id
    and (select public.is_boardmate_account_approved((select auth.uid())))
    and (evidence_path is null or split_part(evidence_path, '/', 1) = reporter_id::text)
    and exists (
      select 1
      from public.direct_messages message
      where (message.sender_id = (select auth.uid()) and message.recipient_id = reported_user_id)
         or (message.sender_id = reported_user_id and message.recipient_id = (select auth.uid()))
    )
  );

drop policy if exists "Reporters can view their submitted reports" on public.direct_message_reports;
create policy "Reporters can view their submitted reports"
  on public.direct_message_reports for select to authenticated
  using (reporter_id = (select auth.uid()));

drop policy if exists "Admins can view direct message reports" on public.direct_message_reports;
create policy "Admins can view direct message reports"
  on public.direct_message_reports for select to authenticated
  using ((select public.is_boardmate_admin()));

create table if not exists public.boardmate_notifications (
  id bigint generated by default as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  report_id bigint references public.direct_message_reports(id) on delete cascade,
  title text not null,
  body text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index if not exists boardmate_notifications_user_created_idx
  on public.boardmate_notifications(user_id, created_at desc);

alter table public.boardmate_notifications enable row level security;
grant select, update on public.boardmate_notifications to authenticated;

drop policy if exists "Users can view their notifications" on public.boardmate_notifications;
create policy "Users can view their notifications"
  on public.boardmate_notifications for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "Users can mark their notifications read" on public.boardmate_notifications;
create policy "Users can mark their notifications read"
  on public.boardmate_notifications for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create or replace function public.resolve_boardmate_message_report(
  p_report_id bigint,
  p_decision text,
  p_resolution_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  report_row public.direct_message_reports%rowtype;
  status_title text;
  notice_body text;
begin
  if not (select public.is_boardmate_admin()) then
    raise exception 'Only an administrator can resolve conversation reports.';
  end if;

  if p_decision not in ('dismissed', 'warning_issued', 'suspended') then
    raise exception 'Choose a valid report decision.';
  end if;

  update public.direct_message_reports
  set status = p_decision,
      resolution_note = nullif(pg_catalog.btrim(p_resolution_note), ''),
      reviewed_at = pg_catalog.now(),
      reviewed_by = (select auth.uid())
  where id = p_report_id
    and status = 'open'
  returning * into report_row;

  if not found then
    raise exception 'This report was already resolved or does not exist.';
  end if;

  if p_decision = 'suspended' then
    update public.profiles
    set suspended_at = pg_catalog.now(),
        suspended_by = (select auth.uid()),
        suspension_reason = coalesce(
          nullif(pg_catalog.btrim(p_resolution_note), ''),
          'Suspended after review of a conversation report.'
        )
    where id = report_row.reported_user_id;
  end if;

  status_title := case p_decision
    when 'dismissed' then 'Report reviewed'
    when 'warning_issued' then 'Report reviewed: warning issued'
    else 'Account suspended after report review'
  end;
  notice_body := case p_decision
    when 'dismissed' then 'Our admin team reviewed your report and dismissed it.'
    when 'warning_issued' then 'Our admin team reviewed your report and issued the other account a warning.'
    else 'Our admin team reviewed your report and suspended the reported account.'
  end;
  if nullif(pg_catalog.btrim(p_resolution_note), '') is not null then
    notice_body := notice_body || ' Admin note: ' || pg_catalog.btrim(p_resolution_note);
  end if;

  insert into public.boardmate_notifications (user_id, report_id, title, body)
  values (report_row.reporter_id, report_row.id, status_title, notice_body);

  if p_decision in ('warning_issued', 'suspended') then
    insert into public.boardmate_notifications (user_id, report_id, title, body)
    values (
      report_row.reported_user_id,
      report_row.id,
      case p_decision when 'warning_issued' then 'Account warning' else 'Account suspended' end,
      case p_decision
        when 'warning_issued' then 'An administrator reviewed a report about your account and issued a warning.'
        else 'Your account has been suspended after an administrator reviewed a report. You cannot post, update listings, message, or use other account actions while suspended.'
      end || coalesce(' Admin note: ' || nullif(pg_catalog.btrim(p_resolution_note), ''), '')
    );
  end if;
end;
$$;

revoke all on function public.resolve_boardmate_message_report(bigint, text, text) from public;
grant execute on function public.resolve_boardmate_message_report(bigint, text, text) to authenticated;

drop policy if exists "Admins can update direct message reports" on public.direct_message_reports;
revoke update on public.direct_message_reports from authenticated;

create or replace function public.protect_boardmate_suspension_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not public.is_boardmate_admin()
    and (
      new.suspended_at is distinct from old.suspended_at
      or new.suspended_by is distinct from old.suspended_by
      or new.suspension_reason is distinct from old.suspension_reason
      or old.suspended_at is not null
    ) then
    raise exception 'Only an administrator can change or edit a suspended account.';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_boardmate_suspension_fields on public.profiles;
create trigger protect_boardmate_suspension_fields
  before update on public.profiles
  for each row execute function public.protect_boardmate_suspension_fields();

drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
  on public.profiles for update to authenticated
  using (
    (id = (select auth.uid()) and suspended_at is null)
    or (select public.is_boardmate_admin())
  )
  with check (
    (id = (select auth.uid()) and suspended_at is null)
    or (select public.is_boardmate_admin())
  );

drop policy if exists "Authenticated users can view available listings" on public.listings;
create policy "Authenticated users can view available listings"
  on public.listings for select to authenticated
  using (
    is_available
    and moderation_status = 'approved'
    and (select public.is_boardmate_account_approved((select auth.uid())))
    and (select public.is_boardmate_account_approved(owner_id))
    and not (select public.is_boardmate_blocked_with(owner_id))
  );

drop policy if exists "Owners can insert their listings" on public.listings;
create policy "Owners can insert their listings"
  on public.listings for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and (select public.is_boardmate_account_approved((select auth.uid())))
    and exists (
      select 1 from public.profiles
      where profiles.id = (select auth.uid())
        and upper(profiles.role::text) in ('OWNER', 'LANDLORD')
    )
  );

drop policy if exists "Owners can update their listings" on public.listings;
create policy "Owners can update their listings"
  on public.listings for update to authenticated
  using (
    (owner_id = (select auth.uid())
      and (select public.is_boardmate_account_approved((select auth.uid())))
      and exists (
        select 1 from public.profiles
        where profiles.id = (select auth.uid())
          and upper(profiles.role::text) in ('OWNER', 'LANDLORD')
      ))
    or (select public.is_boardmate_admin())
  )
  with check (owner_id = (select auth.uid()) or (select public.is_boardmate_admin()));

drop policy if exists "Users can view visible roommate posts" on public.roommate_posts;
create policy "Users can view visible roommate posts"
  on public.roommate_posts for select to authenticated
  using (
    (deleted_at is null
      and moderation_status = 'approved'
      and (select public.is_boardmate_account_approved((select auth.uid())))
      and (select public.is_boardmate_account_approved(user_id))
      and not (select public.is_boardmate_blocked_with(user_id)))
    or (user_id = (select auth.uid()) and deleted_at is null)
    or (select public.is_boardmate_admin())
  );

drop policy if exists "Users can create their roommate posts" on public.roommate_posts;
create policy "Users can create their roommate posts"
  on public.roommate_posts for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (select public.is_boardmate_account_approved((select auth.uid())))
    and exists (
      select 1 from public.profiles
      where profiles.id = (select auth.uid())
        and upper(profiles.role::text) in ('RENTER', 'USER')
    )
  );

drop policy if exists "Owners can update active roommate posts" on public.roommate_posts;
create policy "Owners can update active roommate posts"
  on public.roommate_posts for update to authenticated
  using (
    (user_id = (select auth.uid())
      and deleted_at is null
      and (select public.is_boardmate_account_approved((select auth.uid()))))
    or (select public.is_boardmate_admin())
  )
  with check (user_id = (select auth.uid()) or (select public.is_boardmate_admin()));

create or replace function public.delete_own_roommate_post(p_post_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_heading text;
begin
  if (select auth.uid()) is null
    or not (select public.is_boardmate_account_approved((select auth.uid()))) then
    raise exception 'An active, verified account is required to delete a roommate post.';
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

drop policy if exists "Participants can view their direct messages" on public.direct_messages;
create policy "Participants can view their direct messages"
  on public.direct_messages for select to authenticated
  using (
    (sender_id = (select auth.uid()) or recipient_id = (select auth.uid()))
    and (select public.is_boardmate_account_approved((select auth.uid())))
    and not (select public.is_boardmate_blocked_with(
      case when sender_id = (select auth.uid()) then recipient_id else sender_id end
    ))
  );

drop policy if exists "Approved users can send direct messages" on public.direct_messages;
create policy "Approved users can send direct messages"
  on public.direct_messages for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and recipient_id <> (select auth.uid())
    and (select public.is_boardmate_account_approved((select auth.uid())))
    and (select public.is_boardmate_account_approved(recipient_id))
    and not (select public.is_boardmate_blocked_with(recipient_id))
  );

drop policy if exists "Users manage their hidden conversations" on public.direct_message_hidden_conversations;
create policy "Users manage their hidden conversations"
  on public.direct_message_hidden_conversations for all to authenticated
  using (
    user_id = (select auth.uid())
    and (select public.is_boardmate_account_approved((select auth.uid())))
    and not (select public.is_boardmate_blocked_with(contact_id))
  )
  with check (
    user_id = (select auth.uid())
    and (select public.is_boardmate_account_approved((select auth.uid())))
    and not (select public.is_boardmate_blocked_with(contact_id))
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
    or not (select public.is_boardmate_account_approved((select auth.uid())))
    or (select public.is_boardmate_blocked_with(p_contact_id)) then
    raise exception 'A valid, unblocked conversation participant is required.';
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

create or replace function public.mark_boardmate_conversation_seen(p_contact_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null
    or p_contact_id = (select auth.uid())
    or not (select public.is_boardmate_account_approved((select auth.uid())))
    or (select public.is_boardmate_blocked_with(p_contact_id)) then
    raise exception 'A valid, unblocked conversation participant is required.';
  end if;

  update public.direct_messages
  set seen_at = pg_catalog.now()
  where sender_id = p_contact_id
    and recipient_id = (select auth.uid())
    and seen_at is null;
end;
$$;

drop policy if exists "Users can update their own boardmate presence" on public.boardmate_presence;
drop policy if exists "Users can refresh their own boardmate presence" on public.boardmate_presence;
create policy "Users can update their own boardmate presence"
  on public.boardmate_presence for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (select public.is_boardmate_account_approved((select auth.uid())))
  );
create policy "Users can refresh their own boardmate presence"
  on public.boardmate_presence for update to authenticated
  using (
    user_id = (select auth.uid())
    and (select public.is_boardmate_account_approved((select auth.uid())))
  )
  with check (
    user_id = (select auth.uid())
    and (select public.is_boardmate_account_approved((select auth.uid())))
  );

drop policy if exists "Approved users can favorite visible listings" on public.listing_favorites;
create policy "Approved users can favorite visible listings"
  on public.listing_favorites for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (select public.is_boardmate_account_approved((select auth.uid())))
    and exists (
      select 1 from public.listings listing
      where listing.id = listing_favorites.listing_id
        and listing.is_available
        and listing.moderation_status = 'approved'
        and not (select public.is_boardmate_blocked_with(listing.owner_id))
    )
  );

drop policy if exists "Approved users can like visible roommate posts" on public.roommate_post_likes;
create policy "Approved users can like visible roommate posts"
  on public.roommate_post_likes for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (select public.is_boardmate_account_approved((select auth.uid())))
    and exists (
      select 1 from public.roommate_posts post
      where post.id = roommate_post_likes.post_id
        and post.deleted_at is null
        and post.moderation_status = 'approved'
        and post.user_id <> (select auth.uid())
        and (select public.is_boardmate_account_approved(post.user_id))
        and not (select public.is_boardmate_blocked_with(post.user_id))
    )
  );

drop policy if exists "Users can remove their roommate post likes" on public.roommate_post_likes;
create policy "Users can remove their roommate post likes"
  on public.roommate_post_likes for delete to authenticated
  using (
    user_id = (select auth.uid())
    and (select public.is_boardmate_account_approved((select auth.uid())))
  );

drop policy if exists "Users can remove their listing favorites" on public.listing_favorites;
create policy "Users can remove their listing favorites"
  on public.listing_favorites for delete to authenticated
  using (
    user_id = (select auth.uid())
    and (select public.is_boardmate_account_approved((select auth.uid())))
  );

drop policy if exists "Participants can upload direct message attachments" on storage.objects;
create policy "Participants can upload direct message attachments"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'direct-message-attachments'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select public.is_boardmate_account_approved((select auth.uid())))
    and (select public.is_boardmate_account_approved(((storage.foldername(name))[2])::uuid))
    and not (select public.is_boardmate_blocked_with(((storage.foldername(name))[2])::uuid))
  );

drop policy if exists "Participants can view direct message attachments" on storage.objects;
create policy "Participants can view direct message attachments"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'direct-message-attachments'
    and (select public.is_boardmate_account_approved((select auth.uid())))
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

drop policy if exists "Users can upload their profile photos" on storage.objects;
create policy "Users can upload their profile photos"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'profile-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (
      select 1 from public.profiles
      where profiles.id = (select auth.uid())
        and profiles.suspended_at is null
    )
  );

drop policy if exists "Users can update their profile photos" on storage.objects;
create policy "Users can update their profile photos"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'profile-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (
      select 1 from public.profiles
      where profiles.id = (select auth.uid())
        and profiles.suspended_at is null
    )
  )
  with check (
    bucket_id = 'profile-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (
      select 1 from public.profiles
      where profiles.id = (select auth.uid())
        and profiles.suspended_at is null
    )
  );

drop policy if exists "Users can upload their listing photos" on storage.objects;
create policy "Users can upload their listing photos"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'listing-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select public.is_boardmate_account_approved((select auth.uid())))
    and exists (
      select 1 from public.profiles
      where profiles.id = (select auth.uid())
        and upper(profiles.role::text) in ('OWNER', 'LANDLORD')
    )
  );

drop policy if exists "Users upload their own verification documents" on storage.objects;
create policy "Users upload their own verification documents"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'verification-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (
      select 1 from public.profiles
      where profiles.id = (select auth.uid())
        and profiles.suspended_at is null
    )
  );

drop policy if exists "Users replace their own verification documents" on storage.objects;
create policy "Users replace their own verification documents"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'verification-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (
      select 1 from public.profiles
      where profiles.id = (select auth.uid())
        and profiles.suspended_at is null
    )
  )
  with check (
    bucket_id = 'verification-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (
      select 1 from public.profiles
      where profiles.id = (select auth.uid())
        and profiles.suspended_at is null
    )
  );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'direct-message-report-evidence',
  'direct-message-report-evidence',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Reporters can upload their report evidence" on storage.objects;
create policy "Reporters can upload their report evidence"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'direct-message-report-evidence'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select public.is_boardmate_account_approved((select auth.uid())))
  );

drop policy if exists "Admins can view report evidence" on storage.objects;
create policy "Admins can view report evidence"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'direct-message-report-evidence'
    and (select public.is_boardmate_admin())
  );

drop policy if exists "Reporters can remove unassociated evidence" on storage.objects;
create policy "Reporters can remove unassociated evidence"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'direct-message-report-evidence'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and not exists (
      select 1
      from public.direct_message_reports report
      where report.evidence_path = storage.objects.name
    )
  );

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'boardmate_notifications'
    ) then
    execute 'alter publication supabase_realtime add table public.boardmate_notifications';
  end if;
end
$$;

notify pgrst, 'reload schema';
