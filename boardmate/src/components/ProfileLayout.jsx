import UploadedMedia from './UploadedMedia';
import ProfileImage from './ProfileImage';
import { useId, useRef } from 'react';
import VerifiedBadge from './VerifiedBadge';
import LocationIcon from './LocationIcon';
import { profilePostStatus } from '../lib/profilePresentation';
import '../profile.css';
import ProfilePhotoMenu from './ProfilePhotoMenu';
import useUploadedMedia from '../hooks/useUploadedMedia';

export function ProfileHero({ name, avatar, role, verified, onPreview, onPhotoChange, uploading = false, headingAs = 'h1' }) {
  const inputRef = useRef(null);
  const Heading = headingAs;
  return (
    <header className="bm-profile-hero">
      <div className="bm-profile-avatar-wrap">
        {avatar ? <button type="button" className="bm-profile-avatar" onClick={() => onPreview?.({ src: avatar, name: `${name || 'Member'} profile photo`, mimeType: 'image/*' })} aria-label="View profile photo">
          <ProfileImage src={avatar} alt={`${name || 'Member'} profile`} />
        </button> : <div className="bm-profile-avatar bm-profile-avatar-empty" aria-label="No profile photo">
          <svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="17" r="8" /><path d="M9 43c0-10 6-15 15-15s15 5 15 15" /></svg>
        </div>}
        {onPhotoChange && <>
          <button type="button" className="bm-profile-avatar-edit" disabled={uploading} onClick={() => inputRef.current?.click()} aria-label={uploading ? 'Uploading profile photo' : 'Update profile photo'} title="Update profile photo">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M8 5l1.5-2h5L16 5h3a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2z" /><circle cx="12" cy="12.5" r="4" /></svg>
          </button>
          <input ref={inputRef} type="file" hidden accept="image/*" onChange={onPhotoChange} disabled={uploading} aria-label="Choose a profile photo" />
        </>}
      </div>
      <div className="bm-profile-name"><Heading>{name || 'BoardMate member'}</Heading>{verified && <VerifiedBadge className="h-5 w-5 shrink-0 text-xs" />}</div>
      <p className="bm-profile-role">{role}</p>
      {uploading && <p className="bm-profile-upload-status" role="status">Uploading your photo…</p>}
    </header>
  );
}

export function ProfileSection({ title, action, onAction, children }) {
  const titleId = useId();
  return <section className="bm-profile-section" aria-labelledby={titleId}>
    <div className="bm-profile-section-heading"><h2 id={titleId}>{title}</h2>{onAction && <button type="button" onClick={onAction} className="bm-profile-link">{action || 'See all'}</button>}</div>
    {children}
  </section>;
}

export function ProfileDetails({ fields, onEdit }) {
  return <ProfileSection title="Account information" action="Edit details" onAction={onEdit}>
    <dl className="bm-profile-details">{fields.map(field => <div key={field.label} className={field.wide ? 'bm-profile-detail-wide' : undefined}>
      <dt>{field.label}</dt><dd>{field.value || 'Not provided'}</dd>
    </div>)}</dl>
  </ProfileSection>;
}

export function ProfileMediaGallery({ media, onPreview, onPhotoChanged, emptyText = 'No photos or media yet.' }) {
  if (!media.length) return <p className="bm-profile-empty">{emptyText}</p>;
  return <div className="bm-profile-media-grid">{media.map(item => <ProfileMediaTile key={item.url} item={item} onPreview={onPreview} onPhotoChanged={onPhotoChanged} />)}</div>;
}

function ProfileMediaTile({ item, onPreview, onPhotoChanged }) {
  const resolved = useUploadedMedia(item.url, { accessOnly: !item.mimeType.startsWith('image/') });
  if (!resolved) return null;
  return <figure>
    <button type="button" className="bm-profile-media-tile" onClick={() => onPreview({ src: item.url, name: item.name, mimeType: item.mimeType })} aria-label={`Preview ${item.name}`}>
      {item.mimeType.startsWith('image/') ? <ProfileImage src={resolved} alt={item.name} loading="lazy" />
        : <span className="bm-profile-media-type"><span aria-hidden="true">{item.mimeType.startsWith('video/') ? '▶' : '♫'}</span>{item.mimeType.startsWith('video/') ? 'Video' : 'Audio'}</span>}
    </button>{onPhotoChanged && <ProfilePhotoMenu photo={item} onChanged={onPhotoChanged} />}<figcaption>{item.name}{item.photoId && !item.isPublic && <span> · Only Me</span>}{item.createdAt && !Number.isNaN(Date.parse(item.createdAt)) && <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleDateString()}</time>}</figcaption>
  </figure>;
}

export function ProfilePostMedia({ media, onPreview, onPhotoChanged }) {
  if (!media.length) return null;
  return <div className="bm-profile-post-media">{media.map(item => <div key={item.url}>
    {item.mimeType.startsWith('video/') ? <><UploadedMedia as="video" src={item.url} controls playsInline preload="metadata" aria-label={item.name} /><button type="button" className="bm-profile-link" onClick={() => onPreview({ src: item.url, name: item.name, mimeType: item.mimeType })}>Preview and save video</button></>
      : item.mimeType.startsWith('audio/') ? <div className="bm-profile-audio"><p>{item.name}</p><UploadedMedia as="audio" src={item.url} controls preload="metadata" aria-label={item.name} /><button type="button" className="bm-profile-link" onClick={() => onPreview({ src: item.url, name: item.name, mimeType: item.mimeType })}>Preview and save audio</button></div>
        : <div className="bm-profile-managed-photo"><button type="button" className="bm-profile-post-photo" onClick={() => onPreview({ src: item.url, name: item.name, mimeType: item.mimeType })} aria-label={`Preview ${item.name}`}><ProfileImage src={item.url} alt={item.name} loading="lazy" /></button>{onPhotoChanged && <ProfilePhotoMenu photo={item} onChanged={onPhotoChanged} />}</div>}
  </div>)}</div>;
}

export function ProfilePostCard({ title, price, priceLabel = 'Listed price', location, description, status, reason, media = [], onOpen, onPreview, onPhotoChanged, actions, children }) {
  return <article className="bm-profile-post">
    <header className="bm-profile-post-heading"><h3>{onOpen ? <button type="button" onClick={onOpen}>{title || 'Untitled post'}</button> : title || 'Untitled post'}</h3>{status && <span className={`bm-profile-post-status bm-profile-status-${status}`}>{profilePostStatus(status)}</span>}</header>
    {price && <p className="bm-profile-post-price"><span>{priceLabel}</span>{price}</p>}
    {location && <div className="bm-profile-location"><LocationIcon className="h-4 w-4 shrink-0" /><p>{location}</p></div>}
    {description && <p className="bm-profile-post-description">{description}</p>}
    <ProfilePostMedia media={media} onPreview={onPreview} onPhotoChanged={onPhotoChanged} />
    {reason && <p className="bm-profile-review-reason">Review feedback: {reason}</p>}
    {children}
    {(onOpen || actions) && <footer className="bm-profile-post-actions">{onOpen && <button type="button" className="bm-profile-link" onClick={onOpen}>View full details</button>}<div>{actions}</div></footer>}
  </article>;
}

export function ProfilePreviewDialog({ title, onClose, children }) {
  const titleId = useId();
  return <div className="bm-profile-modal-backdrop" onClick={onClose}>
    <section className="bm-profile-modal" role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={event => event.stopPropagation()}>
      <header className="bm-profile-modal-heading"><h2 id={titleId}>{title}</h2><button type="button" onClick={onClose} aria-label="Close profile preview">×</button></header>
      <div className="bm-profile-modal-content">{children}</div>
    </section>
  </div>;
}
