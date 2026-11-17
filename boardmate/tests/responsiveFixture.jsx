import { Fragment, useEffect, useState } from 'react';
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
import usePullToRefresh from '../src/hooks/usePullToRefresh';

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
  const [registrationRole, setRegistrationRole] = useState('RENTER');
  const [registrationStep, setRegistrationStep] = useState(1);
  const [filters, setFilters] = useState(defaultListingFilters);
  const [query, setQuery] = useState('BoardMate');
  const [preview, setPreview] = useState(null);
  const pullRefreshIndicator = usePullToRefresh(async () => {
    window.pullToRefreshCount = (window.pullToRefreshCount || 0) + 1;
    await new Promise(resolve => window.setTimeout(resolve, 120));
    if (window.pullToRefreshFails) throw new Error('Refresh failed in the fixture.');
  }, kind === 'registration');
  useEffect(() => {
    window.showFixture = setKind;
    window.setRegistrationState = (role, step) => {
      setRegistrationRole(role);
      setRegistrationStep(step);
    };
    return () => {
      delete window.showFixture;
      delete window.setRegistrationState;
    };
  }, []);
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
  return <>{pullRefreshIndicator}<AppViewport>
    {isListing ? <AccommodationDetailPage listing={listing} onBack={() => setKind('results')} onPreviewMedia={setPreview} actions={<button type="button" onClick={() => setQuery('Saved')}>Save listing</button>} /> : <>
      <div className="boardmate-user-dashboard relative flex min-h-0 flex-1 flex-col">
        {kind === 'search' && <ListingSearchDialog filters={filters} onChange={setFilters} locations={[{ name: 'Manila', count: 1 }]} onSave={close} onClose={close} />}
        {kind === 'results' && <SearchResultsDialog query={query} onQueryChange={setQuery} listings={[{ ...listing, image, propertyType: 'Boarding House' }]} roommatePosts={[{ id: 'post', title: 'Roommate post', name: 'Member', budget: '₱4,000' }]} onSelectRoommatePost={() => setKind('post')} onSelectListing={() => setKind('user-listing')} onClose={close} />}
        {kind === 'actions' && <div style={{ padding: 16 }}><QuickActions variant="renter">{['Search Accommodations', 'Roommate Finder', 'Messages', 'Saved Listing', 'Notifications'].map((label, index) => <button key={label} className={`${index < 3 ? 'col-span-2' : 'col-span-3'} bg-[#CBE3D1] rounded-xl flex flex-col items-center justify-center text-center shadow-sm`} onClick={() => setKind('results')}><span aria-hidden="true">{['🏠', '👥', '✉', '💚', '♧'][index]}</span><span className="font-bold">{label}</span></button>)}</QuickActions><QuickActions>{['Add New Listing', 'My Listing', 'Messages', 'Notifications'].map(label => <button key={label} onClick={() => setKind('owner-listing')}><span className="font-bold">{label}</span></button>)}</QuickActions></div>}
        {kind === 'registration' && <div className="boardmate-registration flex h-full min-h-0 w-full flex-col overflow-hidden">
          <header className="boardmate-registration-header shrink-0 px-4 py-3 text-center">
            <h1 className="text-xl font-bold">{registrationRole === 'OWNER' ? 'Owner Registration' : 'User Registration'}</h1>
            <p className="text-[11px]">Registration step {registrationStep}</p>
            <div className="boardmate-registration-stepper flex items-start justify-center gap-2 mt-3 w-full max-w-[280px] mx-auto">
              {['Account Info', 'Verification', 'Review'].map((label, index) => <Fragment key={label}>
                {index > 0 && <span className="mt-4 h-[2px] min-w-3 flex-1 bg-gray-300" />}
                <span className="flex min-w-0 flex-col items-center"><span className="grid h-8 w-8 place-items-center rounded-full bg-[#82AB85] text-white">{index + 1}</span><span className="mt-1 whitespace-nowrap text-center text-[10px] font-semibold">{label}</span></span>
              </Fragment>)}
            </div>
          </header>
          <div className="boardmate-registration-body min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 space-y-4 no-scrollbar">
            {registrationStep === 1 && <div className="space-y-3">
              {['Full Name', 'Email Address', 'Phone Number', 'Password', 'Confirm Password', 'Date of Birth', 'Gender', ...(registrationRole === 'OWNER' ? ['Business / Owner Name', 'Address', 'Government ID Number', 'Role / Property Type'] : [])].map(label => <label key={label} className="block text-xs">{label}<input aria-label={label} type={label.includes('Password') ? 'password' : 'text'} className="mt-1 w-full rounded-xl border p-3" /></label>)}
            </div>}
            {registrationStep === 2 && <div className="space-y-4"><p className="rounded-xl bg-emerald-50 p-3 text-xs">We need to verify your identity.</p><label className="block">Upload a valid ID<input aria-label="Upload a valid ID" type="file" className="mt-2 block max-w-full" /></label><label className="block">Take a selfie<input aria-label="Take a selfie" type="file" className="mt-2 block max-w-full" /></label></div>}
            {registrationStep === 3 && <div className="space-y-4"><h2>Review your details</h2><p>{registrationRole === 'OWNER' ? 'Business and property information' : 'Renter account information'}</p><p>Verification documents</p></div>}
          </div>
          <footer className="boardmate-registration-footer shrink-0 border-t px-4 pt-3 pb-3 space-y-2"><button type="button" className="min-h-11 w-full rounded-xl bg-[#82AB85] text-white">Next</button><button type="button" className="min-h-11 w-full">Back</button></footer>
        </div>}
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
