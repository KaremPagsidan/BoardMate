import { reportMediaFailure } from '../lib/mediaDiagnostics';
import { uploadedMediaLocation } from '../lib/profilePhotoAccess';
import { useState } from 'react';
import useUploadedMedia from '../hooks/useUploadedMedia';
import '../media.css';
function ResolvedMedia({ as: Tag, src, onRetry, onError, ...props }) {
  const { url, status } = useUploadedMedia(src, { withStatus: true });
  const [failed, setFailed] = useState(false);
  if (status === 'error' || failed) return <span className="text-[10px]" role="status">Media unavailable. <button type="button" onClick={onRetry} className="underline">Retry</button></span>;
  if (status === 'loading') return <span className="text-[10px]" role="status">Loading media...</span>;
  return <Tag {...props} src={url} onError={event => { reportMediaFailure(src, 'decode', uploadedMediaLocation(src), { code: 'decode_failed' }); setFailed(true); onError?.(event); }} />;
}
export default function UploadedMedia(props) {
  const [attempt, setAttempt] = useState(0);
  return <ResolvedMedia key={`${props.src}-${attempt}`} {...props} className={`bm-uploaded-media ${props.className || ''}`} onRetry={() => setAttempt(value => value + 1)} />;
}
