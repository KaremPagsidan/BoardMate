import { supabase } from '../supabaseClient';

const bucket = 'roommate-post-photos';
const maxPhotoSize = 10 * 1024 * 1024;
const allowedPhotoTypes = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'video/mp4', 'video/webm', 'video/quicktime',
  'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/ogg', 'audio/webm', 'audio/aac',
]);

export async function uploadRoommatePostPhotos(userId, media) {
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError) throw new Error(`Could not verify your signed-in account: ${authError.message}`);
  if (!user || user.id !== userId) {
    throw new Error('Your signed-in account does not match this post. Please sign in again and retry.');
  }

  const existingPhotos = media.filter(item => !item.file).map(({ url, name, mimeType, path }) => ({
    url,
    name,
    mimeType,
    path,
  }));
  const uploadedPaths = [];
  const uploadedPhotos = [];

  try {
    for (const item of media.filter(entry => entry.file)) {
      if (!allowedPhotoTypes.has(item.file.type)) {
        throw new Error('Roommate post media must be a supported image, video, or audio file.');
      }
      if (item.file.size > maxPhotoSize) {
        throw new Error(`${item.file.name} is larger than the 10 MB media limit.`);
      }

      const extension = item.file.type.split('/')[1].replace('jpeg', 'jpg');
      const path = `${user.id}/${crypto.randomUUID()}.${extension}`;
      const { error } = await supabase.storage.from(bucket).upload(path, item.file, {
        contentType: item.file.type,
      });
      if (error) {
        if (error.message.toLowerCase().includes('bucket not found')) {
          throw new Error('The roommate-post-photos storage bucket is missing. Apply the latest Supabase migration, then try again.');
        }
        throw new Error(`Photo upload was blocked by Supabase Storage: ${error.message}`);
      }

      uploadedPaths.push(path);
      const { data } = supabase.storage.from(bucket).getPublicUrl(path);
      uploadedPhotos.push({
        url: data.publicUrl,
        path,
        name: item.file.name,
        mimeType: item.file.type,
      });
    }
  } catch (error) {
    if (uploadedPaths.length) {
      const { error: cleanupError } = await supabase.storage.from(bucket).remove(uploadedPaths);
      if (cleanupError) {
        throw new Error(`${error.message} Uploaded photo cleanup also failed: ${cleanupError.message}`, { cause: error });
      }
    }
    throw error;
  }

  return {
    photos: [...existingPhotos, ...uploadedPhotos],
    uploadedPaths,
  };
}

export async function removeRoommatePostPhotos(paths) {
  if (!paths.length) return;
  const { error } = await supabase.storage.from(bucket).remove(paths);
  if (error) throw error;
}
