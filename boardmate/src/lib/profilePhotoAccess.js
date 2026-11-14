import { mediaAccessError, reportMediaFailure } from './mediaDiagnostics';
export function uploadedMediaLocation(src) {
  if (typeof src !== 'string') return null;
  try {
    const url = new URL(src);
    if (url.origin !== new URL(import.meta.env.VITE_SUPABASE_URL).origin) return null;
    const match = url.pathname.match(/^\/storage\/v1\/object\/(?:public|authenticated|sign)\/(profile-photos|listing-photos|roommate-post-photos)\/(.+)$/);
    return match ? { bucket: match[1], path: decodeURIComponent(match[2]) } : null;
  } catch { return null; }
}
export function profilePhotoPath(src) { const location = uploadedMediaLocation(src); return location?.bucket === 'profile-photos' ? location.path : null; }
export async function canReadUploadedMedia(src) {
  const location = uploadedMediaLocation(src);
  if (!location) return true;
  const { supabase } = await import('../supabaseClient');
  const { data, error } = await supabase.rpc(location.bucket === 'profile-photos' ? 'can_read_boardmate_profile_photo' : 'can_read_boardmate_uploaded_media',
    location.bucket === 'profile-photos' ? { p_path: location.path } : { p_bucket: location.bucket, p_path: location.path });
  if (error) {
    reportMediaFailure(src, 'permission', location, error);
    throw mediaAccessError('permission', location, error);
  }
  if (data !== true) reportMediaFailure(src, 'permission', location, { code: 'access_denied' });
  return data === true;
}
export async function downloadProfilePhoto(src) {
  const location = uploadedMediaLocation(src);
  if (!location) return null;
  const { supabase } = await import('../supabaseClient');
  const { data, error } = await supabase.storage.from(location.bucket).download(location.path, {}, { cache: 'no-store' });
  if (error) {
    reportMediaFailure(src, 'download', location, error);
    throw mediaAccessError('download', location, error);
  }
  return data;
}

let revision = 0;
const listeners = new Set();
let cleanup;
export const photoAccessRevision = () => revision;
export function notifyPhotoAccess() { revision += 1; listeners.forEach(listener => listener()); }
export function subscribePhotoAccess(listener) {
  listeners.add(listener);
  if (!cleanup) {
    let disposed = false, stopConnection = () => {};
    import('../supabaseClient').then(({ supabase }) => {
      if (disposed) return;
      const channel = supabase.channel(`profile-photo-access-${crypto.randomUUID()}`)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'boardmate_visibility_revision' }, notifyPhotoAccess).subscribe();
      const { data: { subscription } } = supabase.auth.onAuthStateChange(notifyPhotoAccess);
      stopConnection = () => { subscription.unsubscribe(); supabase.removeChannel(channel); };
    });
    const timer = window.setInterval(notifyPhotoAccess, 15000);
    window.addEventListener('focus', notifyPhotoAccess);
    cleanup = () => { disposed = true; window.clearInterval(timer); window.removeEventListener('focus', notifyPhotoAccess); stopConnection(); cleanup = null; };
  }
  return () => { listeners.delete(listener); if (!listeners.size) cleanup?.(); };
}
