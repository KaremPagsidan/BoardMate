export function canSubmitInitialVerification(user, status = user?.verificationStatus ?? user?.verification_status) {
  return status === 'not_submitted' && !(
    user?.verificationRevision || user?.verification_revision || user?.idDocumentPath || user?.id_document_path
    || user?.selfieDocumentPath || user?.selfie_document_path || user?.idUploaded || user?.id_uploaded
    || user?.selfieUploaded || user?.selfie_uploaded
  );
}
export const verificationMessages = {
  pending: 'Your account verification is under administrator review. Please wait for approval.',
  approved: 'Your account has been successfully verified and approved.',
  rejected: 'Your account verification was rejected. Please read the administrator feedback below.',
  not_submitted: 'Your verification submission has not been recorded. Contact the administrator if you have already submitted your documents.',
};
export function formatVerificationDate(value) {
  if (!value || !Number.isFinite(new Date(value).getTime())) return 'Not recorded';
  return new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value));
}

// SELECT only. Dates belong to the current submission revision, never account creation.
export async function loadVerificationStatus(client, userId) {
  const { data: profile, error } = await client.from('profiles')
    .select('id, verification_status, verification_revision, verification_reason, verified_at, suspended_at, suspension_reason')
    .eq('id', userId).maybeSingle();
  if (error) throw error;
  if (!profile || profile.id !== userId) throw new Error('Verification details could not be found.');
  let submission = null;
  if (profile.verification_revision) {
    const result = await client.from('boardmate_verification_submissions')
      .select('revision, user_id, status, submitted_at, reviewed_at, reason')
      .eq('user_id', userId).eq('revision', profile.verification_revision).maybeSingle();
    if (result.error) throw result.error;
    submission = result.data;
    if (submission && (submission.user_id !== userId || submission.revision !== profile.verification_revision)) throw new Error('Verification revision could not be confirmed.');
  }
  return {
    status: submission?.status ?? profile.verification_status,
    submittedAt: submission?.submitted_at || null,
    reviewedAt: submission?.reviewed_at || profile.verified_at || null,
    reason: submission?.reason ?? profile.verification_reason ?? '',
    suspendedAt: profile.suspended_at,
    suspensionReason: profile.suspension_reason || '',
  };
}
