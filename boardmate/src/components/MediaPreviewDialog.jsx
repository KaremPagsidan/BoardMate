import UploadedMedia from './UploadedMedia';
import ProfileImage from './ProfileImage';
import { useEffect, useRef, useState } from 'react';
import ErrorDialog from './ErrorDialog';
import { downloadProfilePhoto, uploadedMediaLocation } from '../lib/profilePhotoAccess';

function getDownloadName(media) {
  if (media.name) return media.name;
  try {
    return decodeURIComponent(new URL(media.src).pathname.split('/').pop()) || 'boardmate-media';
  } catch {
    return 'boardmate-media';
  }
}

export default function MediaPreviewDialog({ media, onClose }) {
  return <MediaPreviewContent key={media.src} media={media} onClose={onClose} />;
}

function MediaPreviewContent({ media, onClose }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [zoom, setZoom] = useState(1);
  const dialog = useRef(null);
  const stage = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.focus();
    return () => previous?.focus?.();
  }, []);
  const isVideo = media.mimeType?.startsWith('video/');
  const isAudio = media.mimeType?.startsWith('audio/');
  const isDocument = media.mimeType && !media.mimeType.startsWith('image/') && !isVideo && !isAudio;

  const saveMedia = async () => {
    setSaving(true);
    setError('');
    try {
      let blob;
      if (uploadedMediaLocation(media.src)) blob = await downloadProfilePhoto(media.src);
      else {
        const response = await fetch(media.src);
        if (!response.ok) throw new Error(`The file could not be downloaded (${response.status}).`);
        blob = await response.blob();
      }
      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = getDownloadName(media);
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
    } catch (downloadError) {
      setError(downloadError.message || 'The file could not be saved to this device.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      ref={dialog}
      tabIndex={-1}
      className="bm-media-backdrop fixed inset-0 z-[110] flex items-center justify-center bg-black/85 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Preview ${media.name || 'media'}`}
      onClick={onClose}
      onKeyDown={event => {
        if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
        if (event.key === 'Tab') {
          const controls = [...dialog.current.querySelectorAll('button:not(:disabled), input, a[href], video[controls], audio[controls]')];
          const first = controls[0], last = controls.at(-1);
          if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
      }}
    >
      <div className="bm-media-dialog flex max-h-full w-full max-w-3xl flex-col items-center gap-3" onClick={event => event.stopPropagation()}>
        <div className="flex w-full shrink-0 items-center justify-between gap-3 text-white">
          <p className="min-w-0 truncate text-xs font-semibold">{media.name || 'Media preview'}</p>
          <button type="button" onClick={onClose} aria-label="Close preview" className="shrink-0 text-2xl">×</button>
        </div>
        {!isVideo && !isAudio && !isDocument && <label className="bm-media-zoom text-white">Zoom {Math.round(zoom * 100)}%
          <input aria-label="Image zoom" type="range" min="1" max="3" step="0.25" value={zoom} onChange={event => setZoom(Number(event.target.value))} />
          <button type="button" onClick={() => { setZoom(1); stage.current?.scrollTo(0, 0); }}>Reset</button>
        </label>}
        <div ref={stage} className="bm-media-stage">
          {isVideo ? <UploadedMedia as="video" src={media.src} controls playsInline />
            : isAudio ? <UploadedMedia as="audio" src={media.src} controls />
              : isDocument ? media.mimeType === 'application/pdf'
                ? <object data={media.src} type="application/pdf" aria-label={media.name || 'Document preview'}><p className="text-white">Preview unavailable. Save the file to open it on your device.</p></object>
                : <p className="text-white">Save this file to open it on your device.</p>
                : <ProfileImage src={media.src} alt={media.name || 'Media preview'} style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }} />}
        </div>
        <button
          type="button"
          onClick={saveMedia}
          disabled={saving}
          className="shrink-0 rounded-xl bg-white px-4 py-2 text-xs font-bold text-gray-900 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save to device'}
        </button>
      </div>
      <ErrorDialog message={error} onClose={() => setError('')} />
    </div>
  );
}
