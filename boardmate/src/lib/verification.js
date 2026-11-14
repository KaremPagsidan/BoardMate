import { canSubmitInitialVerification } from './verificationStatus.js';
import { supabase } from '../supabaseClient';

const bucket = 'verification-documents';
const profileColumns = 'id, verification_status, verification_revision, verification_reason, id_uploaded, selfie_uploaded, id_document_path, selfie_document_path, role, suspended_at';
const imageTypes = ['image/jpeg', 'image/png', 'image/webp'];

export function validateVerificationFile(file, kind) {
  if (!file) return;
  const types = kind === 'selfie' ? imageTypes : [...imageTypes, 'application/pdf'];
  if (!types.includes(file.type)) {
    throw new Error(kind === 'selfie' ? 'Choose a JPG, PNG, or WebP selfie.' : 'Choose a JPG, PNG, WebP, or PDF government ID.');
  }
  if (!file.size || file.size > 10 * 1024 * 1024) throw new Error('Each verification file must be nonempty and 10 MB or smaller.');
}

// Legacy statuses are intentionally preserved; document readiness is separate.
export function getVerificationStatus(profile) {
  return profile?.verification_status || 'not_submitted';
}

export function verificationProfileUpdate(profile) {
  return {
    verificationStatus: getVerificationStatus(profile),
    verificationRevision: profile.verification_revision || null,
    verificationReason: profile.verification_reason || '',
    idUploaded: Boolean(profile.id_document_path),
    selfieUploaded: Boolean(profile.selfie_document_path),
    idDocumentPath: profile.id_document_path || null,
    selfieDocumentPath: profile.selfie_document_path || null,
  };
}

export function submitVerificationDocuments(userId, files, onProgress = () => {}) {
  return persistVerificationDocuments(userId, files, onProgress, false);
}

export function submitInitialVerificationDocuments(userId, files, onProgress = () => {}) {
  return persistVerificationDocuments(userId, files, onProgress, true);
}

export function resubmitVerificationDocuments(userId, files, identity, expectedRevision, onProgress = () => {}) {
  return persistVerificationDocuments(userId, files, onProgress, false, { identity, expectedRevision });
}

async function persistVerificationDocuments(userId, { idFile, selfieFile }, onProgress, initialOnly, correction = null) {
  validateVerificationFile(idFile, 'id');
  validateVerificationFile(selfieFile, 'selfie');
  onProgress('Checking your account and private storage...');
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  if (!authData.user || authData.user.id !== userId) throw new Error('Sign in to this account before submitting verification documents.');

  const readProfile = () => supabase.from('profiles').select(profileColumns).eq('id', userId).maybeSingle();
  const [profileResult, storageResult] = await Promise.all([
    readProfile(),
    supabase.rpc('is_boardmate_verification_storage_private'),
  ]);
  if (profileResult.error) throw profileResult.error;
  const original = profileResult.data;
  if (!original) throw new Error('Your account profile could not be found. Sign in again before retrying.');
  if (correction) {
    if (original.verification_status !== 'rejected' || original.suspended_at) throw new Error('Only a rejected, non-suspended account can resubmit verification.');
    if ((original.verification_revision || null) !== correction.expectedRevision) throw new Error('Verification changed. Refresh before correcting it.');
    if (!idFile || !selfieFile) throw new Error('Select both a replacement government ID and selfie.');
    const ready = await supabase.rpc('boardmate_verification_resubmission_ready');
    if (ready.error || ready.data !== true) throw new Error('Verification corrections are not available yet. Contact the administrator to check the database update. No replacement documents were uploaded.');
  }
  if (initialOnly && !canSubmitInitialVerification(original)) throw new Error('Verification documents have already been submitted. Open Settings & Privacy → Account Verification. Further submissions require the authorized correction workflow.');
  if (storageResult.error || storageResult.data !== true) {
    throw new Error('Verification uploads are unavailable because private storage could not be confirmed. Your documents have not been uploaded. Contact the administrator to check the verification setup.');
  }
  if ((!idFile && !original.id_document_path) || (!selfieFile && !original.selfie_document_path)) {
    throw new Error('Select both a government ID and a selfie before submitting.');
  }
  if (!idFile && !selfieFile) throw new Error('Select an updated ID or selfie before resubmitting.');

  const uploadedPaths = [];
  let paths;
  let persistenceAttempted = false;
  const submissionConfirmed = profile => profile?.id_document_path === paths.id_document_path
    && profile?.selfie_document_path === paths.selfie_document_path
    && ['pending', 'approved', 'rejected'].includes(profile?.verification_status)
    && Boolean(profile.verification_revision) && profile.verification_revision !== original.verification_revision;

  try {
    const upload = async (kind, file, existingPath) => {
      if (!file) return existingPath;
      onProgress(kind === 'selfie' ? 'Uploading your selfie securely...' : 'Uploading your government ID securely...');
      const extensions = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };
      const path = `${userId}/${kind}-${crypto.randomUUID()}.${extensions[file.type]}`;
      const { error } = await supabase.storage.from(bucket).upload(path, file, { contentType: file.type, upsert: false });
      if (error) throw error;
      uploadedPaths.push(path);
      return path;
    };
    const idPath = await upload('government-id', idFile, original.id_document_path);
    const selfiePath = await upload('selfie', selfieFile, original.selfie_document_path);
    paths = { id_document_path: idPath, selfie_document_path: selfiePath };
    onProgress('Submitting your documents for review...');
    persistenceAttempted = true;
    const { data: saved, error } = await supabase.rpc(correction ? 'resubmit_boardmate_verification' : 'submit_boardmate_verification', {
      p_id_path: idPath,
      p_selfie_path: selfiePath,
      p_expected_revision: original.verification_revision || null,
      ...(correction ? { p_identity: correction.identity } : {}),
    });
    const data = Array.isArray(saved) ? saved[0] : saved;
    if (error) throw error;
    if (!submissionConfirmed(data)) throw new Error('The document submission could not be confirmed.');
    return data;
  } catch (error) {
    let cleanupPaths = uploadedPaths;
    if (persistenceAttempted) {
      // A lost response can follow a successful commit. Never delete documents
      // that may already be referenced by the profile.
      let confirmed;
      try { confirmed = await readProfile(); } catch { /* Retain files if the outcome cannot be checked. */ }
      if (!confirmed || confirmed.error || !confirmed.data) {
        throw new Error('Your account exists, but the document submission could not be confirmed. Reopen verification when your connection returns. Uploaded files were retained so a successful submission is not damaged.', { cause: error });
      }
      if (submissionConfirmed(confirmed.data)) return confirmed.data;
      const referenced = [confirmed.data.id_document_path, confirmed.data.selfie_document_path];
      cleanupPaths = uploadedPaths.filter(path => !referenced.includes(path));
    }
    if (cleanupPaths.length) {
      let cleanupError;
      try { ({ error: cleanupError } = await supabase.storage.from(bucket).remove(cleanupPaths)); }
      catch (failure) { cleanupError = failure; }
      if (cleanupError) throw new Error(`Verification was not confirmed: ${error.message} Temporary uploads could not be removed; contact support before retrying.`, { cause: error });
    }
    throw error;
  }
}

export async function reviewVerificationSubmission(profile, status, reason = '') {
  if (!profile.verification_revision) throw new Error('This legacy account needs a new document submission before a versioned review. Its existing status is unchanged.');
  const { data, error } = await supabase.rpc('review_boardmate_verification', {
    p_user_id: profile.id,
    p_revision: profile.verification_revision,
    p_status: status,
    p_reason: reason.trim() || null,
  });
  if (error) throw error;
  const reviewed = Array.isArray(data) ? data[0] : data;
  if (!reviewed || reviewed.verification_revision !== profile.verification_revision || reviewed.verification_status !== status) {
    throw new Error('The verification decision could not be confirmed. Refresh before reviewing again.');
  }
  return reviewed;
}
