import '../verificationStatus.css';
import VerificationDocumentLink from './VerificationDocumentLink';
import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { loadVerificationHistory } from '../lib/verificationCorrections';
import { formatVerificationDate } from '../lib/verificationStatus';

export default function VerificationHistory({ userId, revision, refreshKey }) {
  const [result, setResult] = useState({ userId: null, rows: [] }), [error, setError] = useState('');
  const rows = result.userId === userId ? result.rows : [];
  useEffect(() => {
    let active = true;
    loadVerificationHistory(supabase, userId).then(rows => { if (active) { setResult({ userId, rows }); setError(''); } }).catch(() => { if (active) setError('Review history is unavailable. The reviewed database update may be required.'); });
    return () => { active = false; };
  }, [userId, revision, refreshKey]);
  return <section className="verification-history" aria-label="Read-only verification history"><h2>Review history</h2>
    {error && <p role="alert">{error}</p>}
    {!error && !rows.length && <p>No versioned history recorded.</p>}
    {rows.map(row => <article key={row.revision} className="verification-history-entry">
      <h3>{row.status === 'pending' ? 'Pending review' : row.status === 'approved' ? 'Approved' : 'Rejected'}</h3>
      <p>Submitted: {formatVerificationDate(row.submitted_at)}</p><p>Reviewed: {formatVerificationDate(row.reviewed_at)}</p>
      <p className="verification-history-remarks">{row.reason || 'No administrator remarks recorded.'}</p>
      <VerificationDocumentLink path={row.id_document_path} label="submitted Government ID" /><VerificationDocumentLink path={row.selfie_document_path} label="submitted selfie" />
      <details><summary>Submitted personal information</summary><dl>{Object.entries(row.profile_snapshot || {}).map(([key, value]) => <div key={key}><dt>{key.replaceAll('_', ' ')}</dt><dd>{value || 'Not recorded'}</dd></div>)}</dl></details>
      {row.previous_review && <aside><h3>Earlier review (legacy)</h3><p>Reviewed: {formatVerificationDate(row.previous_review.reviewed_at)}</p><p>{row.previous_review.reason || 'No remarks recorded.'}</p><VerificationDocumentLink path={row.previous_review.id_document_path} label="legacy Government ID" /><VerificationDocumentLink path={row.previous_review.selfie_document_path} label="legacy selfie" /></aside>}
    </article>)}
  </section>;
}
