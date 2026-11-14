drop policy if exists "Approved users can view visible listing favorites"
  on public.listing_favorites;

create policy "Approved users can view visible listing favorites"
  on public.listing_favorites for select to authenticated
  using (
    user_id = (select auth.uid())
    or (
      (select public.is_boardmate_account_approved((select auth.uid())))
      and exists (
        select 1
        from public.listings listing
        where listing.id = listing_favorites.listing_id
          and (
            listing.owner_id = (select auth.uid())
            or (
              listing.is_available
              and listing.moderation_status = 'approved'
              and not (select public.is_boardmate_blocked_with(listing.owner_id))
            )
          )
      )
    )
  );

notify pgrst, 'reload schema';
