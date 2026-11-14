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

create table public.uploaded_photo_privacy (
  bucket_id text not null check (bucket_id in ('listing-photos', 'roommate-post-photos')),
  storage_path text not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  is_public boolean not null default true,
  primary key(bucket_id, storage_path),
  check (split_part(storage_path, '/', 1) = user_id::text)
);
alter table public.uploaded_photo_privacy enable row level security;
revoke all on public.uploaded_photo_privacy from public, anon, authenticated;
grant select on public.uploaded_photo_privacy to authenticated;
create policy "Owners read media visibility" on public.uploaded_photo_privacy for select to authenticated using (user_id = auth.uid());
create trigger uploaded_photo_visibility_revision after insert or update or delete on public.uploaded_photo_privacy
  for each row execute function public.publish_boardmate_visibility_revision();

create function public.boardmate_media_url_matches(p_url text, p_bucket text, p_path text) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(split_part(split_part(p_url, '/' || p_bucket || '/', 2), '?', 1) = p_path, false);
$$;
create function public.can_read_boardmate_uploaded_media(p_bucket text, p_path text) returns boolean
language sql stable security definer set search_path = '' as $$
 select auth.uid() is not null and p_bucket in ('listing-photos', 'roommate-post-photos') and (
   split_part(p_path, '/', 1) = auth.uid()::text or (
     public.is_boardmate_account_approved(auth.uid())
     and not exists(select 1 from public.uploaded_photo_privacy v where v.bucket_id = p_bucket and v.storage_path = p_path and not v.is_public)
     and (
       (p_bucket = 'listing-photos' and exists(select 1 from public.listings l
         where l.owner_id::text = split_part(p_path, '/', 1) and l.is_available and l.moderation_status = 'approved'
         and public.is_boardmate_profile_visible(l.owner_id) and not public.is_boardmate_blocked_with(l.owner_id)
         and (public.boardmate_media_url_matches(l.image_url, p_bucket, p_path) or exists(
           select 1 from jsonb_array_elements(coalesce(l.photos, '[]'::jsonb)) m
           where public.boardmate_media_url_matches(case jsonb_typeof(m) when 'string' then m #>> '{}' else m->>'url' end, p_bucket, p_path)))))
       or (p_bucket = 'roommate-post-photos' and exists(select 1 from public.roommate_posts p
         where p.user_id::text = split_part(p_path, '/', 1) and p.deleted_at is null and p.moderation_status = 'approved'
         and public.is_boardmate_profile_visible(p.user_id) and not public.is_boardmate_blocked_with(p.user_id)
         and exists(select 1 from jsonb_array_elements(coalesce(p.photos, '[]'::jsonb)) m
           where public.boardmate_media_url_matches(case jsonb_typeof(m) when 'string' then m #>> '{}' else m->>'url' end, p_bucket, p_path))))
     )
   )
 );
$$;
update storage.buckets set public = false where id in ('listing-photos', 'roommate-post-photos');
create policy "Post media privacy boundary" on storage.objects as restrictive for select to anon, authenticated
 using (bucket_id not in ('listing-photos', 'roommate-post-photos') or public.can_read_boardmate_uploaded_media(bucket_id, name));
create policy "Authorized post media downloads" on storage.objects for select to authenticated
 using (bucket_id in ('listing-photos', 'roommate-post-photos') and public.can_read_boardmate_uploaded_media(bucket_id, name));
create policy "Post media deletion boundary" on storage.objects as restrictive for delete to authenticated
 using (bucket_id not in ('listing-photos', 'roommate-post-photos') or split_part(name, '/', 1) = auth.uid()::text);
create policy "Owners remove post media objects" on storage.objects for delete to authenticated
 using (bucket_id in ('listing-photos', 'roommate-post-photos') and split_part(name, '/', 1) = auth.uid()::text);

create function public.set_boardmate_uploaded_photo_visibility(p_bucket text, p_path text, p_public boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
 if auth.uid() is null or split_part(p_path, '/', 1) <> auth.uid()::text
   or p_bucket not in ('listing-photos', 'roommate-post-photos') or p_public is null then
   raise exception 'Only the photo owner can change its visibility.' using errcode = '42501';
 end if;
 if not exists(select 1 from storage.objects where bucket_id = p_bucket and name = p_path) then
   raise exception 'This photo no longer exists.';
 end if;
 insert into public.uploaded_photo_privacy(bucket_id, storage_path, user_id, is_public) values(p_bucket, p_path, auth.uid(), p_public)
 on conflict(bucket_id, storage_path) do update set is_public = excluded.is_public;
end;
$$;
create function public.delete_boardmate_uploaded_photo(p_bucket text, p_path text) returns void
language plpgsql security definer set search_path = '' as $$
begin
 if auth.uid() is null or split_part(p_path, '/', 1) <> auth.uid()::text
   or p_bucket not in ('listing-photos', 'roommate-post-photos') then
   raise exception 'Only the photo owner can delete it.' using errcode = '42501';
 end if;
 if exists(select 1 from storage.objects where bucket_id = p_bucket and name = p_path) then
   raise exception 'Remove the stored file before deleting its references.';
 end if;
 if p_bucket = 'listing-photos' then
   update public.listings l set photos = coalesce((select jsonb_agg(m) from jsonb_array_elements(coalesce(l.photos, '[]'::jsonb)) m
     where not public.boardmate_media_url_matches(case jsonb_typeof(m) when 'string' then m #>> '{}' else m->>'url' end, p_bucket, p_path)), '[]'::jsonb),
     image_url = case when public.boardmate_media_url_matches(l.image_url, p_bucket, p_path) then null else l.image_url end
   where l.owner_id = auth.uid() and (public.boardmate_media_url_matches(l.image_url, p_bucket, p_path) or exists(
     select 1 from jsonb_array_elements(coalesce(l.photos, '[]'::jsonb)) m where public.boardmate_media_url_matches(case jsonb_typeof(m) when 'string' then m #>> '{}' else m->>'url' end, p_bucket, p_path)));
 else
   update public.roommate_posts p set photos = coalesce((select jsonb_agg(m) from jsonb_array_elements(coalesce(p.photos, '[]'::jsonb)) m
     where not public.boardmate_media_url_matches(case jsonb_typeof(m) when 'string' then m #>> '{}' else m->>'url' end, p_bucket, p_path)), '[]'::jsonb)
   where p.user_id = auth.uid() and exists(select 1 from jsonb_array_elements(coalesce(p.photos, '[]'::jsonb)) m
     where public.boardmate_media_url_matches(case jsonb_typeof(m) when 'string' then m #>> '{}' else m->>'url' end, p_bucket, p_path));
 end if;
 delete from public.uploaded_photo_privacy where bucket_id = p_bucket and storage_path = p_path and user_id = auth.uid();
 update public.boardmate_visibility_revision set revision = revision + 1 where id;
end;
$$;
alter function public.can_read_boardmate_uploaded_media(text, text) owner to postgres;
alter function public.set_boardmate_uploaded_photo_visibility(text, text, boolean) owner to postgres;
alter function public.delete_boardmate_uploaded_photo(text, text) owner to postgres;
revoke all on function public.can_read_boardmate_uploaded_media(text, text), public.set_boardmate_uploaded_photo_visibility(text, text, boolean), public.delete_boardmate_uploaded_photo(text, text) from public;
grant execute on function public.can_read_boardmate_uploaded_media(text, text) to anon, authenticated;
grant execute on function public.set_boardmate_uploaded_photo_visibility(text, text, boolean), public.delete_boardmate_uploaded_photo(text, text) to authenticated;
notify pgrst, 'reload schema';
commit;
