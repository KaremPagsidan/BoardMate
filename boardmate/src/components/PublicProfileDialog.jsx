import useVisibilityRefresh from '../hooks/useVisibilityRefresh';
import { useEffect, useState } from 'react';
import { fetchBoardmatePublicProfile } from '../lib/publicProfiles';
import { supabase } from '../supabaseClient';
import MediaPreviewDialog from './MediaPreviewDialog';
import ErrorDialog from './ErrorDialog';
import { ProfileHero, ProfileSection, ProfileMediaGallery, ProfilePostCard } from './ProfileLayout';
import PortalPage from './PortalPage';
import RoommatePostPage from './RoommatePostPage';
import AccommodationDetailPage from './AccommodationDetailPage';
import { collectProfileMedia } from '../lib/profilePresentation';

export default function PublicProfileDialog({ userId, onClose }) {
  const [profile, setProfile] = useState(null);
  const [uniqueViewCount, setUniqueViewCount] = useState(null);
  const [error, setError] = useState('');
  const [viewCountError, setViewCountError] = useState('');
  const [loading, setLoading] = useState(true);
  const [mediaPreview, setMediaPreview] = useState(null);
  const [detail, setDetail] = useState(null);

  useEffect(() => {
    let active = true;
    const loadProfile = async () => {
      let loadedProfile = false;
      try {
        const data = await fetchBoardmatePublicProfile(userId);
        if (!active) return;
        setProfile(data);
        loadedProfile = true;
      } catch (loadError) {
        if (active) setError(`Unable to load this profile: ${loadError.message}`);
      }

      if (loadedProfile) {
        try {
          const { data: count, error: countError } = await supabase.rpc('record_boardmate_profile_view', {
            p_owner_id: userId,
          });
          if (countError) throw countError;
          if (active) setUniqueViewCount(Number(count) || 0);
        } catch (countError) {
          if (active) setViewCountError(`Unable to record this profile view: ${countError.message}`);
        }
      }
      if (active) setLoading(false);
    };
    loadProfile();
    return () => { active = false; };
  }, [userId]);

  useVisibilityRefresh(async () => {
    try { setProfile(await fetchBoardmatePublicProfile(userId)); }
    catch { setProfile(null); setMediaPreview(null); }
  }, Boolean(userId));


  if (detail) return <>
    {detail.type === 'listing'
      ? <AccommodationDetailPage listing={detail.post} onBack={() => setDetail(null)} onPreviewMedia={setMediaPreview} />
      : <RoommatePostPage post={{ ...detail.post, name: profile?.fullName }} onBack={() => setDetail(null)} onPreviewMedia={setMediaPreview} />}
    {mediaPreview && <MediaPreviewDialog media={mediaPreview} onClose={() => setMediaPreview(null)} />}
  </>;
  return (
    <>
      <PortalPage title="Member profile" onBack={onClose}>
        {loading && <p className="bm-profile-empty" role="status">Loading profile...</p>}
        {!loading && !profile && <p className="bm-profile-empty">This profile is unavailable.</p>}
        {profile && <div className="bm-profile-page">
          <ProfileHero name={profile.fullName || 'BoardMate member'} avatar={profile.avatarUrl}
            role="Public profile" headingAs="h3" verified={profile.verificationStatus === 'approved'} onPreview={setMediaPreview} />
          {uniqueViewCount !== null && <p className="bm-profile-post-meta">{uniqueViewCount} unique profile {uniqueViewCount === 1 ? 'view' : 'views'}</p>}
          <p className="bm-profile-public-note">Contact details are private and are not shown on public profiles.</p>
          <ProfileSection title="Photos & media">
            <ProfileMediaGallery media={collectProfileMedia(profile.photos, [...(profile.roommatePosts || []), ...(profile.listings || [])])} onPreview={setMediaPreview} emptyText="No public photos or media yet." />
          </ProfileSection>
          {profile.roommatePosts?.length > 0 && <ProfileSection title="Roommate posts">
            <div className="bm-profile-feed">{profile.roommatePosts.map(post => <ProfilePostCard key={post.id}
              onOpen={() => setDetail({ type: 'roommate', post })} title={post.title} price={post.budget} priceLabel="Budget" location={post.location} description={post.description}
              media={collectProfileMedia([], [post])} onPreview={setMediaPreview} />)}</div>
          </ProfileSection>}
          {profile.listings?.length > 0 && <ProfileSection title="Accommodation listings">
            <div className="bm-profile-feed">{profile.listings.map(listing => <ProfilePostCard key={listing.id}
              onOpen={() => setDetail({ type: 'listing', post: listing })} title={listing.title} price={listing.price} location={listing.location} description={listing.description}
              media={collectProfileMedia([], [listing])} onPreview={setMediaPreview} />)}</div>
          </ProfileSection>}
          {!profile.roommatePosts?.length && !profile.listings?.length && <p className="bm-profile-empty">No approved posts or listings yet.</p>}
        </div>}
      </PortalPage>
      {mediaPreview && <MediaPreviewDialog media={mediaPreview} onClose={() => setMediaPreview(null)} />}
      <ErrorDialog message={error || viewCountError} onClose={() => { setError(''); setViewCountError(''); }} />
    </>
  );
}
