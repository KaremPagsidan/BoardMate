export function duplicateRegistrationMessage(error) {
  const text = [error?.message, error?.details, error?.constraint].filter(Boolean).join(' ');
  const duplicate = /already (?:registered|exists|in use)|duplicate key|unique constraint/i.test(text);
  if (error?.code === 'phone_exists' || (duplicate && /phone/i.test(text))) {
    return 'This phone number is already registered. Please use another number.';
  }
  if (error?.code === 'email_exists' || (duplicate && /email/i.test(text))) {
    return 'This email address is already in use. Please use another email.';
  }
  if (error?.code === 'user_already_exists' || /already registered|user already exists/i.test(text)) {
    return 'This email address or phone number is already in use. Please use a different email address or phone number.';
  }
  return null;
}

export function registrationErrorMessage(error) {
  const duplicate = duplicateRegistrationMessage(error);
  if (duplicate) return duplicate + ' You can also sign in or reset your password.';
  const message = error?.message || '';
  if (/database error (saving|creating) (new )?user/i.test(message) || error?.code === 'unexpected_failure') {
    return 'BoardMate could not save your account profile. Please contact the administrator to check the registration database setup. Try signing in before registering again if the outcome is uncertain.';
  }
  if (/failed to fetch|networkerror|network request failed|load failed/i.test(message)) {
    return 'Your registration could not be confirmed because the connection was interrupted. Try signing in before registering again.';
  }
  if (error?.code === 'over_email_send_rate_limit' || error?.status === 429) return 'Too many registration attempts. Please wait a few minutes before trying again.';
  if (error?.code === 'weak_password') return 'Choose a stronger password and try again.';
  if (error?.code === 'signup_disabled') return 'New account registration is temporarily unavailable. Please contact the administrator.';
  if (error?.code === '23514' || error?.code === '22P02' || error?.code === '22007' || error?.code === '23502') return 'Some account details could not be saved. Check the required fields, date of birth, and selected account type.';
  return message || 'Registration could not be completed. Please try again.';
}
