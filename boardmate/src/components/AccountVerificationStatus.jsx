import VerificationHistory from './VerificationHistory';
import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { formatVerificationDate, loadVerificationStatus, verificationMessages } from '../lib/verificationStatus';
import '../verificationStatus.css';

export default function AccountVerificationStatus({ user, onBack, onEdit, submitting = false, embedded = false, backLabel = 'Return to Dashboard' }) {
  const [details, setDetails] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true, sequence = 0;
    const read = async () => {
      const request = ++sequence;
      setLoading(true); setError('');
      try {
        const result = await loadVerificationStatus(supabase, user.id);
        if (active && request === sequence) setDetails(result);
      } catch { if (active && request === sequence) setError('Verification details could not be refreshed. Please try again.'); }
      finally { if (active && request === sequence) setLoading(false); }
    };
    read();
    const onFocus = () => { if (!document.hidden) read(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => { active = false; window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onFocus); };
  }, [user.id, user.verificationRevision, user.verificationStatus, user.verificationReason, refresh]);
  const status = details?.status || user.verificationStatus;
  const labels = { pending: 'Pending', approved: 'Approved', rejected: 'Rejected', not_submitted: 'Not submitted' };
  const reason = details?.reason ?? user.verificationReason;
  const suspended = details?.suspendedAt ?? user.suspendedAt;
  const Root = embedded ? 'section' : 'main';
  return <Root className={`verification-status-root${embedded ? ' verification-settings-embedded' : ''}`}  aria-labelledby="verification-status-title">
    <section className="verification-status-card">
      <p className="verification-status-brand">BoardMate</p>
      <h1 id="verification-status-title">Account Verification Status</h1>
      <p className="verification-status-identity">{user.fullName || user.email}</p>
      <div className={`verification-status-message verification-status-${status}`} role="status">
        <strong>{labels[status] || 'Status unavailable'}</strong>
        <p>{verificationMessages[status] || 'Please refresh to check your account verification status.'}</p>
      </div>
      {loading && <p role="status">Loading current verification details...</p>}
      {error && <p role="alert" className="verification-status-error">{error}</p>}
      <dl className="verification-status-details">
        <div><dt>Date of verification submission</dt><dd>{details ? formatVerificationDate(details.submittedAt) : loading ? 'Loading...' : 'Unavailable'}</dd></div>
        <div><dt>Administrator review date</dt><dd>{!details ? loading ? 'Loading...' : 'Unavailable' : details.reviewedAt ? formatVerificationDate(details.reviewedAt) : status === 'pending' ? 'Awaiting review' : 'Not recorded'}</dd></div>
        <div><dt>Administrator remarks</dt><dd>{reason || 'No remarks recorded.'}</dd></div>
      </dl>
      {status === 'rejected' && <p className="verification-status-guidance">Read the requested corrections, then choose Edit and Resubmit Verification to open the secure correction form. Your original submission and administrator feedback remain in review history.</p>}
      <p className="verification-status-guidance">{suspended
        ? `Your account is suspended. Contact the administrator for assistance.${details?.suspensionReason ? ` ${details.suspensionReason}` : ''}`
        : status === 'approved'
          ? 'You can access verified-member features. Listings and roommate posts still require their own administrator approval.'
          : 'You can use your dashboard. Creating listings or roommate posts and other verified-member actions remain restricted until approval.'}</p>
      <p className="verification-status-meta">Dates are shown in Philippine time (Asia/Manila). Missing historical dates are shown as not recorded.</p>
      <VerificationHistory userId={user.id} revision={user.verificationRevision} refreshKey={`${status}:${refresh}`} />
      <div className="verification-status-actions">
        {status === 'rejected' && !suspended && onEdit && <button type="button" className="verification-status-primary" disabled={loading || submitting || Boolean(error)} onClick={onEdit}>Edit and Resubmit Verification</button>}
        <button type="button" disabled={loading || submitting} onClick={() => setRefresh(value => value + 1)}>Refresh status</button>
        <button type="button" className="verification-status-primary" disabled={submitting} onClick={onBack}>{backLabel}</button>
      </div>
    </section>
  </Root>;
}
