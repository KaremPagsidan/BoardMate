import { useEffect, useState, useSyncExternalStore } from 'react';
import useAppDialog from '../hooks/useAppDialog';
import { uploadedMediaLocation, subscribePhotoAccess, photoAccessRevision } from '../lib/profilePhotoAccess';

export default function ProfilePhotoMenu({ photo, onChanged }) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false);
  const [isPublic, setIsPublic] = useState(photo.isPublic !== false);
  const [loaded, setLoaded] = useState(false);
  const revision = useSyncExternalStore(subscribePhotoAccess, photoAccessRevision, photoAccessRevision);
  const { confirm, notify } = useAppDialog();
  const location = uploadedMediaLocation(photo.url);
  const bucket = location?.bucket, path = location?.path;
  useEffect(() => {
    if (!bucket) return undefined;
    let active = true;
    const load = async () => {
      if (bucket === 'profile-photos') return photo.isPublic !== false;
      const { supabase } = await import('../supabaseClient');
      const { data, error } = await supabase.from('uploaded_photo_privacy').select('is_public').eq('bucket_id', bucket).eq('storage_path', path).maybeSingle();
      if (error) throw error;
      return data?.is_public !== false;
    };
    load().then(value => { if (active) { setIsPublic(value); setLoaded(true); } }).catch(() => { if (active) setLoaded(false); });
    return () => { active = false; };
  }, [bucket, path, photo.isPublic, revision]);
  if (!location || !photo.mimeType.startsWith('image/')) return null;
  const act = async action => {
    setOpen(false);
    if (action === 'delete' && !(await confirm('Permanently delete this photo? It will be removed from your profile and other users’ views. This cannot be undone.'))) return;
    setBusy(true);
    try {
      const { deleteProfilePhoto, setProfilePhotoVisibility } = await import('../lib/profileMedia');
      if (action === 'delete') await deleteProfilePhoto(photo);
      else { await setProfilePhotoVisibility(photo, action === 'public'); setIsPublic(action === 'public'); }
      await onChanged?.(photo, action);
    } catch (error) { await notify(error.message, 'Photo could not be updated'); }
    finally { setBusy(false); }
  };
  return <div className="bm-photo-menu">
    {!isPublic && <span className="bm-photo-privacy-label">Only Me</span>}
    <button type="button" aria-label={`Manage ${photo.name}`} aria-expanded={open} disabled={busy || !loaded} onClick={() => setOpen(value => !value)}>⋮</button>
    {open && <div className="bm-photo-menu-options">
      <button type="button" onClick={() => act(isPublic ? 'private' : 'public')}>{isPublic ? 'Only Me (Hide Photo)' : 'Public (Unhide Photo)'}</button>
      <button type="button" onClick={() => act('delete')}>Delete Photo</button>
    </div>}
  </div>;
}
