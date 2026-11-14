import { useState } from 'react';
import { supabase } from '../supabaseClient';

export default function VerificationDocumentLink({ path, label }) {
  const [url, setUrl] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  if (!path) return <p>{label}: not recorded</p>;
  const prepare = async () => {
    if (busy) return;
    setBusy(true); setError(''); setUrl('');
    try {
      const result = await supabase.storage.from('verification-documents').createSignedUrl(path, 300);
      if (result.error || !result.data?.signedUrl) throw new Error('Document unavailable');
      setUrl(result.data.signedUrl);
    } catch { setError('The private document could not be opened. Contact the administrator if this is a legacy file.'); }
    finally { setBusy(false); }
  };
  return <div><button type="button" disabled={busy} onClick={prepare}>{busy ? 'Preparing private preview...' : `View ${label}`}</button>
    {url && <p><a href={url} target="_blank" rel="noopener noreferrer">Open {label} (private link, valid for 5 minutes)</a></p>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
