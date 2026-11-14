import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { uploadedMediaLocation, canReadUploadedMedia, downloadProfilePhoto, subscribePhotoAccess, photoAccessRevision } from '../lib/profilePhotoAccess';
const noSubscribe = () => () => {};
export default function useUploadedMedia(src, { accessOnly = false, withStatus = false } = {}) {
  const privateMedia = Boolean(uploadedMediaLocation(src));
  const revision = useSyncExternalStore(privateMedia ? subscribePhotoAccess : noSubscribe, photoAccessRevision, photoAccessRevision);
  const [resolved, setResolved] = useState(null);
  const cached = useRef(null), pending = useRef(null);
  useEffect(() => () => {
    if (cached.current?.url) URL.revokeObjectURL(cached.current.url);
    cached.current = null; pending.current = null;
  }, [src, accessOnly]);
  useEffect(() => {
    if (!privateMedia) return undefined;
    let active = true;
    const load = async () => {
      if (!(await canReadUploadedMedia(src))) throw new Error('Unavailable');
      if (cached.current?.src === src) return;
      if (accessOnly) { cached.current = { src, url: src }; setResolved(cached.current); return; }
      if (!pending.current || pending.current.src !== src) pending.current = { src, promise: downloadProfilePhoto(src) };
      const blob = await pending.current.promise;
      if (!active) return;
      if (!(await canReadUploadedMedia(src))) throw new Error('Media access changed during download.');
      if (!active) return;
      const url = URL.createObjectURL(blob);
      cached.current = { src, url }; setResolved(cached.current);
    };
    load().catch(() => {
      if (!active) return;
      if (cached.current?.url) URL.revokeObjectURL(cached.current.url);
      cached.current = null; pending.current = null; setResolved({ src, url: null, error: true });
    });
    return () => { active = false; };
  }, [src, privateMedia, revision, accessOnly]);
  const url = privateMedia ? (resolved?.src === src ? resolved.url : null) : src;
  if (withStatus) return { url, status: url ? 'ready' : resolved?.src === src && resolved.error ? 'error' : src ? 'loading' : 'error' };
  return url;
}
