const buckets = new Set(['listing-photos', 'roommate-post-photos']);
export function normalizeAdminMedia(photos, bucket, baseUrl) {
  if (!buckets.has(bucket)) return [];
  let entries = photos;
  if (typeof entries === 'string') {
    try { entries = JSON.parse(entries); } catch { entries = [entries]; }
  }
  if (!Array.isArray(entries)) entries = entries ? [entries] : [];
  const seen = new Set();
  return entries.flatMap((entry, index) => {
    const photo = typeof entry === 'string' ? { url: entry } : entry;
    if (!photo || typeof photo !== 'object') return [];
    const reference = photo.path || photo.storage_path || photo.url || photo.src;
    if (typeof reference !== 'string' || !reference.trim()) return [];
    let src;
    try {
      const base = new URL(baseUrl);
      let path = reference.trim();
      if (/^https?:\/\//i.test(path)) {
        const url = new URL(path);
        const match = url.pathname.match(/^\/storage\/v1\/(?:object|render\/image)\/(?:public|authenticated|sign)\/(listing-photos|roommate-post-photos)\/(.+)$/);
        if (url.origin === base.origin && match) {
          if (match[1] !== bucket) return [];
          path = decodeURIComponent(match[2]);
        } else { src = url.href; }
      } else {
        if (/^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith('//')) return [];
        path = path.replace(/^\//, '');
        if (path.startsWith(`${bucket}/`)) path = path.slice(bucket.length + 1);
      }
      if (!src) {
        if (!path || path.split('/').some(part => !part || part === '.' || part === '..')) return [];
        src = `${base.origin}/storage/v1/object/authenticated/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`;
      }
    } catch { return []; }
    if (seen.has(src)) return [];
    seen.add(src);
    const name = photo.name || `Attachment ${index + 1}`;
    const extension = (photo.path || photo.storage_path || new URL(src).pathname).split('.').pop().toLowerCase();
    const mimeType = photo.mimeType || photo.mime_type || photo.type || ({ mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', ogg: 'audio/ogg', aac: 'audio/aac' })[extension] || 'image/jpeg';
    return [{ src, name, mimeType }];
  });
}
