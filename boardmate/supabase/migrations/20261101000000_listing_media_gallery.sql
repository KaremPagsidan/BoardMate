alter table public.listings
  add column if not exists photos jsonb not null default '[]'::jsonb;

alter table public.listings
  drop constraint if exists listings_photos_array_check;

alter table public.listings
  add constraint listings_photos_array_check
  check (jsonb_typeof(photos) = 'array');

create or replace function public.protect_boardmate_review_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_table_name = 'profiles' then
    if tg_op = 'INSERT' then
      new.verification_status := 'pending';
      new.verification_reason := null;
      new.verified_at := null;
      new.verified_by := null;
      new.id_uploaded := false;
      new.selfie_uploaded := false;
      new.id_document_path := null;
      new.selfie_document_path := null;
      return new;
    end if;

    if not public.is_boardmate_admin()
      and (
        new.verification_status is distinct from old.verification_status
        or new.verification_reason is distinct from old.verification_reason
        or new.verified_at is distinct from old.verified_at
        or new.verified_by is distinct from old.verified_by
      ) then
      raise exception 'Only an administrator can change account verification status.';
    end if;

    if new.id is distinct from old.id
      or (
        not public.is_boardmate_admin()
        and new.created_at is distinct from old.created_at
      ) then
      raise exception 'Profile identity and registration time cannot be changed.';
    end if;

    if not public.is_boardmate_admin()
      and (
        new.email is distinct from old.email
        or new.full_name is distinct from old.full_name
        or new.phone is distinct from old.phone
        or new.role is distinct from old.role
        or new.gender is distinct from old.gender
        or new.dob is distinct from old.dob
        or new.business_name is distinct from old.business_name
        or new.address is distinct from old.address
        or new.gov_id_number is distinct from old.gov_id_number
        or new.property_type is distinct from old.property_type
      ) then
      new.verification_status := 'pending';
      new.verification_reason := null;
      new.verified_at := null;
      new.verified_by := null;
    end if;

    if not public.is_boardmate_admin()
      and (
        new.id_document_path is distinct from old.id_document_path
        or new.selfie_document_path is distinct from old.selfie_document_path
      ) then
      if new.id_document_path is not null
        and split_part(new.id_document_path, '/', 1) <> old.id::text then
        raise exception 'Verification documents must be stored in the account owner folder.';
      end if;
      if new.selfie_document_path is not null
        and split_part(new.selfie_document_path, '/', 1) <> old.id::text then
        raise exception 'Verification documents must be stored in the account owner folder.';
      end if;
      new.verification_status := 'pending';
      new.verification_reason := null;
      new.verified_at := null;
      new.verified_by := null;
    end if;
    new.id_uploaded := new.id_document_path is not null;
    new.selfie_uploaded := new.selfie_document_path is not null;
  else
    if tg_op = 'INSERT' then
      new.moderation_status := 'pending';
      new.moderation_reason := null;
      new.reviewed_at := null;
      new.reviewed_by := null;
      return new;
    end if;

    if not public.is_boardmate_admin() then
      if tg_table_name = 'listings' then
        if new.created_at is distinct from old.created_at
          or new.owner_id is distinct from old.owner_id then
          raise exception 'Post ownership and creation time cannot be changed.';
        end if;
      elsif tg_table_name = 'roommate_posts' then
        if new.created_at is distinct from old.created_at
          or new.user_id is distinct from old.user_id then
          raise exception 'Post ownership and creation time cannot be changed.';
        end if;
      end if;

      if new.moderation_status is distinct from old.moderation_status
        or new.moderation_reason is distinct from old.moderation_reason
        or new.reviewed_at is distinct from old.reviewed_at
        or new.reviewed_by is distinct from old.reviewed_by then
        raise exception 'Only an administrator can change content moderation status.';
      end if;
    end if;

    if not public.is_boardmate_admin() then
      if tg_table_name = 'listings' then
        if new.title is distinct from old.title
          or new.price is distinct from old.price
          or new.location is distinct from old.location
          or new.description is distinct from old.description
          or new.image_url is distinct from old.image_url
          or new.photos is distinct from old.photos then
          new.moderation_status := 'pending';
          new.moderation_reason := null;
          new.reviewed_at := null;
          new.reviewed_by := null;
        end if;
      elsif tg_table_name = 'roommate_posts' then
        if new.heading is distinct from old.heading
          or new.budget is distinct from old.budget
          or new.description is distinct from old.description
          or new.location is distinct from old.location
          or new.role is distinct from old.role
          or new.author_name is distinct from old.author_name
          or new.author_gender is distinct from old.author_gender
          or new.author_age is distinct from old.author_age then
          new.moderation_status := 'pending';
          new.moderation_reason := null;
          new.reviewed_at := null;
          new.reviewed_by := null;
        end if;
      end if;
    end if;
  end if;

  return new;
end;
$$;

notify pgrst, 'reload schema';
