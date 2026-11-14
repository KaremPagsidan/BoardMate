// Normalize already-authorized profile/post media. This helper never reads
// verification documents or fetches private profile fields.
export function collectProfileMedia(photos = [], posts = []) {
  const result = [];
  const seen = new Set();
  const add = (media, fallbackName) => {
    if (!media) return;
    const item = typeof media === 'string' ? { url: media } : media;
    const raw = item.photo_url || item.url;
    if (typeof raw !== 'string') return;
    let url;
    try {
      url = new URL(raw);
      if (!['https:', 'http:'].includes(url.protocol)) return;
    } catch { return; }
    if (seen.has(url.href)) return;
    const extension = url.pathname.split('.').pop()?.toLowerCase();
    const inferred = ['mp4', 'webm', 'mov'].includes(extension) ? 'video/*'
      : ['mp3', 'm4a', 'wav', 'ogg', 'aac'].includes(extension) ? 'audio/*' : 'image/*';
    const mimeType = typeof item.mimeType === 'string' ? item.mimeType : inferred;
    if (!/^(image|video|audio)\//.test(mimeType)) return;
    seen.add(url.href);
    result.push({ url: url.href, mimeType, name: typeof item.name === 'string' && item.name ? item.name : fallbackName,
      createdAt: item.created_at || item.createdAt || null,
      photoId: item.photo_url ? item.id : null, isPublic: item.is_public !== false });
  };
  if (Array.isArray(photos)) photos.forEach(item => add(item, 'Profile photo'));
  if (Array.isArray(posts)) posts.forEach(post => {
    const title = post.title || post.heading || 'Post';
    const cover = post.image || post.imageUrl || post.image_url;
    const media = Array.isArray(post.photos) ? post.photos : [];
    if (cover) add(media.find(item => item?.url === cover) || cover, `${title} cover`);
    media.forEach(item => add(item, `${title} media`));
  });
  return result;
}

export function profilePostStatus(status) {
  if (status === 'approved') return 'Published';
  if (status === 'rejected') return 'Needs changes';
  return 'Pending review';
}
