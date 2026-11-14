import { supabase } from '../supabaseClient';
import { uploadedMediaLocation, notifyPhotoAccess } from './profilePhotoAccess';

export async function setProfilePhotoVisibility(photo, isPublic) {
  const location = uploadedMediaLocation(photo.url);
  if (!location) throw new Error('This is not an uploaded photo.');
  const { error } = await supabase.rpc(location.bucket === 'profile-photos' ? 'set_boardmate_photo_visibility' : 'set_boardmate_uploaded_photo_visibility',
    location.bucket === 'profile-photos' ? { p_id: photo.photoId, p_public: isPublic } : { p_bucket: location.bucket, p_path: location.path, p_public: isPublic });
  if (error) throw error;
  notifyPhotoAccess();
}
export async function deleteProfilePhoto(photo) {
  const location = uploadedMediaLocation(photo.url);
  if (!location) throw new Error('This is not an uploaded photo.');
  const { error: removalError } = await supabase.storage.from(location.bucket).remove([location.path]);
  if (removalError) throw removalError;
  const { error } = await supabase.rpc(location.bucket === 'profile-photos' ? 'delete_boardmate_profile_photo' : 'delete_boardmate_uploaded_photo',
    location.bucket === 'profile-photos' ? { p_id: photo.photoId } : { p_bucket: location.bucket, p_path: location.path });
  notifyPhotoAccess();
  if (error) throw new Error(`The file was removed, but gallery cleanup failed. Retry deletion. ${error.message}`);
}

export async function uploadProfilePhoto(userId, file, { syncRoommatePosts = false } = {}) {
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError) throw new Error(`Could not verify your signed-in account: ${authError.message}`);
  if (!user || user.id !== userId) {
    throw new Error('Your signed-in account does not match this profile. Please sign in again and retry.');
  }

  const extension = file.name.split('.').pop() || 'jpg';
  const path = `${user.id}/${Date.now()}.${extension}`;
  const { error: uploadError } = await supabase.storage
    .from('profile-photos')
    .upload(path, file, { contentType: file.type });

  if (uploadError) {
    if (uploadError.message.toLowerCase().includes('bucket not found')) {
      throw new Error('The profile-photos storage bucket is missing. Run the latest Supabase migrations, then try again.');
    }
    throw new Error(`Photo upload was blocked by Supabase Storage: ${uploadError.message}`);
  }

  const { data } = supabase.storage.from('profile-photos').getPublicUrl(path);
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .update({ avatar_url: data.publicUrl })
    .eq('id', userId)
    .select('id')
    .maybeSingle();

  if (profileError) {
    throw new Error(`Photo uploaded, but saving it to your profile was blocked: ${profileError.message}`);
  }
  if (!profile) throw new Error('Your profile was not updated. Please sign in again and retry.');

  const { error: galleryError } = await supabase.from('profile_photo_gallery').insert({
    user_id: user.id,
    photo_url: data.publicUrl,
  });

  if (galleryError) {
    throw new Error(`Photo updated, but it could not be saved to your Photos gallery: ${galleryError.message}`);
  }

  if (syncRoommatePosts) {
    const { error: postsError } = await supabase
      .from('roommate_posts')
      .update({ author_avatar_url: data.publicUrl })
      .eq('user_id', userId);

    if (postsError) {
      throw new Error(`Photo updated, but syncing it to your roommate posts was blocked: ${postsError.message}`);
    }
  }

  return data.publicUrl;
}

export async function fetchProfilePhotoGallery(userId) {
  const { data, error } = await supabase
    .from('profile_photo_gallery')
    .select('id, photo_url, created_at, is_public')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data;
}

export async function updateAccountProfile(userId, profile) {
  const { data, error } = await supabase
    .from('profiles')
    .update({
      full_name: profile.fullName,
      phone: profile.phone,
      dob: profile.dob || null,
      gender: profile.gender || null,
      business_name: profile.businessName || null,
      address: profile.address || null,
      gov_id_number: profile.govIdNumber || null,
      property_type: profile.propertyType || null,
    })
    .eq('id', userId)
    .select('verification_status, verification_reason, verification_revision')
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error('Your profile was not updated. Please sign in again and retry.');
  return {
    verificationStatus: data.verification_status,
    verificationRevision: data.verification_revision || null,
    verificationReason: data.verification_reason || '',
  };
}

export function getAge(dateOfBirth) {
  if (!dateOfBirth) return null;

  const birthDate = new Date(dateOfBirth);
  if (Number.isNaN(birthDate.getTime())) return null;

  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const birthdayHasPassed =
    today.getMonth() > birthDate.getMonth() ||
    (today.getMonth() === birthDate.getMonth() && today.getDate() >= birthDate.getDate());

  if (!birthdayHasPassed) age -= 1;
  return age;
}
