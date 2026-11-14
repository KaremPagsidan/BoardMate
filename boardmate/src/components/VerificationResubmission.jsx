import { useEffect, useRef, useState } from 'react';
import { supabase } from '../supabaseClient';
import { resubmitVerificationDocuments, validateVerificationFile } from '../lib/verification';
import { correctionIdentity, validateCorrections } from '../lib/verificationCorrections';
import { formatVerificationDate } from '../lib/verificationStatus';
import ImageUploadInput from './ImageUploadInput';
import SelfieCamera from './SelfieCamera';
import VerificationFilePreview from './VerificationFilePreview';
import '../verificationStatus.css';

const labels = { full_name: 'Full name', phone: 'Phone number', gender: 'Gender', dob: 'Date of birth', business_name: 'Business name', address: 'Address', gov_id_number: 'Government ID number', property_type: 'Property type' };
export default function VerificationResubmission({ user, onBack, onComplete, embedded = false }) {
  const [profile, setProfile] = useState(null), [identity, setIdentity] = useState(null);
  const [idFile, setIdFile] = useState(null), [selfieFile, setSelfieFile] = useState(null);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [progress, setProgress] = useState('');
  const lock = useRef(false);
  useEffect(() => {
    let active = true;
    (async () => {
      const [result, ready] = await Promise.all([
        supabase.from('profiles').select('id,role,full_name,email,phone,gender,dob,business_name,address,gov_id_number,property_type,verification_status,verification_revision,verification_reason,verified_at,suspended_at').eq('id', user.id).maybeSingle(),
        supabase.rpc('boardmate_verification_resubmission_ready'),
      ]);
      if (result.error) throw result.error;
      if (ready.error || ready.data !== true) throw new Error('Verification corrections are not available yet. Contact the administrator to check the database update.');
      if (!result.data || result.data.verification_status !== 'rejected' || result.data.suspended_at) throw new Error('Only a rejected, non-suspended account can edit and resubmit verification.');
      if (active) { setProfile(result.data); setIdentity(correctionIdentity(result.data)); }
    })().catch(failure => { if (active) setError(failure.message); });
    return () => { active = false; };
  }, [user.id]);
  const choose = (file, kind) => {
    try { validateVerificationFile(file, kind); if (kind === 'selfie') setSelfieFile(file); else setIdFile(file); setError(''); }
    catch (failure) { setError(failure.message); }
  };
  const submit = async event => {
    event.preventDefault(); if (lock.current || !profile) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const corrected = validateCorrections(identity, profile.role);
      if (!idFile || !selfieFile) throw new Error('Select both a replacement government ID and selfie.');
      const saved = await resubmitVerificationDocuments(user.id, { idFile, selfieFile }, corrected, profile.verification_revision || null, setProgress);
      onComplete(saved);
    } catch (failure) { setError(failure.message); }
    finally { lock.current = false; setBusy(false); setProgress(''); }
  };
  const accountChanged = user.verificationStatus !== 'rejected' || Boolean(user.suspendedAt);
  const owner = ['OWNER', 'LANDLORD'].includes(String(profile?.role).toUpperCase());
  const Root = embedded ? 'section' : 'main';
  return <Root className={`verification-status-root${embedded ? ' verification-settings-embedded' : ''}`}><section className="verification-status-card verification-correction-card">
    <p className="verification-status-brand">BoardMate</p><h1>Edit and Resubmit Verification</h1>
    <p>Correct the requested details and upload both replacement documents. Previous submissions and administrator remarks will be preserved.</p>
    {profile && <div className="verification-status-message verification-status-rejected"><strong>Corrections requested</strong><p>{profile.verification_reason || 'Review and correct your personal information and documents.'}</p><p>Reviewed: {formatVerificationDate(profile.verified_at)}</p></div>}
    {error && <p role="alert" className="verification-status-error">{error}</p>}
    {!profile && !error && <p role="status">Checking your rejected verification...</p>}
    {accountChanged && <p role="alert">Your account status changed. Return to Verification Status before making corrections.</p>}
    {profile && identity && !accountChanged && <form onSubmit={submit}><fieldset disabled={busy}>
      <p>Email and account role are protected and cannot be changed here.</p>
      {Object.entries(labels).filter(([key]) => owner || !['business_name', 'address', 'gov_id_number', 'property_type'].includes(key)).map(([key, label]) => <label key={key}>{label}
        {key === 'gender' || key === 'property_type' ? <select required value={identity[key]} onChange={event => setIdentity(current => ({ ...current, [key]: event.target.value }))}>
          <option value="">Select {label.toLowerCase()}</option>{[...new Set([identity[key], ...(key === 'gender' ? ['Male', 'Female', 'Other'] : ['Boarding House', 'Apartment', 'Dormitory', 'Bedspace', 'Other'])])].filter(Boolean).map(value => <option key={value}>{value}</option>)}
        </select> : <input name={key} required type={key === 'dob' ? 'date' : key === 'phone' ? 'tel' : 'text'} maxLength={key === 'full_name' ? 150 : 254} value={identity[key]} onChange={event => setIdentity(current => ({ ...current, [key]: event.target.value }))} />}
      </label>)}
      <label>Replacement Government ID<ImageUploadInput type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={event => { choose(event.target.files?.[0], 'id'); event.target.value = ''; }} /></label>
      <VerificationFilePreview file={idFile} label="Replacement Government ID" disabled={busy} onRemove={() => setIdFile(null)} />
      <label>Replacement selfie<ImageUploadInput type="file" accept="image/jpeg,image/png,image/webp" onChange={event => { choose(event.target.files?.[0], 'selfie'); event.target.value = ''; }} /></label>
      <SelfieCamera captured={selfieFile} onCapture={file => choose(file, 'selfie')} disabled={busy} />
      {busy && <p role="status">{progress || 'Submitting corrections...'}</p>}
      <button className="verification-correction-submit" type="submit">{busy ? 'Submitting...' : 'Submit corrected verification'}</button>
    </fieldset></form>}
    <div className="verification-status-actions"><button type="button" disabled={busy} onClick={onBack}>Return to Verification Status</button></div>
  </section></Root>;
}
