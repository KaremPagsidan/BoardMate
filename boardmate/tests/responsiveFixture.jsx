import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../src/index.css';
import ListingSearchDialog from '../src/components/ListingSearchDialog';
import SearchResultsDialog from '../src/components/SearchResultsDialog';
import RoommatePostPage from '../src/components/RoommatePostPage';
import AccommodationDetailPage from '../src/components/AccommodationDetailPage';
import SearchBar from '../src/components/SearchBar';
import ConversationMediaPlayer from '../src/components/ConversationMediaPlayer';
import PostMedia from '../src/components/PostMedia';
import MediaPreviewDialog from '../src/components/MediaPreviewDialog';
import VerificationFilePreview from '../src/components/VerificationFilePreview';
import ImageCropDialog from '../src/components/ImageCropDialog';
import { AppNoticeDialog } from '../src/components/AppDialogProvider';
import { defaultListingFilters } from '../src/lib/listingSearch';
import AppViewport from '../src/components/AppViewport';
import QuickActions from '../src/components/QuickActions';
import { ListingDetailsContent } from '../src/components/ListingDetailsPage';

const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="2400"><rect width="1200" height="2400" fill="#82ab85"/></svg>';
const image = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
const canvas = document.createElement('canvas');
canvas.width = 1200; canvas.height = 2400;
canvas.getContext('2d').fillRect(0, 0, canvas.width, canvas.height);
const png = Uint8Array.from(atob(canvas.toDataURL('image/png').split(',')[1]), character => character.charCodeAt(0));
const file = new File([png], 'portrait.png', { type: 'image/png' });
const wave = new ArrayBuffer(1644);
const view = new DataView(wave);
const word = (offset, text) => [...text].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
word(0, 'RIFF'); view.setUint32(4, 1636, true); word(8, 'WAVE'); word(12, 'fmt ');
view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
view.setUint32(24, 8000, true); view.setUint32(28, 16000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
word(36, 'data'); view.setUint32(40, 1600, true);
const audio = URL.createObjectURL(new Blob([wave], { type: 'audio/wav' }));
const textFile = URL.createObjectURL(new Blob(['BoardMate attachment'], { type: 'text/plain' }));
const video = await new Promise(resolve => {
  const stream = canvas.captureStream(10);
  const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
  const chunks = [];
  recorder.ondataavailable = event => chunks.push(event.data);
  recorder.onstop = () => { stream.getTracks().forEach(track => track.stop()); resolve(URL.createObjectURL(new Blob(chunks, { type: 'video/webm' }))); };
  recorder.start();
  setTimeout(() => { canvas.getContext('2d').fillRect(0, 0, 100, 100); }, 100);
  setTimeout(() => recorder.stop(), 350);
});
export default function Fixture() {
  const [kind, setKind] = useState('search');
  const [filters, setFilters] = useState(defaultListingFilters);
  const [query, setQuery] = useState('BoardMate');
  const [preview, setPreview] = useState(null);
  useEffect(() => { window.showFixture = setKind; return () => { delete window.showFixture; }; }, []);
  const close = () => setKind('closed');
  const media = { src: image, name: 'Portrait preview', mimeType: 'image/svg+xml' };
  const listing = { id: 'fixture', owner_id: 'owner', title: 'Accommodation with a long readable title',
    price: '₱12,345.00 / month', location: 'Long location '.repeat(8), property_type: 'Boarding House',
    description: 'Property description. '.repeat(120), is_available: true, moderation_status: 'approved',
    rating: { average: 4.5, count: 24 }, media: [
      { url: image, name: 'Cover photo', mimeType: 'image/svg+xml', isCover: true },
      { url: video, name: 'Video tour', mimeType: 'video/webm' },
      { url: audio, name: 'Audio tour', mimeType: 'audio/wav' },
    ] };
  const isListing = kind === 'owner-listing' || kind === 'user-listing' || kind === 'desktop-listing';
  const details = <div className="listing-detail-root"><header className="listing-site-header"><a href="#" className="listing-brand">BoardMate</a><a href="#" className="listing-back-link">Back to dashboard</a></header>
    <main className="listing-detail-main"><ListingDetailsContent listing={listing} user={{ id: kind === 'owner-listing' ? 'owner' : 'renter' }} onPreview={setPreview} /></main>
    <footer className="listing-site-footer">BoardMate</footer>{preview && <MediaPreviewDialog media={preview} onClose={() => setPreview(null)} />}</div>;
  if (kind === 'desktop-listing') return details;
  return <><AppViewport>
    {isListing ? <AccommodationDetailPage listing={listing} onBack={() => setKind('results')} onPreviewMedia={setPreview} actions={<button type="button" onClick={() => setQuery('Saved')}>Save listing</button>} /> : <>
      <div className="boardmate-user-dashboard relative flex min-h-0 flex-1 flex-col">
        {kind === 'search' && <ListingSearchDialog filters={filters} onChange={setFilters} locations={[{ name: 'Manila', count: 1 }]} onSave={close} onClose={close} />}
        {kind === 'results' && <SearchResultsDialog query={query} onQueryChange={setQuery} listings={[{ ...listing, image, propertyType: 'Boarding House' }]} roommatePosts={[{ id: 'post', title: 'Roommate post', name: 'Member', budget: '₱4,000' }]} onSelectRoommatePost={() => setKind('post')} onSelectListing={() => setKind('user-listing')} onClose={close} />}
        {kind === 'actions' && <div style={{ padding: 16 }}><QuickActions variant="renter">{['Search Accommodations', 'Roommate Finder', 'Messages', 'Saved Listings', 'Notifications'].map(label => <button key={label} className="col-span-2 p-2" onClick={() => setKind('results')}><span className="font-bold">{label}</span></button>)}</QuickActions><QuickActions>{['Add New Listing', 'My Listing', 'Messages', 'Notifications'].map(label => <button key={label} onClick={() => setKind('owner-listing')}><span className="font-bold">{label}</span></button>)}</QuickActions></div>}
        {kind === 'post' && <RoommatePostPage post={{ name: 'BoardMate member', title: 'Roommate search', budget: '₱4,000', location: 'Manila', details: 'Long description. '.repeat(200), photos: [...listing.media, { url: textFile, mimeType: 'text/plain', name: 'document.txt' }] }} onBack={() => setKind('results')} onPreviewMedia={setPreview} onToggleLike={() => setQuery('Liked')} likeCount={query === 'Liked' ? 1 : 0} isLiked={query === 'Liked'} onMessage={() => setQuery('Message')} />}
        {kind === 'searchbars' && <div className="space-y-3 p-4"><SearchBar onClick={() => setKind('results')} aria-label="Dashboard search">Search BoardMate</SearchBar>{['Accommodation', 'Roommate', 'Listing', 'Conversation', 'Share'].map(label => <SearchBar key={label} aria-label={`${label} search`} placeholder={`Search ${label}`} />)}</div>}
        {kind === 'chat' && <div className="overflow-y-auto p-4" role="log"><div className="flex w-full items-start gap-1"><div className="bm-message-bubble bm-message-attachment max-w-[78%] rounded-xl p-2.5"><ConversationMediaPlayer src={video} mimeType="video/webm" onPreview={() => setPreview({ src: video, mimeType: 'video/webm' })} /><ConversationMediaPlayer src={audio} mimeType="audio/wav" onPreview={() => setPreview({ src: audio, mimeType: 'audio/wav' })} /></div></div><PostMedia media={[...listing.media, { url: textFile, mimeType: 'text/plain', name: 'very-long-attachment-name.txt' }]} onPreview={setPreview} /></div>}
        {kind === 'media' && <MediaPreviewDialog media={media} onClose={close} />}
        {kind === 'video' && <MediaPreviewDialog media={{ src: video, name: 'Video', mimeType: 'video/webm' }} onClose={close} />}
        {kind === 'audio' && <MediaPreviewDialog media={{ src: audio, name: 'Audio', mimeType: 'audio/wav' }} onClose={close} />}
        {kind === 'file' && <VerificationFilePreview file={file} label="ID" />}
        {kind === 'crop' && <ImageCropDialog file={file} previewUrl={image} onClose={close} />}
      </div>
    </>}
    {preview && <MediaPreviewDialog media={preview} onClose={() => setPreview(null)} />}
  </AppViewport>{kind === 'notice' && <AppNoticeDialog item={{ title: 'Notification', message: 'Long notice. '.repeat(100) }} onAnswer={close} />}</>;
}
createRoot(document.getElementById('root')).render(<Fixture />);
