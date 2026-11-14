import { supabase } from '../supabaseClient';

export async function fetchListingRatingSummary(listingIds) {
  if (!listingIds.length) return {};

  const summaries = {};
  for (let index = 0; index < listingIds.length; index += 100) {
    const { data, error } = await supabase.rpc('get_boardmate_listing_rating_summaries', {
      p_listing_ids: listingIds.slice(index, index + 100).map(String),
    });
    if (error) {
      if (error.code === '42P01' || error.code === 'PGRST202' || error.message?.includes('schema cache')) {
        throw new Error('Listing ratings are not set up in Supabase. Apply the latest marketplace migration, then reload.');
      }
      throw error;
    }
    Object.assign(summaries, data || {});
  }
  return summaries;
}

export async function saveListingRating(listingId, rating) {
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new Error('Choose a rating from 1 to 5 stars.');
  }

  const { data, error } = await supabase.rpc('save_boardmate_listing_rating', {
    p_listing_id: String(listingId),
    p_rating: rating,
  });
  if (error) {
    if (error.code === 'PGRST202' || error.code === '42883' || error.message?.includes('schema cache')) {
      throw new Error('Listing ratings are not enabled yet. Apply the latest listing ratings migration in Supabase, then try again.');
    }
    throw error;
  }
  return data;
}
