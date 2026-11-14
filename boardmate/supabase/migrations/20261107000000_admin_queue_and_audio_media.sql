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
        attachment_mime in (
          'image/jpeg', 'image/png', 'image/webp', 'image/gif',
          'video/mp4', 'video/webm', 'video/quicktime',
          'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/ogg', 'audio/webm', 'audio/aac'
        )
        and pg_catalog.split_part(attachment_path, '/', 1) = sender_id::text
        and pg_catalog.split_part(attachment_path, '/', 2) = recipient_id::text
      )
    )
  );

update storage.buckets
set allowed_mime_types = array[
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'video/mp4', 'video/webm', 'video/quicktime',
  'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/ogg', 'audio/webm', 'audio/aac'
]
where id = 'direct-message-attachments';

update storage.buckets
set allowed_mime_types = array[
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'video/mp4', 'video/webm', 'video/quicktime',
  'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/ogg', 'audio/webm', 'audio/aac'
]
where id = 'direct-message-report-evidence';

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
  reporter_notice text;
  reported_notice text;
  reported_title text;
begin
  if not (select public.is_boardmate_admin()) then
    raise exception 'Only an administrator can resolve conversation reports.';
  end if;

  if p_decision not in ('dismissed', 'warning_issued', 'suspended') then
    raise exception 'Choose a valid report decision.';
  end if;

  select *
  into report_row
  from public.direct_message_reports
  where id = p_report_id
  for update;

  if not found then
    raise exception 'This report does not exist.';
  end if;

  if not (
    (report_row.status = 'open' and p_decision in ('dismissed', 'warning_issued', 'suspended'))
    or (report_row.status = 'warning_issued' and p_decision = 'suspended')
  ) then
    raise exception 'This report cannot be changed from its current status.';
  end if;

  update public.direct_message_reports
  set status = p_decision,
      resolution_note = nullif(pg_catalog.btrim(p_resolution_note), ''),
      reviewed_at = pg_catalog.now(),
      reviewed_by = (select auth.uid())
  where id = p_report_id
  returning * into report_row;

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
  reporter_notice := case p_decision
    when 'dismissed' then 'Our admin team reviewed your report and dismissed it.'
    when 'warning_issued' then 'Our admin team reviewed your report and issued the other account a warning.'
    else 'Our admin team reviewed your report and suspended the reported account.'
  end;
  reported_title := case p_decision
    when 'dismissed' then 'Report reviewed'
    when 'warning_issued' then 'Account warning'
    else 'Account suspended'
  end;
  reported_notice := case p_decision
    when 'dismissed' then 'An administrator reviewed a report about your account and took no action.'
    when 'warning_issued' then 'An administrator reviewed a report about your account and issued a warning.'
    else 'Your account has been suspended after an administrator reviewed a report. You cannot post, update listings, message, or use other account actions while suspended.'
  end;

  if nullif(pg_catalog.btrim(p_resolution_note), '') is not null then
    reporter_notice := reporter_notice || ' Admin note: ' || pg_catalog.btrim(p_resolution_note);
    reported_notice := reported_notice || ' Admin note: ' || pg_catalog.btrim(p_resolution_note);
  end if;

  insert into public.boardmate_notifications (user_id, report_id, title, body, target_type, target_id)
  values (
    report_row.reporter_id,
    report_row.id,
    status_title,
    reporter_notice,
    'conversation_report',
    report_row.id::text
  );

  insert into public.boardmate_notifications (user_id, report_id, title, body, target_type, target_id)
  values (
    report_row.reported_user_id,
    report_row.id,
    reported_title,
    reported_notice,
    'conversation_report',
    report_row.id::text
  );
end;
$$;

revoke all on function public.resolve_boardmate_message_report(bigint, text, text) from public;
grant execute on function public.resolve_boardmate_message_report(bigint, text, text) to authenticated;

notify pgrst, 'reload schema';
