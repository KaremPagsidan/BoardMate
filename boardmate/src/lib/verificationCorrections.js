export const correctionFields = ['full_name', 'phone', 'gender', 'dob', 'business_name', 'address', 'gov_id_number', 'property_type'];
export function correctionIdentity(profile) {
  return Object.fromEntries(correctionFields.map(key => [key, profile[key] ?? '']));
}
export function validateCorrections(identity, role) {
  if (!identity.full_name.trim() || identity.full_name.length > 150) throw new Error('Enter your full name (up to 150 characters).');
  if (!/^[+0-9() .-]+$/.test(identity.phone) || !/^\d{7,15}$/.test(identity.phone.replace(/\D/g, ''))) throw new Error('Enter a valid phone number.');
  if (!identity.gender || !/^\d{4}-\d{2}-\d{2}$/.test(identity.dob)) throw new Error('Select your gender and date of birth.');
  const date = new Date(`${identity.dob}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== identity.dob || identity.dob > new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date())) throw new Error('Enter a valid birth date that is not in the future.');
  if (['OWNER', 'LANDLORD'].includes(String(role).toUpperCase()) && ['business_name', 'address', 'gov_id_number', 'property_type'].some(key => !identity[key].trim())) throw new Error('Complete the owner identity and business details.');
  return Object.fromEntries(correctionFields.map(key => [key, identity[key].trim() || null]));
}
export async function loadVerificationHistory(client, userId) {
  const rows = new Map();
  for (let offset = 0; ; offset += 50) {
    const { data, error } = await client.from('boardmate_verification_submissions')
      .select('revision, user_id, status, submitted_at, reviewed_at, reason, profile_snapshot, previous_review, id_document_path, selfie_document_path')
      .eq('user_id', userId).order('submitted_at', { ascending: false }).order('revision', { ascending: false }).range(offset, offset + 49);
    if (error) throw error;
    if ((data || []).some(row => row.user_id !== userId)) throw new Error('Review history ownership could not be confirmed.');
    for (const row of data || []) rows.set(row.revision, row);
    if (!data || data.length < 50) return [...rows.values()];
  }
}
