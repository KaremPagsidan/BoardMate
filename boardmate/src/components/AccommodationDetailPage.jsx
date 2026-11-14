import PortalPage from './PortalPage';
import AccommodationGallery from './AccommodationGallery';
import '../postDetails.css';

export default function AccommodationDetailPage({ listing, onBack, onPreviewMedia, rating, actions }) {
  const available = listing.available ?? listing.is_available;
  return <PortalPage title="Accommodation details" onBack={onBack}>
    <article className="bm-post-details">
      <h2>{listing.title || 'Accommodation listing'}</h2>
      <p className="accommodation-price">{listing.price || 'Price on request'}</p>
      <AccommodationGallery listing={listing} onPreview={onPreviewMedia} />
      <dl className="bm-post-facts">
        <div><dt>Property type</dt><dd>{listing.propertyType || listing.property_type || 'Accommodation'}</dd></div>
        <div><dt>Location</dt><dd>{listing.location || 'Not provided'}</dd></div>
        {available != null && <div><dt>Availability</dt><dd>{available ? 'Available' : 'Unavailable'}</dd></div>}
        {(listing.moderationStatus || listing.moderation_status) && <div><dt>Status</dt><dd>{listing.moderationStatus || listing.moderation_status}</dd></div>}
      </dl>
      <section><h3>Renter ratings</h3>{rating || <p>{Number(listing.ratingAverage ?? listing.rating?.average ?? 0).toFixed(1)} / 5 · {listing.ratingCount ?? listing.rating?.count ?? 0} ratings</p>}</section>
      <section><h3>About this accommodation</h3><p className="bm-post-description">{listing.description || 'The owner has not added a description yet.'}</p></section>
      {(listing.moderationReason || listing.moderation_reason) && <p className="bm-post-description">Review feedback: {listing.moderationReason || listing.moderation_reason}</p>}
      {actions && <footer className="bm-post-actions">{actions}</footer>}
    </article>
  </PortalPage>;
}
