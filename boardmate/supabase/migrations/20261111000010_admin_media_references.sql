begin;
set local lock_timeout = '5s';
-- Compare canonical object paths for legacy URLs, signed URLs and path-only records.
create or replace function public.boardmate_media_url_matches(p_url text, p_bucket text, p_path text) returns boolean
language plpgsql immutable set search_path = '' as $$
declare ref text := p_url; decoded bytea := ''::bytea; i integer := 1; ch text;
begin
  if ref is null or p_path is null or p_bucket not in ('listing-photos', 'roommate-post-photos') then return false; end if;
  if ref ~ '^https?://' then
    if ref !~ '^https?://[^/]+/storage/v1/(object|render/image)/(public|authenticated|sign)/' then return false; end if;
    ref := regexp_replace(ref, '^https?://[^/]+/storage/v1/(object|render/image)/(public|authenticated|sign)/', '');
    if left(ref, length(p_bucket) + 1) <> p_bucket || '/' then return false; end if;
    ref := split_part(split_part(substr(ref, length(p_bucket) + 2), '?', 1), '#', 1);
    while i <= length(ref) loop
      ch := substr(ref, i, 1);
      if ch = '%' then
        if substr(ref, i + 1, 2) !~ '^[0-9A-Fa-f]{2}$' then return false; end if;
        decoded := decoded || decode(substr(ref, i + 1, 2), 'hex'); i := i + 3;
      else decoded := decoded || convert_to(ch, 'UTF8'); i := i + 1; end if;
    end loop;
    ref := convert_from(decoded, 'UTF8');
  elsif left(ref, length(p_bucket) + 1) = p_bucket || '/' then
    ref := substr(ref, length(p_bucket) + 2);
  end if;
  return ref = p_path;
exception when character_not_in_repertoire or invalid_parameter_value then return false;
end;
$$;
-- Allow administrators to review attached media in every moderation state.
create or replace function public.can_read_boardmate_uploaded_media(p_bucket text, p_path text) returns boolean
language sql stable security definer set search_path = '' as $$
 select auth.uid() is not null and p_bucket in ('listing-photos', 'roommate-post-photos') and (
   (public.is_boardmate_admin() and (
     (p_bucket = 'listing-photos' and exists(select 1 from public.listings l where public.boardmate_media_url_matches(l.image_url, p_bucket, p_path) or exists(select 1 from jsonb_array_elements(coalesce(l.photos, '[]'::jsonb)) m where public.boardmate_media_url_matches(case jsonb_typeof(m) when 'string' then m #>> '{}' else coalesce(m->>'path', m->>'storage_path', m->>'url', m->>'src') end, p_bucket, p_path))))
     or (p_bucket = 'roommate-post-photos' and exists(select 1 from public.roommate_posts p, jsonb_array_elements(coalesce(p.photos, '[]'::jsonb)) m where public.boardmate_media_url_matches(case jsonb_typeof(m) when 'string' then m #>> '{}' else coalesce(m->>'path', m->>'storage_path', m->>'url', m->>'src') end, p_bucket, p_path)))
   )) or split_part(p_path, '/', 1) = auth.uid()::text or (
     public.is_boardmate_account_approved(auth.uid())
     and not exists(select 1 from public.uploaded_photo_privacy v where v.bucket_id = p_bucket and v.storage_path = p_path and not v.is_public)
     and (
       (p_bucket = 'listing-photos' and exists(select 1 from public.listings l
         where l.owner_id::text = split_part(p_path, '/', 1) and l.is_available and l.moderation_status = 'approved'
         and public.is_boardmate_profile_visible(l.owner_id) and not public.is_boardmate_blocked_with(l.owner_id)
         and (public.boardmate_media_url_matches(l.image_url, p_bucket, p_path) or exists(
           select 1 from jsonb_array_elements(coalesce(l.photos, '[]'::jsonb)) m
           where public.boardmate_media_url_matches(case jsonb_typeof(m) when 'string' then m #>> '{}' else coalesce(m->>'path', m->>'storage_path', m->>'url', m->>'src') end, p_bucket, p_path)))))
       or (p_bucket = 'roommate-post-photos' and exists(select 1 from public.roommate_posts p
         where p.user_id::text = split_part(p_path, '/', 1) and p.deleted_at is null and p.moderation_status = 'approved'
         and public.is_boardmate_profile_visible(p.user_id) and not public.is_boardmate_blocked_with(p.user_id)
         and exists(select 1 from jsonb_array_elements(coalesce(p.photos, '[]'::jsonb)) m
           where public.boardmate_media_url_matches(case jsonb_typeof(m) when 'string' then m #>> '{}' else coalesce(m->>'path', m->>'storage_path', m->>'url', m->>'src') end, p_bucket, p_path))))
     )
   )
 );
$$;

alter function public.can_read_boardmate_uploaded_media(text,text) owner to postgres;
revoke all on function public.can_read_boardmate_uploaded_media(text,text) from public;
grant execute on function public.can_read_boardmate_uploaded_media(text,text) to anon, authenticated;
notify pgrst, 'reload schema';
commit;
