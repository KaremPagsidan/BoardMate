alter table public.boardmate_notifications
  add column if not exists hidden_until timestamptz;

grant delete on public.boardmate_notifications to authenticated;

drop policy if exists "Users can delete their notifications" on public.boardmate_notifications;
create policy "Users can delete their notifications"
  on public.boardmate_notifications for delete to authenticated
  using (user_id = (select auth.uid()));

create or replace function public.can_view_boardmate_presence(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target_user_id = (select auth.uid())
    or (
      (select public.is_boardmate_account_approved((select auth.uid())))
      and (select public.is_boardmate_account_approved(target_user_id))
      and coalesce((
        select preference.show_active_status
        from public.boardmate_account_preferences preference
        where preference.user_id = target_user_id
      ), true)
      and exists (
        select 1
        from public.boardmate_presence presence
        where presence.user_id = target_user_id
      )
    );
$$;

revoke all on function public.can_view_boardmate_presence(uuid) from public;
grant execute on function public.can_view_boardmate_presence(uuid) to authenticated;

drop policy if exists "Approved users can view boardmate presence" on public.boardmate_presence;
create policy "Approved users can view boardmate presence"
  on public.boardmate_presence for select to authenticated
  using ((select public.can_view_boardmate_presence(user_id)));
