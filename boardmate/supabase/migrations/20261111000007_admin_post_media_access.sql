-- Allow administrators to review attached media in every moderation state.
create or replace function public.can_read_boardmate_uploaded_media(p_bucket text, p_path text) returns boolean
language sql stable security definer set search_path = '' as $$
 select auth.uid() is not null and p_bucket in ('listing-photos', 'roommate-post-photos') and (
   (public.is_boardmate_admin() and (
     (p_bucket = 'listing-photos' and exists(select 1 from public.listings l where public.boardmate_media_url_matches(l.image_url, p_bucket, p_path) or exists(select 1 from jsonb_array_elements(coalesce(l.photos, '[]'::jsonb)) m where public.boardmate_media_url_matches(case jsonb_typeof(m) when 'string' then m #>> '{}' else m->>'url' end, p_bucket, p_path))))
     or (p_bucket = 'roommate-post-photos' and exists(select 1 from public.roommate_posts p, jsonb_array_elements(coalesce(p.photos, '[]'::jsonb)) m where public.boardmate_media_url_matches(case jsonb_typeof(m) when 'string' then m #>> '{}' else m->>'url' end, p_bucket, p_path)))
   )) or split_part(p_path, '/', 1) = auth.uid()::text or (
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
