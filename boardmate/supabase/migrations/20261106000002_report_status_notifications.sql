create or replace function public.notify_boardmate_report_submitted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.boardmate_notifications (user_id, report_id, title, body, target_type, target_id)
  values (
    new.reporter_id,
    new.id,
    'Your safety report is pending',
    'Your conversation report was submitted and is waiting for administrator review.',
    'conversation_report',
    new.id::text
  );
  return new;
end;
$$;

drop trigger if exists notify_boardmate_report_submitted on public.direct_message_reports;
create trigger notify_boardmate_report_submitted
  after insert on public.direct_message_reports
  for each row execute function public.notify_boardmate_report_submitted();

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

revoke all on function public.notify_boardmate_report_submitted() from public;

notify pgrst, 'reload schema';
