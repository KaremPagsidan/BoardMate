import UploadedMedia from './UploadedMedia';
import ProfileImage from './ProfileImage';
import '../media.css';

export default function PostMedia({ media = [], onPreview }) {
  return <div className="bm-post-media">{(Array.isArray(media) ? media : []).filter(Boolean).map((value, index) => {
    const item = typeof value === 'string' ? { url: value } : value;
    const src = item.url || item.src || item.previewUrl || item.photo_url;
    const mimeType = item.mimeType || item.type || 'image/*';
    const name = item.name || `Attachment ${index + 1}`;
    const preview = () => onPreview({ src, name, mimeType });
    return <figure key={item.path || src || index}>
      {mimeType.startsWith('video/') ? <UploadedMedia as="video" src={src} controls playsInline preload="metadata" aria-label={name} />
        : mimeType.startsWith('audio/') ? <UploadedMedia as="audio" src={src} controls preload="metadata" aria-label={name} />
          : mimeType.startsWith('image/') ? <button type="button" onClick={preview} aria-label={`Preview ${name}`}><ProfileImage src={src} alt={name} className="bm-post-media-image" /></button>
            : <p>File attachment</p>}
      <figcaption>{name}</figcaption>
      <button type="button" className="bm-profile-link" onClick={preview}>Preview and download</button>
    </figure>;
  })}</div>;
}
