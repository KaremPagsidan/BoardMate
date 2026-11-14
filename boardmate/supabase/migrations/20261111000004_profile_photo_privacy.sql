begin;
set local lock_timeout = '5s';
-- Idempotent shared refresh infrastructure; also works without migration 00002.
create table if not exists public.boardmate_visibility_revision (
  id boolean primary key default true check (id),
  revision bigint not null default 0
);
insert into public.boardmate_visibility_revision(id) values (true) on conflict (id) do nothing;
alter table public.boardmate_visibility_revision enable row level security;
revoke all on public.boardmate_visibility_revision from public, anon, authenticated;
grant select on public.boardmate_visibility_revision to authenticated;
drop policy if exists "Members read visibility revision" on public.boardmate_visibility_revision;
create policy "Members read visibility revision" on public.boardmate_visibility_revision
  for select to authenticated using (true);
create or replace function public.publish_boardmate_visibility_revision() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.boardmate_visibility_revision set revision = revision + 1 where id;
  return null;
end;
$$;
alter function public.publish_boardmate_visibility_revision() owner to postgres;
revoke all on function public.publish_boardmate_visibility_revision() from public, anon, authenticated;
do $$ begin
  if exists(select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists(select 1 from pg_publication_tables where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'boardmate_visibility_revision') then
    alter publication supabase_realtime add table public.boardmate_visibility_revision;
  end if;
end $$;

alter table public.profile_photo_gallery add column is_public boolean not null default true;
alter table public.profile_photo_gallery add column storage_path text generated always as
  (nullif(split_part(split_part(photo_url, '/profile-photos/', 2), '?', 1), '')) stored;
alter table public.profile_photo_gallery add constraint gallery_owned_path
  check (storage_path is null or split_part(storage_path, '/', 1) = user_id::text) not valid;
create index profile_photo_gallery_path_idx on public.profile_photo_gallery(storage_path);
-- Public URLs must stop serving bytes; the frontend uses authenticated downloads.
update storage.buckets set public = false where id = 'profile-photos';

create function public.can_read_boardmate_profile_photo(p_path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and (
    split_part(p_path, '/', 1) = auth.uid()::text or exists (
      select 1 from public.profile_photo_gallery g where g.storage_path = p_path
      and g.is_public and public.is_boardmate_profile_visible(g.user_id)
      and public.is_boardmate_account_approved(auth.uid())
      and not public.is_boardmate_blocked_with(g.user_id)
    )
  );
$$;
alter function public.can_read_boardmate_profile_photo(text) owner to postgres;
revoke all on function public.can_read_boardmate_profile_photo(text) from public;
grant execute on function public.can_read_boardmate_profile_photo(text) to anon, authenticated;
create policy "Profile photo privacy boundary" on storage.objects as restrictive for select to anon, authenticated
  using (bucket_id <> 'profile-photos' or public.can_read_boardmate_profile_photo(name));
create policy "Authorized profile photo downloads" on storage.objects for select to authenticated
  using (bucket_id = 'profile-photos' and public.can_read_boardmate_profile_photo(name));
create policy "Owner removes profile photo objects" on storage.objects for delete to authenticated
  using (bucket_id = 'profile-photos' and split_part(name, '/', 1) = auth.uid()::text);
create policy "Profile photo deletion boundary" on storage.objects as restrictive for delete to authenticated
  using (bucket_id <> 'profile-photos' or split_part(name, '/', 1) = auth.uid()::text);
-- Restrictive table visibility also protects against future broad read policies.
create policy "Gallery privacy boundary" on public.profile_photo_gallery as restrictive for select to authenticated
  using (user_id = auth.uid() or (is_public and public.can_read_boardmate_profile_photo(storage_path)));

create function public.set_boardmate_photo_visibility(p_id bigint, p_public boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_public is null then raise exception 'Choose a visibility.'; end if;
  update public.profile_photo_gallery set is_public = p_public where id = p_id and user_id = auth.uid();
  if not found then raise exception 'Only the photo owner can change its visibility.' using errcode = '42501'; end if;
end;
$$;
create function public.delete_boardmate_profile_photo(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare photo public.profile_photo_gallery;
begin
  select * into photo from public.profile_photo_gallery where id = p_id and user_id = auth.uid() for update;
  if not found then raise exception 'Only the photo owner can delete it.' using errcode = '42501'; end if;
  -- The client removes physical bytes with Storage API before this transaction.
  if photo.storage_path is not null and exists(select 1 from storage.objects where bucket_id = 'profile-photos' and name = photo.storage_path) then
    raise exception 'Remove the stored file before deleting its gallery entry.';
  end if;
  update public.profiles set avatar_url = null where id = photo.user_id and avatar_url = photo.photo_url;
  delete from public.profile_photo_gallery where id = photo.id;
end;
$$;
alter function public.set_boardmate_photo_visibility(bigint, boolean) owner to postgres;
alter function public.delete_boardmate_profile_photo(bigint) owner to postgres;
revoke all on function public.set_boardmate_photo_visibility(bigint, boolean), public.delete_boardmate_profile_photo(bigint) from public;
grant execute on function public.set_boardmate_photo_visibility(bigint, boolean), public.delete_boardmate_profile_photo(bigint) to authenticated;
-- Publish privacy changes without broadcasting photo URLs or account details.
create trigger profile_photo_visibility_revision after insert or update or delete on public.profile_photo_gallery
  for each row execute function public.publish_boardmate_visibility_revision();

-- Existing public-profile RPC is SECURITY DEFINER, so filter explicitly rather
-- than relying on the gallery's RLS inside that function.
do $$ declare definition text;
begin
  definition := pg_get_functiondef('public.get_boardmate_public_profile(uuid)'::regprocedure);
  if position('where gallery.user_id = profile.id' in definition) = 0 then
    raise exception 'Inspect the installed public profile RPC before applying privacy.';
  end if;
  definition := replace(definition, 'where gallery.user_id = profile.id',
    'where gallery.user_id = profile.id and (gallery.is_public or gallery.user_id = auth.uid())');
  execute definition;
end $$;
notify pgrst, 'reload schema';
commit;
