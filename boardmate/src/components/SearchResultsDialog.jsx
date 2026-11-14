import SearchBar from './SearchBar';
import ProfileImage from './ProfileImage';
import LocationIcon from './LocationIcon';

export default function SearchResultsDialog({
  query,
  onQueryChange,
  listings,
  roommatePosts = [],
  filters,
  onSelectListing,
  onSelectRoommatePost,
  onClose,
  scrollRef,
}) {
  const hasQuery = Boolean(query.trim());
  const resultCount = listings.length + roommatePosts.length;

  return (
    <div className="fixed inset-0 z-[85] flex flex-col bg-[#FAF7EE]" role="dialog" aria-modal="true" aria-labelledby="search-results-title">
      <header className="shrink-0 border-b border-gray-200 bg-[#FAF7EE] px-4 pb-3 pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="mx-auto flex w-full max-w-3xl items-center gap-3">
          <button type="button" onClick={onClose} aria-label="Close search" className="text-2xl leading-none text-gray-500">‹</button>
          <div className="min-w-0 flex-1">
            <h2 id="search-results-title" className="text-sm font-bold text-gray-900">Search BoardMate</h2>
            <p className="text-[10px] text-gray-500">
              {hasQuery
                ? `${resultCount} matching ${resultCount === 1 ? 'result' : 'results'}`
                : 'Enter a search term to find matching listings and posts.'}
            </p>
          </div>
        </div>
        <div className="mx-auto mt-3 w-full max-w-3xl">
          <SearchBar
            autoFocus
            
            value={query}
            onChange={event => onQueryChange(event.target.value)}
            placeholder="Search listings, locations, or roommate posts"
            aria-label="Search listings and roommate posts"
          />
          {filters && (
            <p className="mt-2 text-[10px] text-gray-500">
              Filters: {[filters.location, filters.propertyType, Number(filters.maxPrice) < 200000 ? `Up to ₱${Number(filters.maxPrice).toLocaleString()}` : '']
                .filter(Boolean)
                .join(' · ') || 'None'}
            </p>
          )}
        </div>
      </header>

      <main ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <div className="mx-auto w-full max-w-3xl space-y-2">
          {!hasQuery && (
            <p className="rounded-xl bg-white p-5 text-center text-xs text-gray-500">
              Start typing to see results that match your search and saved filters.
            </p>
          )}
          {hasQuery && listings.map(listing => (
            <button
              key={`listing-${listing.id}`}
              type="button"
              onClick={() => onSelectListing(listing)}
              className="flex w-full items-center gap-3 rounded-xl border border-gray-100 bg-white p-2 text-left hover:border-emerald-300"
            >
              {listing.image
                ? <ProfileImage src={listing.image} alt="" className="h-16 w-20 shrink-0 rounded-lg object-cover" />
                : <span className="grid h-16 w-20 shrink-0 place-items-center rounded-lg bg-gray-100 text-gray-400">⌂</span>}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-bold text-gray-900">{listing.title}</span>
                <span className="mt-1 block break-words text-xs text-emerald-700">{listing.price}</span>
                <span className="mt-1 flex items-center gap-1 truncate text-[9px] text-gray-500">
                  <LocationIcon className="h-3 w-3 shrink-0" />{listing.location}
                  {listing.propertyType ? ` · ${listing.propertyType}` : ''}
                </span>
              </span>
              <span className="text-[10px] font-semibold text-emerald-700">View</span>
            </button>
          ))}
          {hasQuery && roommatePosts.map(post => (
            <button
              key={`roommate-${post.id}`}
              type="button"
              onClick={() => onSelectRoommatePost(post)}
              className="flex w-full items-center gap-3 rounded-xl border border-gray-100 bg-white p-3 text-left hover:border-emerald-300"
            >
              {post.avatar
                ? <ProfileImage src={post.avatar} alt="" className="h-11 w-11 shrink-0 rounded-full object-cover" />
                : <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-gray-100 text-gray-400">👤</span>}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-bold text-gray-900">{post.title}</span>
                <span className="mt-1 block truncate text-[10px] text-gray-600">{post.name} · {post.budget}</span>
                <span className="mt-1 flex items-center gap-1 truncate text-[9px] text-gray-500">
                  <LocationIcon className="h-3 w-3 shrink-0" />{post.location}
                </span>
              </span>
              <span className="text-[10px] font-semibold text-emerald-700">View</span>
            </button>
          ))}
          {hasQuery && resultCount === 0 && (
            <p className="rounded-xl bg-white p-5 text-center text-xs text-gray-500">No results match your search and saved filters.</p>
          )}
        </div>
      </main>
    </div>
  );
}
