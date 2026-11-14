export const recoveryResendSeconds = 60;
export const recoveryRequestMessage = 'If this email is eligible for recovery, a verification code will arrive shortly. Check your inbox and spam folder.';

function failure(message, code) { return Object.assign(new Error(message), { code }); }
export function recoveryErrorMessage(error) {
  if (['invalid_password', 'password_mismatch', 'recovery_session_required', 'cooldown', 'weak_password', 'same_password'].includes(error?.code)) return error.message;
  if (error?.code === 'otp_expired' || error?.code === 'otp_disabled' || error?.status === 403) return 'This code is incorrect or expired. Request a new code and try again.';
  if (error?.status === 429 || ['over_email_send_rate_limit', 'over_request_rate_limit'].includes(error?.code)) return 'Too many requests. Please wait before trying again.';
  return 'Unable to complete recovery. Check your code and connection, then try again.';
}

// Call with a dedicated, nonpersistent Auth client. A normal login session is
// never accepted as proof: only this controller's successful recovery OTP is.
export function createPasswordRecovery(client, now = Date.now) {
  let address = '', proof = null, nextRequest = 0, changed = false;
  const clearProof = () => { proof = null; changed = false; };
  return {
    async request(email) {
      if (now() < nextRequest) throw failure('Please wait before requesting another code.', 'cooldown');
      address = email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw failure('Enter a valid email address.', 'invalid_password');
      clearProof();
      nextRequest = now() + recoveryResendSeconds * 1000;
      const { error } = await client.auth.resetPasswordForEmail(address);
      // Supabase suppresses unknown accounts. Never add a lookup or forward a
      // provider response that could disclose eligibility/account existence.
      if (error?.status === 429) throw error;
      return recoveryRequestMessage;
    },
    async verify(code) {
      clearProof();
      if (!address || !/^\d{6}$/.test(code)) throw failure('Enter the six-digit recovery code.', 'invalid_password');
      const { data, error } = await client.auth.verifyOtp({ email: address, token: code, type: 'recovery' });
      if (error) throw error;
      const session = data?.session, user = data?.user;
      if (!session?.access_token || !session.expires_at || !user?.id || user.email?.toLowerCase() !== address) {
        await client.auth.signOut({ scope: 'local' });
        throw failure('Request a new recovery code before changing your password.', 'recovery_session_required');
      }
      proof = { id: user.id, token: session.access_token, expires: Math.min(session.expires_at * 1000, now() + 10 * 60 * 1000) };
    },
    async reset(password, confirmation) {
      if (!proof || now() >= proof.expires) {
        clearProof(); throw failure('Your recovery session expired. Request a new code.', 'recovery_session_required');
      }
      if (!changed) {
        if (password !== confirmation) throw failure('Passwords do not match.', 'password_mismatch');
        if (password.length < 8 || !password.trim() || new TextEncoder().encode(password).length > 72) throw failure('Use at least 8 characters and no more than 72 UTF-8 bytes.', 'invalid_password');
        const { data: sessionData, error: sessionError } = await client.auth.getSession();
        const { data: userData, error: userError } = await client.auth.getUser();
        if (sessionError || userError || sessionData?.session?.access_token !== proof.token || userData?.user?.id !== proof.id || userData?.user?.email?.toLowerCase() !== address) {
          clearProof(); throw failure('Your recovery session is no longer valid. Request a new code.', 'recovery_session_required');
        }
        const { data, error } = await client.auth.updateUser({ password });
        if (error) throw error;
        if (data?.user?.id !== proof.id) throw failure('Password update could not be confirmed. Request a new code.', 'recovery_session_required');
        changed = true;
      }
      const { error } = await client.auth.signOut({ scope: 'global' });
      if (error) {
        const { error: localError } = await client.auth.signOut({ scope: 'local' });
        if (localError) throw localError;
      }
      clearProof();
      return 'Password updated. Please log in with your new password.';
    },
    async cancel() { clearProof(); const { error } = await client.auth.signOut({ scope: 'local' }); if (error) throw error; },
  };
}
