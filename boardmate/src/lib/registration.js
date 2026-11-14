export async function checkRegistrationDuplicates(client, email, phone = '') {
  const { data, error } = await client.rpc('check_boardmate_registration_duplicates', {
    p_email: email.trim().toLowerCase(), p_phone: phone.trim(),
  });
  if (error) throw new Error('Account availability could not be checked. Please try again. If this continues, contact the administrator to check registration validation.', { cause: error });
  const result = Array.isArray(data) ? data[0] : data;
  if (!result || typeof result.email_exists !== 'boolean' || typeof result.phone_exists !== 'boolean') throw new Error('Account availability could not be confirmed. Please try again.');
  if (result.email_exists) throw Object.assign(new Error('This email address is already in use. Please use another email.'), { code: 'email_exists' });
  if (result.phone_exists) throw Object.assign(new Error('This phone number is already registered. Please use another number.'), { code: 'phone_exists' });
}

export async function signUpWithDuplicateValidation(client, credentials) {
  const email = credentials.email.trim().toLowerCase();
  const phone = credentials.options?.data?.phone || '';
  await checkRegistrationDuplicates(client, email, phone);
  const result = await client.auth.signUp({ ...credentials, email });
  if (result.error) {
    // Auth may hide a profile unique violation behind a generic 500. Check
    // again after failure so a competing signup gets the correct message.
    if (/database error/i.test(result.error.message || '') || result.error.code === 'unexpected_failure') {
      try { await checkRegistrationDuplicates(client, email, phone); }
      catch (error) { if (['email_exists', 'phone_exists'].includes(error.code)) throw error; }
    }
    throw result.error;
  }
  if (Array.isArray(result.data?.user?.identities) && result.data.user.identities.length === 0 && !result.data.session) {
    throw Object.assign(new Error('Registration could not be started. Try signing in or contact the administrator.'), { code: 'registration_unavailable' });
  }
  if (!result.data?.session) {
    throw new Error('Registration requires a sign-in session to submit your documents. Contact the administrator to check signup configuration before trying again.');
  }
  return result;
}
