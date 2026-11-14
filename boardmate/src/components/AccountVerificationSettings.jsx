import { useState } from 'react';
import AccountVerificationStatus from './AccountVerificationStatus';
import VerificationResubmission from './VerificationResubmission';
import AccountReviewScreen from './AccountReviewScreen';
import { canSubmitInitialVerification } from '../lib/verificationStatus';
import { correctedVerificationProfile } from '../lib/verificationSettings';

export default function AccountVerificationSettings({ user, onBack, onLogout, onSubmit, onProfileUpdate, submission = {} }) {
  const [editing, setEditing] = useState(false);
  if (editing) return <VerificationResubmission embedded user={user} onBack={() => setEditing(false)} onComplete={profile => {
    onProfileUpdate(correctedVerificationProfile(user, profile)); setEditing(false);
  }} />;
  if (canSubmitInitialVerification(user)) return <AccountReviewScreen user={user} status="not_submitted" onSubmit={onSubmit}
    onBack={onBack} backLabel="Back to Settings" onLogout={onLogout}
    submitting={submission.submitting} progress={submission.progress} submissionError={submission.error} submissionMessage={submission.message} />;
  return <AccountVerificationStatus embedded user={user} onBack={onBack} backLabel="Back to Settings" onEdit={() => setEditing(true)} />;
}
