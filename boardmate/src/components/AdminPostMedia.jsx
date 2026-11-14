import UploadedMedia from './UploadedMedia';
import { normalizeAdminMedia } from '../lib/adminMedia';
export default function AdminPostMedia({ photos, onPreview, bucket = 'roommate-post-photos', cover = false }) {
  const media = normalizeAdminMedia(photos, bucket, import.meta.env.VITE_SUPABASE_URL);
  return <div className={cover ? 'h-full w-full' : 'flex flex-wrap gap-2'}>{(cover ? media.slice(0, 1) : media).map(item => (
    <div key={item.src} className={cover ? 'flex h-full w-full flex-col overflow-hidden' : 'w-36 overflow-hidden rounded-lg border border-gray-200 bg-gray-50'}>
      {item.mimeType.startsWith('video/') || item.mimeType.startsWith('audio/')
        ? <><UploadedMedia as={item.mimeType.startsWith('video/') ? 'video' : 'audio'} src={item.src} controls playsInline preload="metadata" aria-label={item.name} className={cover ? 'min-h-0 w-full flex-1 object-contain' : 'h-24 w-full object-contain'} /><button type="button" onClick={() => onPreview(item)} className="block w-full bg-white p-1 text-[10px] font-semibold">Open full-size preview</button></>
        : <button type="button" onClick={() => onPreview(item)} aria-label={`Preview ${item.name}`} className={cover ? 'h-full w-full' : 'block h-24 w-full'}><UploadedMedia as="img" src={item.src} alt={item.name} loading="lazy" className="h-full w-full object-contain" /></button>}
    </div>
  ))}</div>;
}
