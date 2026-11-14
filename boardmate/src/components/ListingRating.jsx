export default function ListingRating({
  listingTitle,
  average = 0,
  count = 0,
  myRating = null,
  disabled = false,
  saving = false,
  onRate,
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <div className="flex items-center" aria-label={`Your rating: ${myRating || 'not rated'} out of 5 stars`}>
        {[1, 2, 3, 4, 5].map(star => (
          <button
            key={star}
            type="button"
            disabled={disabled || saving}
            onClick={() => onRate(star)}
            aria-label={`Rate ${listingTitle} ${star} out of 5 stars`}
            aria-pressed={myRating === star}
            className={`px-0.5 text-base leading-none disabled:cursor-not-allowed ${star <= (myRating || 0) ? 'text-amber-500' : 'text-gray-300'} ${!disabled && !saving ? 'hover:scale-110' : ''}`}
          >
            ★
          </button>
        ))}
      </div>
      <span className="text-[9px] text-gray-500">
        {count ? `★ ${average.toFixed(1)} (${count})` : 'No ratings'}
      </span>
      {!disabled && !myRating && <span className="text-[9px] text-emerald-700">{saving ? 'Saving…' : 'Tap to rate'}</span>}
      {disabled && !myRating && <span className="text-[9px] text-gray-400">An active renter account is required to rate</span>}
    </div>
  );
}
