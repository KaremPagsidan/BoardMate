import useUploadedMedia from '../hooks/useUploadedMedia';
import { uploadedMediaLocation } from '../lib/profilePhotoAccess';

// Legacy public URLs remain stable identifiers. Bytes now require Storage RLS.
export default function ProfileImage({ src, alt = '', ...props }) {
  const resolved = useUploadedMedia(src);
  if (!resolved && uploadedMediaLocation(src)) return <span className={props.className} role="img" aria-label={alt || 'Photo unavailable'} style={props.style} />;
  return <img {...props} src={resolved || undefined} alt={alt} />;
}
