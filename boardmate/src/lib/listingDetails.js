import { supabase } from '../supabaseClient';
import { fetchListingRatingSummary } from './listingRatings';

export function readListingRoute(hash = window.location.hash) {
  const match = hash.match(/^#listing\/([^?]+)(?:\?(.*))?$/);
  if (!match) return null;
  try {
    const listingId = decodeURIComponent(match[1]);
    if (!/^[a-zA-Z0-9-]{1,100}$/.test(listingId)) return null;
    const query = new URLSearchParams(match[2]);
    return { listingId, handoff: query.get('handoff'), account: query.get('account'),
      ...(query.get('viewport') === 'phone' ? { viewport: 'phone' } : {}) };
  } catch { return null; }
}

export function listingDetailsHref(id, base = window.location.href) {
  const url = new URL(base);
  url.search = '';
  url.hash = `listing/${encodeURIComponent(String(id))}`;
  return url.href;
}

export function listingPreviewHref(id, base = window.location.href) {
  return `${listingDetailsHref(id, base)}?viewport=phone`;
}

function safeMediaUrl(value) {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

export function listingMedia(listing) {
  const result = [];
  const seen = new Set();
  const add = (item, cover = false) => {
    const value = typeof item === 'string' ? { url: item } : item;
    if (!value || typeof value.url !== 'string') return;
    const url = safeMediaUrl(value.url);
    if (!url || seen.has(url)) return;
    const extension = new URL(url).pathname.split('.').pop()?.toLowerCase();
    const inferred = ['mp4', 'webm', 'mov'].includes(extension) ? 'video/*'
      : ['mp3', 'm4a', 'wav', 'ogg', 'aac'].includes(extension) ? 'audio/*' : 'image/*';
    const mimeType = typeof value.mimeType === 'string' ? value.mimeType : inferred;
    if (!/^(image|video|audio)\//.test(mimeType)) return;
    seen.add(url);
    result.push({ url, mimeType, name: typeof value.name === 'string' && value.name ? value.name : (cover ? 'Cover photo' : `Listing media ${result.length + 1}`), isCover: cover });
  };
  const photos = Array.isArray(listing.photos) ? listing.photos : [];
  const cover = listing.image_url || listing.image;
  if (cover) add(photos.find(item => item?.url === cover) || cover, true);
  photos.forEach(item => add(item));
  return result;
}

export async function fetchListingDetails(listingId) {
  const { data, error } = await supabase.from('listings').select('*').eq('id', listingId).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('This listing is unavailable or your account does not have access to it.');
  let rating = { average: 0, count: 0 };
  let ratingError = '';
  try {
    const summaries = await fetchListingRatingSummary([data.id]);
    rating = summaries[String(data.id)] || rating;
  } catch { ratingError = 'Ratings are temporarily unavailable.'; }
  return { ...data, media: listingMedia(data), rating, ratingError };
}
