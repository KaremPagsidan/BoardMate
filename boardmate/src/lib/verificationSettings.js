export const accountVerificationPath = 'Settings & Privacy → Account Verification';
export const restrictedVerificationMessage = `This action requires account approval. Open ${accountVerificationPath}.`;
export function isVerificationNotification(notification) {
  if (['profile', 'account_verification'].includes(notification.target_type)) return true;
  return !notification.target_type && ['Your account has been approved', 'Your account verification needs attention', 'Verification corrections requested'].includes(notification.title);
}
export function correctedVerificationProfile(current, profile) {
  if (current?.id !== profile.id) return current;
  return { ...current, fullName: profile.full_name, phone: profile.phone, gender: profile.gender, dob: profile.dob,
    businessName: profile.business_name, address: profile.address, govIdNumber: profile.gov_id_number, propertyType: profile.property_type,
    verificationStatus: profile.verification_status, verificationRevision: profile.verification_revision || null,
    verificationReason: profile.verification_reason || '', idUploaded: Boolean(profile.id_document_path), selfieUploaded: Boolean(profile.selfie_document_path),
    idDocumentPath: profile.id_document_path || null, selfieDocumentPath: profile.selfie_document_path || null };
}

export function isVerificationAccessError(error, status) {
  return status !== 'approved' && (error?.code === '42501' || /row.level security|approved|verified|verification/i.test(error?.message || ''));
}
