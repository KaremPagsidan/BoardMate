import UploadedMedia from './UploadedMedia';
import ProfileImage from './ProfileImage';
import useVisibilityRefresh from '../hooks/useVisibilityRefresh';
import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { signInWithEmail } from '../lib/authentication';
import { fetchListingDetails, listingDetailsHref, listingPreviewHref } from '../lib/listingDetails';
import { restoreListingSession } from '../lib/listingWindow';
import BoardMateHouseIcon from './BoardMateHouseIcon';
import MediaPreviewDialog from './MediaPreviewDialog';
import '../listingDetails.css';

function Media({ media, title }) {
  const [failed, setFailed] = useState(false);
  if (!media || failed) return <div className="listing-media-placeholder">{media ? 'This media could not be loaded. Choose another photo below.' : 'No photos uploaded for this listing.'}</div>;
  if (media.mimeType.startsWith('video/')) return <UploadedMedia as="video" src={media.url} controls playsInline preload="metadata" aria-label={media.name} onError={() => setFailed(true)} />;
  if (media.mimeType.startsWith('audio/')) return <div className="listing-audio"><span>Audio tour</span><UploadedMedia as="audio" src={media.url} controls preload="metadata" aria-label={media.name} onError={() => setFailed(true)} /></div>;
  return <ProfileImage src={media.url} alt={media.name === 'Cover photo' ? title : media.name} onError={() => setFailed(true)} />;
}

export default function ListingDetailsPage({ route }) {
  const [user, setUser] = useState(null);
  const [restoring, setRestoring] = useState(true);
  const [listing, setListing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [signingIn, setSigningIn] = useState(false);

  const [preview, setPreview] = useState(null);
  const [retry, setRetry] = useState(0);
  const home = new URL(window.location.href);
  home.hash = '';

  useEffect(() => {
    let active = true;
    restoreListingSession(route).then(async session => {
      if (!session) return;
      const { data, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (active) setUser(data.user);
    }).catch(() => { if (active) setError('Please sign in to continue to this listing.'); })
      .finally(() => {
        if (active) {
          setRestoring(false);
          window.history.replaceState(null, '', route.viewport === 'phone' ? listingPreviewHref(route.listingId) : listingDetailsHref(route.listingId));
        }
      });
    return () => { active = false; };
  }, [route]);

  useEffect(() => {
    if (!user) return undefined;
    let active = true;
    fetchListingDetails(route.listingId).then(data => {
      if (!active) return;
      setListing(data);
      document.title = `${data.title || 'Listing'} · BoardMate`;
    }).catch(failure => { if (active) setError(failure.message || 'This listing could not be loaded.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [user, route.listingId, retry]);

  useVisibilityRefresh(async () => {
    try {
      const data = await fetchListingDetails(route.listingId);
      setListing(data);
      setError('');
    } catch {
      setListing(null);
      setPreview(null);
      setError('This accommodation is currently unavailable.');
    }
  }, Boolean(user));

  const login = async event => {
    event.preventDefault();
    if (signingIn) return;
    setSigningIn(true);
    setError('');
    try {
      const { data, error: loginError } = await signInWithEmail(email, password);
      if (loginError) throw loginError;
      setPassword('');
      setUser(data.user);
    } catch { setError('Sign-in failed. Check your email and password, then try again.'); }
    finally { setSigningIn(false); }
  };

  return (
    <div className="listing-detail-root">
      <header className="listing-site-header"><a className="listing-brand" href={home.href}><BoardMateHouseIcon className="listing-brand-icon" /><span>Board<span>Mate</span></span></a><a className="listing-back-link" href={home.href}>← Back to dashboard</a></header>
      <main className="listing-detail-main">
        {(restoring || (user && loading)) && <div className="listing-panel listing-loading" role="status"><span className="listing-loading-dot" />{restoring ? 'Opening your listing securely…' : 'Loading listing details…'}</div>}
        {!restoring && !user && <section className="listing-panel listing-sign-in"><p className="listing-eyebrow">Welcome to BoardMate</p><h1>Sign in to view this listing</h1><p className="listing-muted">Use your BoardMate account to see the full listing details and media gallery.</p><form onSubmit={login}><label htmlFor="listing-email">Email</label><input id="listing-email" type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} /><label htmlFor="listing-password">Password</label><input id="listing-password" type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} /><button className="listing-button" disabled={signingIn}>{signingIn ? 'Signing in…' : 'Sign in'}</button></form></section>}
        {error && <div className="listing-error" role="alert">{error}{user && <button type="button" className="listing-text-button" onClick={() => { setLoading(true); setError(''); setRetry(value => value + 1); }}>Try again</button>}</div>}
        {listing && user && !loading && <ListingDetailsContent key={listing.id} listing={listing} user={user} onPreview={setPreview} />}
      </main>
      <footer className="listing-site-footer">BoardMate · A place to feel at home.</footer>
      {preview && <MediaPreviewDialog media={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}

export function ListingDetailsContent({ listing, user, onPreview }) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const media = listing?.media[selectedIndex];
  const isOwner = user?.id === listing?.owner_id;
  const average = Number(listing?.rating?.average) || 0;
  const count = Number(listing?.rating?.count) || 0;
  return <>

          <div className="listing-title-row"><div><p className="listing-eyebrow">{isOwner ? 'Your accommodation' : 'Find your next place'}</p><h1>{listing.title || 'Accommodation listing'}</h1><p className="listing-location">{listing.location || 'Location not provided'}</p></div><div className="listing-title-tags"><span className={`listing-status ${listing.is_available ? 'listing-status-available' : ''}`}>{listing.is_available ? 'Available' : 'Unavailable'}</span>{isOwner && <span className="listing-status">{listing.moderation_status === 'approved' ? 'Published' : listing.moderation_status === 'rejected' ? 'Needs changes' : 'Pending review'}</span>}</div></div>
          <div className="listing-layout">
            <div className="listing-primary">
              <section className="listing-gallery" aria-label="Listing photo and media gallery">
                <div className="listing-hero"><Media key={media?.url || 'empty'} media={media} title={listing.title} />{media && <span className="listing-media-position">{selectedIndex + 1} / {listing.media.length}</span>}</div>
                {media && <div className="listing-gallery-caption"><span>{media.name}</span><button type="button" className="listing-text-button" onClick={() => onPreview({ src: media.url, mimeType: media.mimeType, name: media.name })}>Enlarge / save media</button></div>}
                {listing.media.length > 0 && <div className="listing-gallery-grid">{listing.media.map((item, index) => <button className={`listing-thumbnail ${index === selectedIndex ? 'listing-thumbnail-selected' : ''}`} type="button" key={item.url} onClick={() => setSelectedIndex(index)} aria-label={`Show ${item.name}`} aria-pressed={index === selectedIndex}>
                  {item.mimeType.startsWith('image/') ? <ProfileImage src={item.url} alt={item.name} loading="lazy" /> : <div className="listing-thumbnail-media">{item.mimeType.startsWith('video/') ? '▶ Video' : '♫ Audio'}</div>}
                  <span>{item.isCover ? 'Cover photo' : item.name}</span>
                </button>)}</div>}
              </section>
              <section className="listing-panel"><p className="listing-eyebrow">Make yourself at home</p><h2>About this accommodation</h2><p className="listing-description">{listing.description || 'The owner has not added a description yet.'}</p></section>
            </div>
            <aside className="listing-sidebar"><section className="listing-panel listing-summary"><p className="listing-eyebrow">Listed price</p><p className="listing-price">{listing.price || 'Price on request'}</p><dl><div><dt>Property type</dt><dd>{listing.property_type || 'Accommodation'}</dd></div><div><dt>Location</dt><dd>{listing.location || 'Not provided'}</dd></div><div><dt>Media gallery</dt><dd>{listing.media.length} uploaded {listing.media.length === 1 ? 'item' : 'items'}</dd></div></dl><div className="listing-rating"><p className="listing-eyebrow">Renter ratings</p>{listing.ratingError ? <p className="listing-muted">{listing.ratingError}</p> : <><div className="listing-rating-value"><span aria-hidden="true">★</span> {count ? average.toFixed(1) : '—'}<small>/ 5</small></div><p className="listing-muted">{count ? `${count} ${count === 1 ? 'rating' : 'ratings'}` : 'No ratings yet'}</p></>}</div>{isOwner && listing.moderation_reason && <p className="listing-notice">Review feedback: {listing.moderation_reason}</p>}</section></aside>
          </div>
  </>;
}
