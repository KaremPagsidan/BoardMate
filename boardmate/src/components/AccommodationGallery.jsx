import UploadedMedia from './UploadedMedia';
import ProfileImage from './ProfileImage';
import { useState } from 'react';
import { collectProfileMedia } from '../lib/profilePresentation';
import '../accommodationDetails.css';

export default function AccommodationGallery({ listing, onPreview }) {
  const media = Array.isArray(listing.media) ? listing.media : collectProfileMedia([], [listing]);
  const [selectedUrl, setSelectedUrl] = useState(null);
  const [failedUrl, setFailedUrl] = useState(null);
  const selected = media.find(item => item.url === selectedUrl) || media[0];
  if (!selected) return <p className="accommodation-empty">No media has been uploaded for this accommodation.</p>;
  const preview = () => onPreview({ src: selected.url, name: selected.name, mimeType: selected.mimeType });
  return <section className="accommodation-gallery" aria-label="Accommodation media gallery">
    <div className="accommodation-hero">
      {failedUrl === selected.url ? <p role="status">This file could not be loaded. Select another item below.</p>
        : selected.mimeType.startsWith('video/') ? <UploadedMedia as="video" key={selected.url} src={selected.url} controls playsInline preload="metadata" aria-label={selected.name} onError={() => setFailedUrl(selected.url)} />
          : selected.mimeType.startsWith('audio/') ? <div className="accommodation-audio"><p>{selected.name}</p><UploadedMedia as="audio" key={selected.url} src={selected.url} controls preload="metadata" aria-label={selected.name} onError={() => setFailedUrl(selected.url)} /></div>
            : <button type="button" onClick={preview} aria-label={`Enlarge ${selected.name}`}><ProfileImage src={selected.url} alt={selected.name} onError={() => setFailedUrl(selected.url)} /></button>}
    </div>
    <div className="accommodation-caption"><span>{media.indexOf(selected) + 1} / {media.length}</span><button type="button" onClick={preview}>Open full screen</button></div>
    {media.length > 1 && <div className="accommodation-thumbnails">{media.map(item => <button type="button" key={item.url} aria-label={`Show ${item.name}`} aria-pressed={item.url === selected.url} onClick={() => { setSelectedUrl(item.url); setFailedUrl(null); }}>
      {item.mimeType.startsWith('image/') ? <ProfileImage src={item.url} alt={item.name} loading="lazy" /> : <span>{item.mimeType.startsWith('video/') ? 'Video' : 'Audio'}</span>}
    </button>)}</div>}
  </section>;
}
