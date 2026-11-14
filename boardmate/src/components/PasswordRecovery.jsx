import { useEffect, useRef, useState } from 'react';
import { supabase, createRecoveryClient } from '../supabaseClient';
import { createPasswordRecovery, recoveryErrorMessage, recoveryResendSeconds } from '../lib/passwordRecovery';
import '../passwordRecovery.css';

const titles = { email: 'Forgot password?', otp: 'Check your email', reset: 'Create a new password' };

export default function PasswordRecovery({ initialEmail = '', onBack, onComplete }) {
  const [step, setStep] = useState('email');
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [recovery] = useState(() => createPasswordRecovery(createRecoveryClient()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const heading = useRef(null);
  const inFlight = useRef(false);
  const wait = Math.max(0, Math.ceil((resendAt - now) / 1000));

  useEffect(() => () => { recovery.cancel().catch(() => {}); }, [recovery]);

  useEffect(() => { heading.current?.focus(); }, [step]);
  useEffect(() => {
    if (!resendAt) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [resendAt]);

  async function act(action) {
    if (inFlight.current || (action === 'request' && Date.now() < resendAt)) return;
    inFlight.current = true;
    setBusy(true); setError(''); setNotice('');
    try {
      if (action === 'request') {
        setNow(Date.now()); setResendAt(Date.now() + recoveryResendSeconds * 1000);
        const message = await recovery.request(email);
        setEmail(email.trim().toLowerCase()); setCode(''); setNotice(message); setStep('otp');
      } else if (action === 'verify') {
        await recovery.verify(code);
        setCode(''); setStep('reset'); setNotice('Code verified. You can now create a new password.');
      } else {
        const message = await recovery.reset(password, confirmation);
        const { error: logoutError } = await supabase.auth.signOut({ scope: 'local' });
        if (logoutError) throw logoutError;
        setPassword(''); setConfirmation(''); setCode('');
        onComplete(message);
      }
    } catch (failure) {
      setError(recoveryErrorMessage(failure));
      if (failure.code === 'recovery_session_required') { setStep('email'); setPassword(''); setConfirmation(''); }
    } finally { inFlight.current = false; setBusy(false); }
  }

  async function leave(callback) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true);
    try { await recovery.cancel(); callback(); }
    catch { setError('Unable to clear the recovery session. Please try again.'); }
    finally { inFlight.current = false; setBusy(false); }
  }

  return <main className="boardmate-recovery">
    <section className="boardmate-recovery-card" aria-labelledby="recovery-title">
      <p className="boardmate-recovery-brand">BoardMate</p>
      <p className="boardmate-recovery-progress">{step === 'email' ? 'Step 1 of 3' : step === 'otp' ? 'Step 2 of 3' : 'Step 3 of 3'}</p>
      <h1 id="recovery-title" tabIndex={-1} ref={heading}>{titles[step]}</h1>
      <p>{step === 'email' ? 'Enter your registered email to recover your account.' : step === 'otp'
        ? `Enter the 6-digit recovery code for ${email}. Use the latest code. Expired codes must be resent.`
        : 'Choose a password with at least 8 characters (up to 72 UTF-8 bytes). Complete this step within 10 minutes.'}</p>
      {notice && <p className="boardmate-recovery-notice" role="status">{notice}</p>}
      {error && <p className="boardmate-recovery-error" role="alert">{error}</p>}
      <form onSubmit={event => { event.preventDefault(); act(step === 'email' ? 'request' : step === 'otp' ? 'verify' : 'reset'); }}>
        <fieldset disabled={busy}>
          {step === 'email' && <label htmlFor="recovery-email">Email address
            <input id="recovery-email" type="email" autoComplete="email" maxLength={254} required value={email} onChange={event => setEmail(event.target.value)} />
          </label>}
          {step === 'otp' && <label htmlFor="recovery-code">Verification code
            <input id="recovery-code" className="boardmate-recovery-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={event => setCode(event.target.value.replace(/[^0-9]/g, ''))} />
          </label>}
          {step === 'reset' && <>
            <label htmlFor="recovery-password">New password
              <input id="recovery-password" type="password" autoComplete="new-password" minLength={8} required value={password} onChange={event => setPassword(event.target.value)} />
            </label>
            <label htmlFor="recovery-confirm">Confirm new password
              <input id="recovery-confirm" type="password" autoComplete="new-password" minLength={8} required value={confirmation} onChange={event => setConfirmation(event.target.value)} />
            </label>
          </>}
          <button disabled={busy || (step === 'email' && wait > 0)} className="boardmate-recovery-primary" type="submit">{busy ? 'Please wait...' : step === 'email' ? (wait > 0 ? `Send code in ${wait}s` : 'Send verification code') : step === 'otp' ? 'Verify code' : 'Reset password'}</button>
        </fieldset>
      </form>
      {step === 'otp' && <div className="boardmate-recovery-actions">
        <button disabled={busy || wait > 0} onClick={() => act('request')}>{wait ? `Resend code in ${wait}s` : 'Resend code'}</button>
        <button disabled={busy} onClick={() => leave(() => { setStep('email'); setCode(''); setError(''); setNotice(''); })}>Use another email</button>
      </div>}
      {step === 'reset' && <button className="boardmate-recovery-back" disabled={busy} onClick={() => leave(() => { setStep('email'); setPassword(''); setConfirmation(''); setError(''); })}>Request a new code</button>}
      <button className="boardmate-recovery-back" disabled={busy} onClick={() => leave(onBack)}>Back to login</button>
    </section>
  </main>;
}
