create or replace function public.submit_boardmate_message_report(
  p_reported_user_id uuid,
  p_category text,
  p_reason text,
  p_evidence_path text default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  reporter_id uuid := (select auth.uid());
  report_id bigint;
  normalized_reason text := pg_catalog.btrim(p_reason);
begin
  if reporter_id is null
    or not (select public.is_boardmate_account_active(reporter_id)) then
    raise exception 'An active account is required to submit a report.';
  end if;

  if p_reported_user_id is null or p_reported_user_id = reporter_id then
    raise exception 'Choose another conversation participant to report.';
  end if;

  if p_category is null
    or p_category not in ('harassment', 'scam', 'safety', 'inappropriate', 'other') then
    raise exception 'Choose a valid report category.';
  end if;

  if normalized_reason is null or pg_catalog.char_length(normalized_reason) not between 3 and 1000 then
    raise exception 'Report details must be between 3 and 1,000 characters.';
  end if;

  if p_evidence_path is not null
    and pg_catalog.split_part(p_evidence_path, '/', 1) <> reporter_id::text then
    raise exception 'Report evidence must belong to your account.';
  end if;

  if not exists (
    select 1
    from public.direct_messages message
    where (message.sender_id = reporter_id and message.recipient_id = p_reported_user_id)
       or (message.sender_id = p_reported_user_id and message.recipient_id = reporter_id)
  ) then
    raise exception 'You can only report someone you have exchanged messages with.';
  end if;

  insert into public.direct_message_reports (
    reporter_id,
    reported_user_id,
    category,
    reason,
    evidence_path
  )
  values (
    reporter_id,
    p_reported_user_id,
    p_category,
    normalized_reason,
    p_evidence_path
  )
  returning id into report_id;

  return report_id;
end;
$$;

revoke all on function public.submit_boardmate_message_report(uuid, text, text, text) from public;
grant execute on function public.submit_boardmate_message_report(uuid, text, text, text) to authenticated;
revoke insert on public.direct_message_reports from authenticated;

create or replace function public.mark_boardmate_conversation_seen(p_contact_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null
    or p_contact_id is null
    or not (select public.is_boardmate_account_active(current_user_id)) then
    raise exception 'An active account is required to update message read receipts.';
  end if;

  update public.direct_messages
  set seen_at = pg_catalog.now()
  where sender_id = p_contact_id
    and recipient_id = current_user_id
    and seen_at is null;
end;
$$;

revoke all on function public.mark_boardmate_conversation_seen(uuid) from public;
grant execute on function public.mark_boardmate_conversation_seen(uuid) to authenticated;

notify pgrst, 'reload schema';
