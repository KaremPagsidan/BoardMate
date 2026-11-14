import { canSubmitInitialVerification } from '../lib/verificationStatus';
import ImageUploadInput from './ImageUploadInput';
import { useState } from 'react';
import ErrorDialog from './ErrorDialog';
import VerificationFilePreview from './VerificationFilePreview';
import SelfieCamera from './SelfieCamera';

export default function AccountReviewScreen({
  user,
  status,
  onSubmit,
  onBack,
  backLabel = 'Return to dashboard',
  onLogout,
  submitting,
  progress,
  submissionError,
  submissionMessage,
  initialIdFile = null,
  initialSelfieFile = null,
}) {
  const [idFile, setIdFile] = useState(initialIdFile);
  const [selfieFile, setSelfieFile] = useState(initialSelfieFile);
  const [error, setError] = useState('');
  const initialSubmission = canSubmitInitialVerification(user, status);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (submitting || !initialSubmission) return;
    setError('');
    if (!idFile && !user.idUploaded) {
      setError('Please select a clear photo or PDF of your government ID.');
      return;
    }
    if (!selfieFile && !user.selfieUploaded) {
      setError('Please select a clear selfie.');
      return;
    }

    try {
      await onSubmit({ idFile, selfieFile });
      setIdFile(null);
      setSelfieFile(null);
    } catch (submitError) {
      setError(submitError.message);
    }
  };

  if (!initialSubmission) return <section className="p-5"><p>Open Settings &amp; Privacy → Account Verification to view your account details.</p><button type="button" onClick={onBack}>{backLabel}</button></section>;

  return (
    <div className="flex min-h-0 w-full flex-1 items-center justify-center overflow-y-auto bg-[#F7F4EB] p-5">
      <section className="w-full max-w-md rounded-3xl bg-white p-6 shadow-xl">
        <div className="mb-5 flex items-center gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-emerald-100 text-2xl text-emerald-800">⌛</span>
          <div>
            <h1 className="text-lg font-extrabold text-gray-900">Account verification</h1>
            <p className="text-xs text-gray-500">{user.fullName || user.email}</p>
          </div>
        </div>

        <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
          Your account exists, but verification has not been submitted. Submit both your government ID and selfie to request administrator review. You can use your dashboard while completing this step.
        </p>
        <p className="mb-4 text-xs leading-5 text-gray-600">
          Documents are uploaded to private storage accessible to your account and authorized administrators. After submission, you can view the review status. Submission does not mean approval.
        </p>

        {submissionError && <p role="alert" className="mb-4 rounded-xl bg-red-50 p-3 text-xs text-red-800">{submissionError}</p>}
        {submissionMessage && <p role="status" className="mb-4 rounded-xl bg-emerald-50 p-3 text-xs text-emerald-800">{submissionMessage}</p>}
        {submitting && <p role="status" className="mb-4 text-xs font-bold text-emerald-800"><i className="fa-solid fa-spinner fa-spin mr-2" aria-hidden="true" />{progress || 'Submitting verification documents...'}</p>}

        <form className="space-y-4" onSubmit={handleSubmit} aria-busy={submitting}>
          <label className="block rounded-xl border border-gray-200 p-3 text-xs">
            <span className="mb-2 block font-bold text-gray-800">Government ID (required)</span>
            <ImageUploadInput type="file" disabled={submitting} accept="image/jpeg,image/png,image/webp,application/pdf" onChange={event => { const file = event.target.files?.[0]; if (file) setIdFile(file); event.target.value = ''; }} />
          </label>
          <VerificationFilePreview file={idFile} label="Government ID" onRemove={() => setIdFile(null)} disabled={submitting} />

          <label className="block rounded-xl border border-gray-200 p-3 text-xs">
            <span className="mb-2 block font-bold text-gray-800">Selfie (required)</span>
            <ImageUploadInput type="file" disabled={submitting} accept="image/jpeg,image/png,image/webp" onChange={event => { const file = event.target.files?.[0]; if (file) setSelfieFile(file); event.target.value = ''; }} />
          </label>
          <SelfieCamera captured={selfieFile} onCapture={setSelfieFile} disabled={submitting} />

          <button type="submit" disabled={submitting} className="w-full rounded-xl bg-[#315D3D] py-3 text-sm font-bold text-white disabled:opacity-60">
            {submitting ? 'Submitting securely...' : 'Submit verification documents'}
          </button>
        </form>

        <button type="button" disabled={submitting} onClick={onBack} className="mt-4 w-full rounded-xl bg-gray-100 py-2.5 text-xs font-bold text-gray-700 disabled:opacity-50">
          {backLabel}
        </button>
        <button type="button" disabled={submitting} onClick={onLogout} className="mt-2 w-full rounded-xl bg-gray-100 py-2.5 text-xs font-bold text-gray-700 disabled:opacity-50">
          Sign out
        </button>
      </section>
      <ErrorDialog message={error} onClose={() => setError('')} />
    </div>
  );
}
