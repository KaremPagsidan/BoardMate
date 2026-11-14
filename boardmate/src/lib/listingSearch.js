export const defaultListingFilters = {
  location: '',
  propertyType: '',
  maxPrice: 200000,
};

function priceAmount(value) {
  const parsed = Number(String(value || '').replace(/[^\d.]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

export function filterListings(listings, query, filters) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const normalizedLocation = filters.location.trim().toLocaleLowerCase();

  return listings.filter(listing => {
    const text = [listing.title, listing.location, listing.description, listing.propertyType, listing.price]
      .filter(Boolean)
      .join(' ')
      .toLocaleLowerCase();
    if (normalizedQuery && !text.includes(normalizedQuery)) return false;
    if (normalizedLocation && !String(listing.location || '').toLocaleLowerCase().includes(normalizedLocation)) return false;
    if (filters.propertyType) {
      const type = String(listing.propertyType || '').toLocaleLowerCase();
      const listingText = `${listing.title || ''} ${listing.description || ''}`.toLocaleLowerCase();
      if (type !== filters.propertyType.toLocaleLowerCase() && !listingText.includes(filters.propertyType.toLocaleLowerCase())) return false;
    }

    const price = priceAmount(listing.price);
    if (price !== null && price > Number(filters.maxPrice)) return false;
    return true;
  });
}

export function filterRoommatePosts(posts, query, filters) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const normalizedLocation = filters?.location?.trim().toLocaleLowerCase() || '';
  return posts.filter(post => [
    post.title,
    post.budget,
    post.location,
    post.details,
    post.name,
    post.role,
  ].filter(Boolean).join(' ').toLocaleLowerCase().includes(normalizedQuery)
    && (!normalizedLocation || String(post.location || '').toLocaleLowerCase().includes(normalizedLocation))
    && (!filters || priceAmount(post.budget) === null || priceAmount(post.budget) <= Number(filters.maxPrice)));
}

export function getPopularListingLocations(listings, favoriteCounts = {}) {
  const locations = new Map();
  listings.forEach(listing => {
    const name = String(listing.location || '').trim();
    if (!name) return;
    const key = name.toLocaleLowerCase();
    const current = locations.get(key) || { name, likes: 0, listings: 0 };
    current.likes += favoriteCounts[listing.id] || 0;
    current.listings += 1;
    locations.set(key, current);
  });
  return [...locations.values()]
    .sort((first, second) => second.likes - first.likes || second.listings - first.listings || first.name.localeCompare(second.name))
    .slice(0, 6);
}
