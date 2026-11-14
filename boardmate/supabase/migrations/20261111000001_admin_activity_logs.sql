-- DRAFT: review and test locally before applying. Does not relabel legacy history.
begin;
create table public.admin_activity_logs (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  action text not null,
  details text not null,
  target_table text,
  target_id text,
  changed_fields text[] not null default '{}',
  session_id text,
  created_at timestamptz not null default now(),
  unique(user_id, action, session_id)
);
create index admin_activity_logs_created_idx on public.admin_activity_logs(created_at desc, id desc);
alter table public.admin_activity_logs enable row level security;
revoke all on public.admin_activity_logs from public, anon, authenticated;
grant select on public.admin_activity_logs to authenticated;
create policy "Administrators read administrative audit" on public.admin_activity_logs
  for select to authenticated using (public.is_boardmate_admin());

create function public.audit_boardmate_admin_mutation() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  before_row jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) else '{}'::jsonb end;
  after_row jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) else '{}'::jsonb end;
  item jsonb;
  fields text[];
  label text;
begin
  -- Derive the actor from the authenticated request, never target ownership or role text.
  if auth.uid() is null or not public.is_boardmate_admin() then return null; end if;
  if tg_op = 'UPDATE' and before_row = after_row then return null; end if;
  item := case when tg_op = 'DELETE' then before_row else after_row end;
  select array_agg(k order by k) into fields from
    (select jsonb_object_keys(before_row || after_row) as k) keys
    where before_row -> k is distinct from after_row -> k;
  label := tg_table_name || ' ' || lower(tg_op);
  if tg_op = 'UPDATE' and tg_table_name = 'profiles' and 'suspended_at' = any(fields) then
    label := case when after_row ->> 'suspended_at' is null then 'Account reinstated' else 'Account suspended' end;
  elsif tg_op = 'UPDATE' and tg_table_name = 'profiles' and 'verification_status' = any(fields) then
    label := 'Account verification ' || coalesce(after_row ->> 'verification_status', 'updated');
  elsif tg_op = 'UPDATE' and tg_table_name in ('listings', 'roommate_posts') and 'moderation_status' = any(fields) then
    label := tg_table_name || ' ' || coalesce(after_row ->> 'moderation_status', 'updated');
  elsif tg_table_name = 'direct_message_reports' then
    label := 'Message report ' || coalesce(item ->> 'status', lower(tg_op));
  elsif tg_table_name = 'direct_messages' and tg_op = 'INSERT' then
    label := 'Admin message sent';
  end if;
  insert into public.admin_activity_logs(user_id, action, details, target_table, target_id, changed_fields)
  values(auth.uid(), label, tg_table_name || ' record ' || coalesce(item ->> 'id', item ->> 'user_id', '(no ID)') ||
    '; fields: ' || coalesce(array_to_string(fields, ', '), ''), tg_table_name,
    coalesce(item ->> 'id', item ->> 'user_id'), coalesce(fields, '{}'));
  -- No message bodies, document paths, credentials or profile values are copied.
  return null;
end;
$$;
alter function public.audit_boardmate_admin_mutation() owner to postgres;
revoke all on function public.audit_boardmate_admin_mutation() from public, anon, authenticated;

do $$ declare target text; begin
  foreach target in array array['profiles', 'listings', 'roommate_posts', 'direct_messages',
    'direct_message_reports', 'boardmate_notifications', 'admin_review_notifications',
    'boardmate_problem_reports', 'boardmate_account_deletion_requests', 'admin_memberships'] loop
    if to_regclass('public.' || target) is not null then
      execute format('create trigger boardmate_admin_audit after insert or update or delete on public.%I for each row execute function public.audit_boardmate_admin_mutation()', target);
    end if;
  end loop;
end $$;

create function public.record_boardmate_admin_session_event(p_event text) returns void
language plpgsql security definer set search_path = '' as $$
declare session_key text := auth.jwt() ->> 'session_id';
begin
  if auth.uid() is null or not public.is_boardmate_admin() then raise exception 'Administrator access required' using errcode = '42501'; end if;
  if p_event not in ('login', 'logout_requested') or p_event is null then raise exception 'Unsupported session event'; end if;
  if session_key is null or session_key = '' then raise exception 'Authenticated session required'; end if;
  insert into public.admin_activity_logs(user_id, action, details, session_id)
  values(auth.uid(), case p_event when 'login' then 'Admin login' else 'Admin sign-out requested' end,
    'Admin portal session event', session_key) on conflict (user_id, action, session_id) do nothing;
end;
$$;
alter function public.record_boardmate_admin_session_event(text) owner to postgres;
revoke all on function public.record_boardmate_admin_session_event(text) from public, anon, authenticated;
grant execute on function public.record_boardmate_admin_session_event(text) to authenticated;
-- Existing admin refresh/pull-to-refresh works without publication changes.
commit;
