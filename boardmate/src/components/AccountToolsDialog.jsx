import { useEffect, useRef, useState } from 'react';
import { supabase } from '../supabaseClient';
import { fetchBlockedDirectContacts } from '../lib/directMessages';
import AccountVerificationSettings from './AccountVerificationSettings';
import ErrorDialog from './ErrorDialog';
import PortalPage from './PortalPage';
import {
  defaultAccountPreferences,
  cancelAccountDeletion,
  fetchAccountPreferences,
  fetchDeletionRequest,
  fetchMyReports,
  saveAccountPreferences,
  submitAccountDeletionRequest,
  submitProblemReport,
} from '../lib/accountTools';

const reportCategories = [
  ['technical', 'Technical issue'],
  ['account', 'Account problem'],
  ['safety', 'Safety concern'],
  ['suggestion', 'Suggestion'],
  ['other', 'Other'],
];

export default function AccountToolsDialog({ userId, userProfile, onProfileUpdate, onVerificationSubmit, verificationSubmission, onClose, onError, onLogout, onUnblockContact, searchFilters, onSearchFiltersChange, initialSection = 'settings' }) {
  const [section, setSection] = useState(initialSection === 'phone' ? 'settings' : initialSection);
  const [preferences, setPreferences] = useState(defaultAccountPreferences);
  const [reports, setReports] = useState([]);
  const [deletionRequest, setDeletionRequest] = useState(null);
  const [blockedContacts, setBlockedContacts] = useState([]);
  const [unblockingUserId, setUnblockingUserId] = useState(null);
  const [category, setCategory] = useState('other');
  const [details, setDetails] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [deletionConfirmationOpen, setDeletionConfirmationOpen] = useState(false);
  const [status, setStatus] = useState('');
  const [dialogError, setDialogError] = useState('');
  const [problemReportsUnavailable, setProblemReportsUnavailable] = useState(false);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    let active = true;
    Promise.all([
      fetchAccountPreferences(userId),
      fetchDeletionRequest(userId),
      fetchBlockedDirectContacts(),
    ]).then(async ([nextPreferences, nextDeletionRequest, nextBlockedContacts]) => {
      if (!active) return;
      setProblemReportsUnavailable(false);
      setDialogError('');
      setPreferences(nextPreferences);
      setDeletionRequest(nextDeletionRequest);
      setBlockedContacts(nextBlockedContacts);
      onSearchFiltersChange({
        location: nextPreferences.search_location,
        propertyType: nextPreferences.search_property_type,
        maxPrice: nextPreferences.search_max_price,
      });
      try {
        setReports(await fetchMyReports(userId));
      } catch (error) {
        if (!active) return;
        const missingTable = error.code === '42P01'
          || error.message?.includes('schema cache')
          || error.message?.includes('boardmate_problem_reports');
        if (missingTable) {
          setProblemReportsUnavailable(true);
          setDialogError('Problem reports are unavailable because the boardmate_problem_reports table is missing from this Supabase project. Apply the latest account-tools migration to enable reports.');
        } else {
          setDialogError(`Unable to load problem reports: ${error.message}`);
        }
      }
    }).catch(error => {
      if (active) onErrorRef.current(`Unable to load account settings: ${error.message}`);
    });
    return () => { active = false; };
  }, [userId, onSearchFiltersChange]);

  const updatePreference = (key, value) => setPreferences(current => ({ ...current, [key]: value }));

  const unblockContact = async contact => {
    if (!onUnblockContact || unblockingUserId) return;
    setUnblockingUserId(contact.userId);
    setStatus('');
    setDialogError('');
    try {
      const succeeded = await onUnblockContact(contact);
      if (succeeded === false) {
        setDialogError('Unable to unblock this account. Please try again.');
        return;
      }
      if (typeof succeeded === 'string') {
        setDialogError(`Unable to unblock account: ${succeeded}`);
        return;
      }
      setBlockedContacts(current => current.filter(item => item.userId !== contact.userId));
      setStatus(`${contact.name} has been unblocked.`);
    } catch (error) {
      setDialogError(`Unable to unblock account: ${error.message}`);
      onError(`Unable to unblock account: ${error.message}`);
    } finally {
      setUnblockingUserId(null);
    }
  };

  const saveSettings = async (event) => {
    event.preventDefault();
    setSaving(true);
    setStatus('');
    setDialogError('');
    try {
      await saveAccountPreferences(userId, {
        ...preferences,
        search_location: searchFilters.location,
        search_property_type: searchFilters.propertyType,
        search_max_price: searchFilters.maxPrice,
      });
      const { error: presenceError } = await supabase.rpc('publish_boardmate_presence');
      if (presenceError) throw presenceError;
      setStatus('Settings saved.');
      if (!preferences.is_active) {
        setStatus('Account deactivated. You will be signed out now.');
        window.setTimeout(onLogout, 700);
      }
    } catch (error) {
      setDialogError(`Unable to save settings: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const changePassword = async (event) => {
    event.preventDefault();
    if (!currentPassword) {
      setDialogError('Enter your current password.');
      return;
    }
    if (password.length < 8) {
      setDialogError('Choose a password with at least 8 characters.');
      return;
    }
    if (password === currentPassword) {
      setDialogError('Choose a new password that is different from your current password.');
      return;
    }
    setSaving(true);
    setStatus('');
    setDialogError('');
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user?.email) throw new Error('Unable to verify your account email. Please sign in again.');
      const { error: verificationError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: currentPassword,
      });
      if (verificationError) throw new Error('The current password you entered is incorrect.');
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setCurrentPassword('');
      setPassword('');
      setStatus('Password updated.');
    } catch (error) {
      setDialogError(`Unable to change password: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const sendProblemReport = async (event) => {
    event.preventDefault();
    if (details.trim().length < 3) return;
    if (problemReportsUnavailable) {
      setDialogError('Problem reports are unavailable until the latest account-tools migration is applied to Supabase.');
      return;
    }
    setSaving(true);
    try {
      const created = await submitProblemReport(userId, category, details);
      setReports(current => [{
        ...created,
        reportId: `problem-${created.id}`,
        status: created.status === 'open' ? 'pending' : created.status,
      }, ...current]);
      setDetails('');
      setSection('report-history');
      setStatus('Report sent to the BoardMate admin team.');
    } catch (error) {
      onError(`Unable to submit problem report: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const requestDeletion = () => setDeletionConfirmationOpen(true);

  const confirmDeletionRequest = async () => {
    setDeletionConfirmationOpen(false);
    setSaving(true);
    try {
      setDeletionRequest(await submitAccountDeletionRequest(userId));
      setStatus('Account deletion is scheduled. Sign in or cancel it in Settings & Privacy within five days to keep your account.');
    } catch (error) {
      setDialogError(`Unable to schedule account deletion: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const cancelDeletion = async () => {
    setSaving(true);
    setDialogError('');
    setStatus('');
    try {
      const cancelled = await cancelAccountDeletion();
      if (!cancelled) throw new Error('The five-day grace period has ended or no active deletion is scheduled.');
      setDeletionRequest(await fetchDeletionRequest(userId));
      setStatus('Account deletion cancelled. Your account will remain active.');
    } catch (error) {
      setDialogError(`Unable to cancel account deletion: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <PortalPage title="Settings & Privacy" onBack={onClose}>
      <section aria-label="Account settings">
        <div className="bm-account-settings-tabs" role="tablist" aria-label="Settings sections">
          {[['settings', 'Settings'], ['verification', 'Account Verification'], ['blocked', 'Blocked'], ['report', 'Report'], ['report-history', 'My reports']].map(([value, label]) => (
            <button key={value} type="button" role="tab" id={`account-settings-${value}`} aria-selected={section === value} aria-controls={`account-panel-${value}`} onClick={() => { setSection(value); setStatus(''); }} className={`rounded-lg px-1 py-2 font-semibold ${section === value ? 'bg-emerald-700 text-white' : 'text-gray-600'}`}>{label}</button>
          ))}
        </div>

        {status && <p className="mb-3 rounded-lg bg-emerald-50 p-2 text-[10px] text-emerald-800" role="status">{status}</p>}

        <div role="tabpanel" id={`account-panel-${section}`} aria-labelledby={`account-settings-${section}`}>
        {section === 'settings' && (
          <div className="space-y-4">
            <form onSubmit={saveSettings} className="space-y-3 rounded-xl bg-white p-3">
              <h3 className="text-xs font-bold">Privacy controls</h3>
              {[
                ['is_active', 'Account active', 'Deactivate to hide your approved posts/listings and block account actions.'],
                ['show_profile', 'Show my profile and approved posts/listings', 'Turn off to hide your profile and published content from other members.'],
                ['show_active_status', 'Show when I am active', 'Turn off to hide your online/last-seen status.'],
              ].map(([key, label, help]) => (
                <label key={key} className="flex items-start gap-2 text-[10px] text-gray-700">
                  <input type="checkbox" checked={Boolean(preferences[key])} onChange={event => updatePreference(key, event.target.checked)} className="mt-0.5 accent-emerald-700" />
                  <span><span className="block font-semibold">{label}</span><span className="text-gray-500">{help}</span></span>
                </label>
              ))}
              <button type="submit" disabled={saving} className="w-full rounded-lg bg-emerald-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">{saving ? 'Saving…' : 'Save privacy settings'}</button>
            </form>

            <form onSubmit={changePassword} className="space-y-2 rounded-xl bg-white p-3">
              <h3 className="text-xs font-bold">Change password</h3>
              <input type="password" autoComplete="current-password" required value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} placeholder="Current password" className="w-full rounded-lg border border-gray-200 px-3 py-2 text-xs" />
              <input type="password" autoComplete="new-password" minLength={8} required value={password} onChange={event => setPassword(event.target.value)} placeholder="New password (at least 8 characters)" className="w-full rounded-lg border border-gray-200 px-3 py-2 text-xs" />
              <button type="submit" disabled={saving} className="rounded-lg border border-emerald-700 px-3 py-2 text-xs font-semibold text-emerald-800 disabled:opacity-50">Update password</button>
            </form>

            <section className="space-y-2 rounded-xl border border-red-100 bg-white p-3">
              <h3 className="text-xs font-bold text-red-700">Account deletion</h3>
              <p className="text-[10px] text-gray-600">Your account is permanently deleted five days after confirmation. Sign in or cancel here during that period to keep your account.</p>
              {deletionRequest?.status === 'scheduled' ? (
                <>
                  <p className="text-[10px] font-semibold text-amber-700">
                    Scheduled for {new Date(deletionRequest.scheduled_for).toLocaleString()}.
                  </p>
                  <button type="button" onClick={cancelDeletion} disabled={saving} className="rounded-lg border border-emerald-700 px-3 py-2 text-xs font-bold text-emerald-800 disabled:opacity-50">
                    {saving ? 'Cancelling…' : 'Cancel deletion'}
                  </button>
                </>
              ) : (
                <button type="button" onClick={requestDeletion} disabled={saving} className="rounded-lg bg-red-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">Delete account</button>
              )}
            </section>
            {deletionConfirmationOpen && (
              <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/55 p-4" role="alertdialog" aria-modal="true" aria-labelledby="account-deletion-title">
                <section className="w-full max-w-xs space-y-4 rounded-2xl bg-white p-5 shadow-2xl">
                  <h2 id="account-deletion-title" className="text-sm font-bold text-gray-900">Are you sure you want to delete?</h2>
                  <p className="text-xs text-gray-600">Your account and stored media will be permanently deleted after five days. Sign in before the deadline to cancel.</p>
                  <div className="flex justify-end gap-2">
                    <button type="button" onClick={() => setDeletionConfirmationOpen(false)} className="rounded-lg bg-gray-100 px-4 py-2 text-xs font-semibold text-gray-700">No</button>
                    <button type="button" onClick={confirmDeletionRequest} disabled={saving} className="rounded-lg bg-red-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-50">Yes</button>
                  </div>
                </section>
              </div>
            )}
          </div>
        )}

        {section === 'verification' && <AccountVerificationSettings user={userProfile}
          onBack={() => setSection('settings')} onLogout={onLogout} onSubmit={onVerificationSubmit}
          onProfileUpdate={onProfileUpdate} submission={verificationSubmission} />}

        {section === 'blocked' && (
          <section className="space-y-2 rounded-xl bg-white p-3">
            <h3 className="text-xs font-bold">Blocked accounts</h3>
            <p className="text-[10px] text-gray-500">Unblocking lets this person’s visible posts and listings appear again and allows messaging if both accounts are approved.</p>
            {blockedContacts.map(contact => (
              <article key={contact.userId} className="flex items-center justify-between gap-2 rounded-lg border border-gray-100 p-2">
                <span className="truncate text-xs font-semibold text-gray-800">{contact.name}</span>
                <button
                  type="button"
                  onClick={() => unblockContact(contact)}
                  disabled={unblockingUserId === contact.userId}
                  className="shrink-0 rounded-lg border border-emerald-700 px-3 py-1.5 text-[10px] font-semibold text-emerald-800 disabled:opacity-50"
                >
                  {unblockingUserId === contact.userId ? 'Unblocking…' : 'Unblock'}
                </button>
              </article>
            ))}
            {blockedContacts.length === 0 && <p className="rounded-lg bg-gray-50 p-4 text-center text-xs text-gray-500">You have not blocked anyone.</p>}
          </section>
        )}

        {section === 'report' && (
          <form onSubmit={sendProblemReport} className="space-y-3 rounded-xl bg-white p-3">
            <h3 className="text-xs font-bold">Report a problem</h3>
            <label className="block text-[10px] font-semibold text-gray-700">
              Category
              <select value={category} onChange={event => setCategory(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-xs">
                {reportCategories.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className="block text-[10px] font-semibold text-gray-700">
              What happened?
              <textarea value={details} onChange={event => setDetails(event.target.value)} minLength={3} maxLength={2000} required rows={5} placeholder="Describe the issue so our team can review it." className="mt-1 w-full resize-y rounded-lg border border-gray-200 px-3 py-2 text-xs" />
            </label>
            <button type="submit" disabled={saving || details.trim().length < 3} className="w-full rounded-lg bg-emerald-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">{saving ? 'Submitting…' : 'Send to admin'}</button>
          </form>
        )}

        {section === 'report-history' && (
          <div className="space-y-2">
            <h3 className="text-xs font-bold">Your submitted reports</h3>
            {reports.map(report => (
              <article key={report.reportId} className="rounded-xl bg-white p-3">
                <div className="flex justify-between gap-2"><p className="text-[10px] font-bold capitalize">{report.category.replace('_', ' ')}</p><span className="text-[9px] font-semibold text-emerald-800">{report.status.replace('_', ' ')}</span></div>
                <p className="mt-1 whitespace-pre-wrap text-[10px] text-gray-700">{report.details}</p>
                {report.admin_note && <p className="mt-2 text-[10px] text-gray-500">Admin: {report.admin_note}</p>}
                <time className="mt-2 block text-[9px] text-gray-400">{new Date(report.created_at).toLocaleString()}</time>
              </article>
            ))}
            {!reports.length && <p className="rounded-xl bg-white p-4 text-center text-xs text-gray-500">No reports submitted yet.</p>}
          </div>
        )}
        </div>
      </section>
      <ErrorDialog message={dialogError} onClose={() => setDialogError('')} />
    </PortalPage>
  );
}
