import ProfileImage from './ProfileImage';
import { useEffect, useRef, useState } from 'react';
import '../verificationPreview.css';
import useFrameDialog from '../hooks/useFrameDialog';

export default function VerificationFilePreview({ file, label, onRemove, onRetake, disabled = false }) {
  const thumbnail = useRef(null);
  const enlarged = useRef(null);
  const pdf = useRef(null);
  const pdfLink = useRef(null);
  const [zoom, setZoom] = useState(1);
  const [failedFile, setFailedFile] = useState(null);
  const dialog = useRef(null);
  useFrameDialog(dialog, Boolean(file));
  useEffect(() => {
    if (!file) return undefined;
    const url = URL.createObjectURL(file);
    if (thumbnail.current) thumbnail.current.src = url;
    if (enlarged.current) enlarged.current.src = url;
    if (pdf.current) pdf.current.data = url;
    if (pdfLink.current) pdfLink.current.href = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const failed = failedFile === file;
  if (!file) return null;
  const isImage = ['image/jpeg', 'image/png', 'image/webp'].includes(file.type);
  const isPdf = file.type === 'application/pdf';
  const open = () => { setZoom(1); dialog.current?.showModal(); };
  return <div className="verification-file-preview">
    <p className="verification-file-title">{label}</p>
    {isImage && !failed ? <button type="button" className="verification-file-thumbnail" onClick={open} aria-label={`View or zoom ${label}`}>
      <ProfileImage ref={thumbnail} alt={`${label} preview`} onError={() => setFailedFile(file)} />
    </button> : <p className="verification-file-note">{isPdf ? 'PDF document selected' : failed ? 'Image preview unavailable. Remove this file and select a supported image.' : 'Preview unavailable for this file type. Choose a supported image or PDF ID.'}</p>}
    <p className="verification-file-name">{file.name}</p>
    <div className="verification-file-actions">
      {(isPdf || (isImage && !failed)) && <button type="button" onClick={open}>{isPdf ? 'View PDF' : 'View / Zoom'}</button>}
      {onRetake && <button type="button" onClick={onRetake} disabled={disabled}>Retake selfie</button>}
      {onRemove && <button type="button" onClick={onRemove} disabled={disabled}>Remove</button>}
    </div>
    <dialog ref={dialog} className="verification-file-dialog" aria-label={`${label} preview`}>
      <header><strong>{label}</strong><button type="button" onClick={() => dialog.current?.close()} aria-label="Close document preview">Close</button></header>
      {isPdf ? <object ref={pdf} type="application/pdf" className="verification-file-pdf"><p>Your browser cannot display this PDF. <a ref={pdfLink} target="_blank" rel="noopener noreferrer">Open selected PDF</a></p></object>
        : isImage && <>
          <label className="verification-file-zoom">Zoom {Math.round(zoom * 100)}%<input type="range" min="1" max="3" step="0.25" value={zoom} onChange={event => setZoom(Number(event.target.value))} /></label>
          <div className="verification-file-canvas"><ProfileImage ref={enlarged} alt={`${label} enlarged`} style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }} /></div>
        </>}
    </dialog>
  </div>;
}
