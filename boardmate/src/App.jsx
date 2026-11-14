import { canSubmitInitialVerification } from './lib/verificationStatus';
import { signUpWithDuplicateValidation } from './lib/registration';
import ImageUploadInput from './components/ImageUploadInput';
import AppViewport from './components/AppViewport';
import { duplicateRegistrationMessage, registrationErrorMessage } from './lib/registrationErrors';
import useAppDialog from './hooks/useAppDialog';
import VerificationFilePreview from './components/VerificationFilePreview';
import { minimumPasswordLength, registrationPasswordError, registrationBirthDateError } from './lib/registrationValidation';
import { useEffect, useRef, useState } from 'react';
import { supabase } from './supabaseClient';
import { getAuthenticationErrorMessage } from './lib/authErrors';
import { signInWithEmail } from './lib/authentication';
import WelcomeScreen from './components/WelcomeScreen';
import PasswordRecovery from './components/PasswordRecovery';
import BoardMateHouseIcon from './components/BoardMateHouseIcon';
import OwnerDashboard from './components/OwnerDashboard';
import RenterDashboard from './components/RenterDashboard';
import AccountReviewScreen from './components/AccountReviewScreen';
import SelfieCamera from './components/SelfieCamera';
import ErrorDialog from './components/ErrorDialog';
import { recordActivity } from './lib/activityHistory';
import { getVerificationStatus, submitInitialVerificationDocuments, validateVerificationFile, verificationProfileUpdate } from './lib/verification';

const emptyRegistrationForm = {
  fullName: '',
  email: '',
  phone: '',
  password: '',
  confirmPassword: '',
  dob: '',
  gender: '',
  businessName: '',
  address: '',
  govIdNumber: '',
  propertyType: '',
};

function getConnectionIssue() {
  if (typeof navigator === 'undefined' || !navigator.onLine) return 'offline';

  const connection = navigator.connection;
  if (
    connection
    && (connection.effectiveType === 'slow-2g' || connection.effectiveType === '2g' || connection.downlink < 0.5)
  ) {
    return 'slow';
  }

  return null;
}

export default function App() {
  const { notify, confirm } = useAppDialog();
  // Navigation State
  const [currentScreen, setCurrentScreen] = useState('MAIN'); 
  const [userRole, setUserRole] = useState('RENTER'); // 'RENTER' or 'OWNER'
  const [connectionIssue, setConnectionIssue] = useState(getConnectionIssue);
  const [isRestoringSession, setIsRestoringSession] = useState(true);
  const [regStep, setRegStep] = useState(1);
  const [verificationSettingsEntry, setVerificationSettingsEntry] = useState(false);
  const [passwordVisibility, setPasswordVisibility] = useState({
    login: false,
    registration: false,
    confirmRegistration: false,
  });

  // Form Data State
  const [formData, setFormData] = useState(emptyRegistrationForm);
  const [registrationErrors, setRegistrationErrors] = useState({});

  // Login State
  const [loginInput, setLoginInput] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [currentUserProfile, setCurrentUserProfile] = useState(null);
  const [verificationStatus, setVerificationStatus] = useState('not_submitted');
  const [submittingVerification, setSubmittingVerification] = useState(false);
  const [verificationProgress, setVerificationProgress] = useState('');
  const [verificationError, setVerificationError] = useState('');
  const [verificationMessage, setVerificationMessage] = useState('');
  const registrationRequestRef = useRef(false);
  const verificationRequestRef = useRef(false);
  const [registrationAccountId, setRegistrationAccountId] = useState(null);
  const [legalDialog, setLegalDialog] = useState(null);
  const [optionalCookies, setOptionalCookies] = useState(false);
  const [cookieSettingsError, setCookieSettingsError] = useState('');

  // Upload Files State (For ID & Selfie)
  const [idFile, setIdFile] = useState(null);
  const [selfieFile, setSelfieFile] = useState(null);

  useEffect(() => {
    let active = true;
    const restoreUserSession = async () => {
      try {
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        if (!session) return;

        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', session.user.id)
          .maybeSingle();
        if (profileError) throw profileError;
        if (!profile) throw new Error('Your saved account profile could not be found. Please sign in again.');

        const accountRole = String(profile.role || session.user.user_metadata?.role || '').toUpperCase();
        const restoredRole = ['OWNER', 'LANDLORD'].includes(accountRole)
          ? 'OWNER'
          : ['RENTER', 'USER'].includes(accountRole) ? 'RENTER' : null;
        if (!restoredRole) throw new Error('Your saved account role could not be recognized. Please sign in again.');

        if (!active) return;
        setCurrentUserProfile({
          id: session.user.id,
          fullName: profile.full_name || session.user.user_metadata?.full_name || '',
          email: profile.email || session.user.email || '',
          phone: profile.phone || session.user.user_metadata?.phone || '',
          dob: profile.dob || session.user.user_metadata?.dob || '',
          gender: profile.gender || session.user.user_metadata?.gender || '',
          businessName: profile.business_name || session.user.user_metadata?.business_name || '',
          address: profile.address || session.user.user_metadata?.address || '',
          govIdNumber: profile.gov_id_number || session.user.user_metadata?.gov_id_number || '',
          propertyType: profile.property_type || session.user.user_metadata?.property_type || '',
          role: restoredRole === 'OWNER' ? 'LANDLORD' : 'RENTER',
          verificationStatus: getVerificationStatus(profile),
          verificationRevision: profile.verification_revision || null,
          verificationReason: profile.verification_reason || '',
          suspendedAt: profile.suspended_at || null,
          suspensionReason: profile.suspension_reason || '',
          idUploaded: profile.id_uploaded || false,
          selfieUploaded: profile.selfie_uploaded || false,
          idDocumentPath: profile.id_document_path || null,
          selfieDocumentPath: profile.selfie_document_path || null,
          avatar: profile.avatar_url || null,
        });
        setVerificationStatus(getVerificationStatus(profile));
        setUserRole(restoredRole);
        setCurrentScreen(restoredRole === 'OWNER' ? 'OWNER_DASHBOARD' : 'RENTER_DASHBOARD');
      } catch (error) {
        if (active) notify(`Unable to restore your saved session: ${getAuthenticationErrorMessage(error)}`);
      } finally {
        if (active) setIsRestoringSession(false);
      }
    };

    restoreUserSession();
    return () => { active = false; };
  }, [notify]);

  useEffect(() => {
    const updateConnectionIssue = () => setConnectionIssue(getConnectionIssue());
    const connection = navigator.connection;

    window.addEventListener('online', updateConnectionIssue);
    window.addEventListener('offline', updateConnectionIssue);
    connection?.addEventListener('change', updateConnectionIssue);

    return () => {
      window.removeEventListener('online', updateConnectionIssue);
      window.removeEventListener('offline', updateConnectionIssue);
      connection?.removeEventListener('change', updateConnectionIssue);
    };
  }, []);

  const retryConnection = () => {
    const issue = getConnectionIssue();
    setConnectionIssue(issue);
    if (!issue) window.location.reload();
  };

  const saveCookieSettings = () => {
    try {
      const secureAttribute = window.location.protocol === 'https:' ? '; Secure' : '';
      document.cookie = optionalCookies
        ? `boardmate_optional_cookies=true; Max-Age=31536000; Path=/; SameSite=Lax${secureAttribute}`
        : 'boardmate_optional_cookies=; Max-Age=0; Path=/; SameSite=Lax';
      if (optionalCookies && !document.cookie.split('; ').includes('boardmate_optional_cookies=true')) {
        throw new Error('Your browser did not save the optional preference cookie.');
      }
      setCookieSettingsError('');
      setLegalDialog(null);
    } catch (error) {
      setCookieSettingsError(`Unable to save cookie settings: ${error.message}`);
    }
  };

  const openCookieSettings = () => {
    try {
      setOptionalCookies(document.cookie.split('; ').includes('boardmate_optional_cookies=true'));
      setCookieSettingsError('');
    } catch (error) {
      setCookieSettingsError(`Unable to read saved cookie settings: ${error.message}`);
    }
    setLegalDialog('cookies');
  };

  useEffect(() => {
    const userId = currentUserProfile?.id;
    if (!userId) return undefined;

    const channel = supabase
      .channel(`profile-verification-${userId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'profiles',
        filter: `id=eq.${userId}`,
      }, ({ new: profile }) => {
        setCurrentUserProfile(current => current?.id === userId ? {
          ...current,
          verificationStatus: getVerificationStatus(profile),
          verificationRevision: profile.verification_revision || null,
          verificationReason: profile.verification_reason || '',
          suspendedAt: profile.suspended_at || null,
          suspensionReason: profile.suspension_reason || '',
          idUploaded: profile.id_uploaded || false,
          selfieUploaded: profile.selfie_uploaded || false,
          idDocumentPath: profile.id_document_path || null,
          selfieDocumentPath: profile.selfie_document_path || null,
        } : current);
        setVerificationStatus(getVerificationStatus(profile));
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [currentUserProfile?.id]);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    setRegistrationErrors(current => {
      const next = { ...current };
      delete next[name];
      if (name === 'password' || name === 'confirmPassword') delete next.confirmPassword;
      if (name === 'password') {
        const error = registrationPasswordError(value);
        if (error) next.password = error;
      }
      return next;
    });
  };

  const togglePasswordVisibility = (field) => {
    setPasswordVisibility(current => ({ ...current, [field]: !current[field] }));
  };

  const registrationInputClass = (field) => (
    `w-full px-4 py-2.5 rounded-xl bg-[#EFECE1] border text-sm focus:outline-none focus:ring-2 ${
      registrationErrors[field]
        ? 'border-red-500 focus:ring-red-200'
        : 'border-gray-300 focus:ring-[#82AB85]'
    }`
  );

  const registrationFieldError = (field) => registrationErrors[field] && (
    <p id={`${field}-error`} className="mt-1 text-[11px] font-medium text-red-700" role="alert">
      {registrationErrors[field]}
    </p>
  );

  const validateAccountInfo = () => {
    const requiredFields = {
      fullName: 'your full name',
      email: 'your email address',
      phone: 'your phone number',
      password: 'a password',
      confirmPassword: 'your password confirmation',
      dob: 'your date of birth',
      gender: 'your gender',
      ...(userRole === 'OWNER' ? {
        businessName: 'your business or owner name',
        address: 'your complete address',
        govIdNumber: 'your government ID number',
        propertyType: 'your property type',
      } : {}),
    };
    const errors = {};

    Object.entries(requiredFields).forEach(([field, label]) => {
      if (!String(formData[field] ?? '').trim()) {
        errors[field] = `This field is required. Please enter ${label}.`;
      }
    });

    if (formData.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email.trim())) {
      errors.email = 'Please enter a valid email address.';
    }
    const passwordError = registrationPasswordError(formData.password);
    if (passwordError) errors.password = passwordError;
    if (formData.password && formData.confirmPassword && formData.password !== formData.confirmPassword) {
      errors.confirmPassword = 'Passwords do not match. Please confirm your password again.';
    }

    if (formData.dob && registrationBirthDateError(formData.dob)) errors.dob = registrationBirthDateError(formData.dob);
    return errors;
  };

  const focusRegistrationField = (field) => {
    const target = document.querySelector(`[name="${field}"]`)
      || document.querySelector(`[data-registration-field="${field}"]`);
    target?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    target?.focus?.({ preventScroll: true });
  };

  const handleRegistrationNext = () => {
    if (regStep === 1) {
      const errors = validateAccountInfo();
      setRegistrationErrors(errors);
      if (Object.keys(errors).length) {
        focusRegistrationField(Object.keys(errors)[0]);
        return;
      }
    } else if (regStep === 2) {
      const errors = {};
      if (!idFile) errors.idFile = 'Please upload a valid ID before continuing.';
      if (!selfieFile) errors.selfieFile = 'Please take a selfie before continuing.';
      setRegistrationErrors(errors);
      if (Object.keys(errors).length) {
        focusRegistrationField(Object.keys(errors)[0]);
        return;
      }
    }

    setRegStep(step => step + 1);
  };

  // Handle File Selections
  const handleIdUpload = (e) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      e.target.value = '';
      try { validateVerificationFile(file, 'government ID'); }
      catch (error) { setRegistrationErrors(current => ({ ...current, idFile: error.message })); return; }
      setIdFile(file);
      setRegistrationErrors(current => {
        const next = { ...current };
        delete next.idFile;
        return next;
      });
    }
  };

  const handleSelfieCapture = (file) => {
    setSelfieFile(file);
    setRegistrationErrors(current => {
      const next = { ...current };
      delete next.selfieFile;
      return next;
    });
  };

  const handleVerificationSubmit = async ({ idFile: nextIdFile, selfieFile: nextSelfieFile }, accountId = currentUserProfile?.id) => {
    if (!accountId) throw new Error('Please sign in before uploading verification documents.');
    if (verificationRequestRef.current) throw new Error('Your documents are already being submitted. Please wait.');
    verificationRequestRef.current = true;
    setSubmittingVerification(true);
    setVerificationError('');
    setVerificationMessage('');
    const expectedRevision = currentUserProfile?.verificationRevision || null;
    try {
      const profile = await submitInitialVerificationDocuments(accountId, { idFile: nextIdFile, selfieFile: nextSelfieFile }, setVerificationProgress);
      setCurrentUserProfile(current => {
        if (current?.id !== accountId) return current;
        if (current.verificationRevision && current.verificationRevision !== expectedRevision
          && current.verificationRevision !== profile.verification_revision) return current;
        if (current.verificationRevision === profile.verification_revision
          && ['approved', 'rejected'].includes(current.verificationStatus)
          && profile.verification_status === 'pending') return current;
        return { ...current, ...verificationProfileUpdate(profile) };
      });
      setVerificationStatus(getVerificationStatus(profile));
      setVerificationSettingsEntry(true);
      setCurrentScreen(userRole === 'OWNER' ? 'OWNER_DASHBOARD' : 'RENTER_DASHBOARD');
      setIdFile(null);
      setSelfieFile(null);
      setRegistrationAccountId(null);
      setVerificationMessage('Your documents were submitted securely. The latest administrator review status is shown above.');
    } finally {
      verificationRequestRef.current = false;
      setSubmittingVerification(false);
      setVerificationProgress('');
    }
  };

  const startRegistration = (role) => {
    setVerificationSettingsEntry(false);
    setRegistrationAccountId(null);
    setVerificationError('');
    setVerificationMessage('');
    setUserRole(role);
    setRegStep(1);
    setFormData({ ...emptyRegistrationForm });
    setRegistrationErrors({});
    setIdFile(null);
    setSelfieFile(null);
    setCurrentScreen('REGISTRATION');
  };

  const handleLogout = async () => {
    setIsLoggingOut(true);
    await new Promise(resolve => window.setTimeout(resolve, 450));
    let historyError = null;
    try {
      await recordActivity(currentUserProfile.id, 'Logged out');
    } catch (error) {
      historyError = error;
    }

    const { error } = await supabase.auth.signOut();
    if (error) {
      setIsLoggingOut(false);
      notify('Logout Error: ' + error.message);
      return;
    }
    setCurrentUserProfile(null);
    setVerificationSettingsEntry(false);
    setCurrentScreen('WELCOME');
    setIsLoggingOut(false);
    if (historyError) {
      notify('You were logged out, but activity history could not be saved: ' + historyError.message);
    }
  };

  const completeRegistration = async (authData) => {
    const profileRole = userRole === 'OWNER' ? 'LANDLORD' : 'RENTER';

    setCurrentUserProfile({
      id: authData.user.id,
      fullName: formData.fullName.trim(),
      email: formData.email,
      phone: formData.phone.trim(),
      dob: formData.dob,
      gender: formData.gender.trim(),
      businessName: userRole === 'OWNER' ? formData.businessName : '',
      address: userRole === 'OWNER' ? formData.address : '',
      govIdNumber: userRole === 'OWNER' ? formData.govIdNumber : '',
      propertyType: userRole === 'OWNER' ? formData.propertyType : '',
      role: profileRole,
      verificationStatus: 'not_submitted',
      verificationRevision: null,
      verificationReason: '',
      idUploaded: false,
      selfieUploaded: false,
      idDocumentPath: null,
      selfieDocumentPath: null,
      avatar: null,
    });
    setVerificationStatus('not_submitted');
    setUserRole(userRole);
    setCurrentScreen('ACCOUNT_REVIEW');
    try {
      await handleVerificationSubmit({ idFile, selfieFile }, authData.user.id);
    } catch (error) {
      setVerificationError(`Your account was created, but verification submission was not confirmed. ${error.message} You can retry here without registering again.`);
    }
  };

  // ---------------- SUPABASE LOGIN ----------------
  const handleLogin = async (e) => {
    e.preventDefault();
    setVerificationSettingsEntry(false);
    if (!loginInput.trim() || !loginPassword) {
      notify('Please enter your email and password.');
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await signInWithEmail(loginInput, loginPassword);
      if (error) throw error;

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', data.user.id)
        .maybeSingle();
      if (profileError) {
        await supabase.auth.signOut();
        throw profileError;
      }

      let accountRole = String(profile?.role || data.user.user_metadata?.role || '').toUpperCase();
      const requestedRole = currentScreen === 'OWNER_LOGIN' ? 'OWNER' : 'RENTER';
      const roleAliases = {
        OWNER: ['OWNER', 'LANDLORD'],
        RENTER: ['RENTER', 'USER'],
      };
      if (!accountRole) {
        const shouldRecoverRole = await confirm(
          `This account has no saved role. If you created it as a ${requestedRole === 'OWNER' ? 'Owner / Landlord' : 'User / Renter'}, choose OK to assign that role and repair its profile. Otherwise choose Cancel.`
        );
        if (!shouldRecoverRole) {
          await supabase.auth.signOut();
          throw new Error('Role recovery was cancelled. Select the portal you registered for, then try again.');
        }
        accountRole = requestedRole;
      }

      if (!roleAliases[requestedRole].includes(accountRole)) {
        await supabase.auth.signOut();
        throw new Error(
          `This account is registered as ${accountRole}. Please use the ${accountRole === 'OWNER' || accountRole === 'LANDLORD' ? 'Owner / Landlord' : 'User / Renter'} login.`
        );
      }

      const { error: deletionCancellationError } = await supabase.rpc('cancel_boardmate_account_deletion');
      const deletionFeatureNotInstalled = deletionCancellationError
        && (deletionCancellationError.code === 'PGRST202'
          || deletionCancellationError.code === '42883'
          || /could not find the function|function .* does not exist/i.test(deletionCancellationError.message || ''));
      if (deletionCancellationError && !deletionFeatureNotInstalled) {
        await supabase.auth.signOut();
        throw new Error(`Your account signed in, but its deletion schedule could not be checked: ${getAuthenticationErrorMessage(deletionCancellationError)}`);
      }

      const profileDetails = {
        id: data.user.id,
        full_name: profile?.full_name || data.user.user_metadata?.full_name || '',
        email: profile?.email || data.user.email || '',
        phone: profile?.phone || data.user.user_metadata?.phone || '',
        role: requestedRole === 'OWNER' ? 'LANDLORD' : 'RENTER',
        gender: profile?.gender || data.user.user_metadata?.gender || '',
        dob: profile?.dob || data.user.user_metadata?.dob || null,
        business_name: profile?.business_name || data.user.user_metadata?.business_name || null,
        address: profile?.address || data.user.user_metadata?.address || null,
        gov_id_number: profile?.gov_id_number || data.user.user_metadata?.gov_id_number || null,
        property_type: profile?.property_type || data.user.user_metadata?.property_type || null,
      };
      if (!profile?.role) {
        const { error: createProfileError } = await supabase
          .from('profiles')
          .upsert(profileDetails, { onConflict: 'id' });
        if (createProfileError) {
          await supabase.auth.signOut();
          throw new Error(`Your role is verified, but your profile could not be created: ${createProfileError.message}`);
        }
      }

      const currentVerificationStatus = getVerificationStatus(profile);
      setVerificationStatus(currentVerificationStatus);
      setCurrentUserProfile({
        id: data.user.id,
        fullName: profileDetails.full_name,
        email: profileDetails.email,
        phone: profileDetails.phone,
        dob: profileDetails.dob || '',
        gender: profileDetails.gender,
        businessName: profileDetails.business_name || '',
        address: profileDetails.address || '',
        govIdNumber: profileDetails.gov_id_number || '',
        propertyType: profileDetails.property_type || '',
        role: profileDetails.role,
        verificationStatus: currentVerificationStatus,
        verificationRevision: profile?.verification_revision || null,
        verificationReason: profile?.verification_reason || '',
        suspendedAt: profile?.suspended_at || null,
        suspensionReason: profile?.suspension_reason || '',
        idUploaded: profile?.id_uploaded || false,
        selfieUploaded: profile?.selfie_uploaded || false,
        idDocumentPath: profile?.id_document_path || null,
        selfieDocumentPath: profile?.selfie_document_path || null,
        avatar: profile?.avatar_url || null,
      });
      try {
        await recordActivity(data.user.id, 'Logged in', `Signed in as ${requestedRole.toLowerCase()}.`);
      } catch (historyError) {
        notify('Signed in, but activity history could not be saved: ' + historyError.message);
      }
      setUserRole(requestedRole);
      notify(`Welcome back! Successfully logged in as ${requestedRole}.`);

      setVerificationError('');
      setVerificationMessage('');
      if (requestedRole === 'OWNER') {
        setCurrentScreen('OWNER_DASHBOARD');
      } else {
        setCurrentScreen('RENTER_DASHBOARD');
      }
    } catch (err) {
      notify("Login Error: " + getAuthenticationErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  // ---------------- SUPABASE REGISTRATION ----------------
  const handleFinalSubmit = async () => {
    if (registrationRequestRef.current) return;
    const accountErrors = validateAccountInfo();
    if (Object.keys(accountErrors).length) {
      setRegistrationErrors(accountErrors);
      setRegStep(1);
      focusRegistrationField(Object.keys(accountErrors)[0]);
      return;
    }

    const verificationErrors = {};
    if (!idFile) verificationErrors.idFile = 'Please upload a valid ID before submitting.';
    if (!selfieFile) verificationErrors.selfieFile = 'Please take a selfie before submitting.';
    if (Object.keys(verificationErrors).length) {
      setRegistrationErrors(verificationErrors);
      setRegStep(2);
      focusRegistrationField(Object.keys(verificationErrors)[0]);
      return;
    }

    try {
      validateVerificationFile(idFile, 'id');
      validateVerificationFile(selfieFile, 'selfie');
    } catch (error) {
      setRegistrationErrors({ documents: error.message });
      setRegStep(2);
      return;
    }
    registrationRequestRef.current = true;
    setLoading(true);
    setVerificationError('');
    setVerificationMessage('');

    try {
      const profileRole = userRole === 'OWNER' ? 'LANDLORD' : 'RENTER';
      // 1. Register User to Supabase Auth
      const { data: authData, error: authError } = await signUpWithDuplicateValidation(supabase, {
        email: formData.email.trim().toLowerCase(),
        password: formData.password,
        options: {
          data: {
            role: profileRole,
            full_name: formData.fullName.trim(),
            phone: formData.phone.trim(),
            gender: formData.gender.trim(),
            dob: formData.dob || null,
            business_name: userRole === 'OWNER' ? formData.businessName : null,
            address: userRole === 'OWNER' ? formData.address : null,
            gov_id_number: userRole === 'OWNER' ? formData.govIdNumber : null,
            property_type: userRole === 'OWNER' ? formData.propertyType : null,
          },
        },
      });

      if (authError) throw authError;
      if (!authData?.user) throw new Error("Registration could not be confirmed. Try signing in before registering again.");
      if (Array.isArray(authData.user?.identities) && authData.user.identities.length === 0 && !authData.session) {
        throw Object.assign(new Error('This email address is already registered.'), { code: 'email_exists' });
      }

      setRegistrationAccountId(authData.user?.id || null);
      setFormData(current => ({ ...current, password: '', confirmPassword: '' }));
      await completeRegistration(authData);
    } catch (err) {
      const duplicateMessage = duplicateRegistrationMessage(err);
      if (duplicateMessage) {
        notify(duplicateMessage, 'Account already exists');
        setRegStep(1);
        return;
      }
      notify("Registration Error: " + registrationErrorMessage(err));
    } finally {
      registrationRequestRef.current = false;
      setLoading(false);
    }
  };

  if (recoveryOpen) return <AppViewport><PasswordRecovery initialEmail={loginInput} onBack={() => setRecoveryOpen(false)} onComplete={message => {
    setRecoveryOpen(false); setCurrentUserProfile(null); setLoginPassword(''); setCurrentScreen(userRole === 'RENTER' ? 'RENTER_LOGIN' : 'OWNER_LOGIN'); notify(message);
  }} /></AppViewport>;

  return (
    <AppViewport>

      {connectionIssue && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/60 p-4" role="alertdialog" aria-modal="true" aria-labelledby="connection-alert-title" aria-describedby="connection-alert-message">
          <section className="w-full max-w-sm rounded-2xl bg-[#FAF7EE] p-6 text-center shadow-2xl">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-800" aria-hidden="true">
              <i className={`fa-solid ${connectionIssue === 'offline' ? 'fa-wifi' : 'fa-signal'}`}></i>
            </div>
            <h2 id="connection-alert-title" className="text-lg font-bold text-gray-900">
              {connectionIssue === 'offline' ? 'Lost Connection' : 'Slow Internet Connection'}
            </h2>
            <p id="connection-alert-message" className="mt-2 text-sm text-gray-600">
              {connectionIssue === 'offline'
                ? 'Connect to the Internet, then retry.'
                : 'Your connection is slow. Connect to a stronger network, then retry.'}
            </p>
            <button
              type="button"
              onClick={retryConnection}
              className="mt-5 w-full rounded-xl bg-[#6B946E] px-4 py-3 text-sm font-bold text-white transition hover:bg-[#557a58] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#426c46]"
            >
              Retry
            </button>
          </section>
        </div>
      )}
      {isRestoringSession && (
        <div className="fixed inset-0 z-[125] flex items-center justify-center bg-[#F8F6F0] text-sm font-semibold text-gray-700" role="status" aria-live="polite">
          Restoring your session…
        </div>
      )}
      {(currentScreen === 'OWNER_DASHBOARD' || currentScreen === 'RENTER_DASHBOARD') && (
        <button
          type="button"
          onClick={() => window.location.reload()}
          aria-label="Refresh dashboard"
          title="Refresh dashboard"
          className="absolute right-3 top-3 z-[60] grid h-9 w-9 place-items-center rounded-full bg-white text-emerald-800 shadow-md transition hover:bg-emerald-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700"
        >
          <i className="fa-solid fa-rotate" aria-hidden="true"></i>
        </button>
      )}
      
      {/* ------------ SCREEN 1: SPLASH SCREEN ------------ */}
      {currentScreen === 'MAIN' && (
        <WelcomeScreen onStart={() => setCurrentScreen('WELCOME')} />
      )}

      {/* ---------------- SCREEN 2: WELCOME UI ---------------- */}
      {currentScreen === 'WELCOME' && (
        <div className="w-full h-full flex flex-col items-center justify-between p-6 text-center">
          <div className="mt-8 flex flex-col items-center">
            <h2 className="text-lg font-serif font-semibold tracking-wider text-gray-700 mb-6">WELCOME TO</h2>
            
            <div className="welcome-brand-card bg-[#EFECE1] p-6 rounded-3xl mb-4 w-48 h-48 flex flex-col items-center justify-center border border-gray-300/50 shadow-inner">
              <BoardMateHouseIcon className="welcome-brand-icon w-16 h-16 text-[#6B946E] mb-2" />
              <span className="text-2xl font-serif font-bold">Board<span className="text-[#82AB85]">Mate</span></span>
            </div>

            <div className="flex items-center justify-center gap-4 text-xs font-medium text-gray-600 max-w-[260px] my-4">
              <span>Find your place. Find your mate.</span>
              <div className="h-8 w-[1px] bg-gray-400"></div>
              <span>Manage your property with ease.</span>
            </div>
          </div>

          <div className="w-full space-y-4 mb-6 px-4">
            <button 
              onClick={() => setCurrentScreen('LOGIN_ROLE')}
              className="w-full py-3.5 bg-[#F0EFE6] border border-gray-300 rounded-2xl font-bold text-[#6B946E] shadow-sm hover:bg-gray-100 transition cursor-pointer"
            >
              LOG IN
            </button>
            <button 
              onClick={() => setCurrentScreen('SIGNUP_ROLE')}
              className="w-full py-3.5 bg-[#82AB85] text-white rounded-2xl font-bold shadow-md hover:bg-[#6B946E] transition cursor-pointer"
            >
              SIGN UP
            </button>
          </div>

          <div className="flex justify-between w-full text-[10px] text-gray-500 px-6 mb-2">
            <button type="button" onClick={openCookieSettings} className="underline transition hover:text-emerald-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700 cursor-pointer">Cookies Settings</button>
            <button type="button" onClick={() => setLegalDialog('privacy')} className="underline transition hover:text-emerald-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700 cursor-pointer">Privacy and Policy</button>
          </div>
        </div>
      )}

      {/* ---------------- SCREEN 3: SIGN UP ROLE SELECTION ---------------- */}
      {currentScreen === 'SIGNUP_ROLE' && (
        <div className="w-full h-full flex flex-col items-center justify-between p-6 text-center relative bg-[#F8F6F0]">
          <button
            type="button"
            aria-label="Back to welcome"
            onClick={() => setCurrentScreen('WELCOME')}
            className="absolute top-5 left-5 text-gray-700 hover:text-[#6B946E] text-lg"
          >
            <i className="fa-solid fa-arrow-left"></i>
          </button>
          <div className="mt-6 flex flex-col items-center z-10">
            <h2 className="text-xs font-serif font-semibold tracking-widest text-gray-600">WELCOME TO</h2>
            <h1 className="text-2xl font-serif font-bold tracking-wide mt-1">
              Board<span className="text-[#82AB85]">Mate</span>
            </h1>
            <p className="text-[11px] text-gray-500 mt-1">Find your place. Find your mate.</p>
          </div>

          <div className="w-full z-10 px-4 my-auto">
            <h3 className="text-xl font-bold mb-6 text-gray-800">Sign Up</h3>

            <div className="space-y-4">
              <button 
                onClick={() => startRegistration('RENTER')}
                className="w-full bg-[#EFECE1] border border-gray-300/80 rounded-full py-3 px-4 flex items-center gap-3 shadow-sm hover:border-[#82AB85] transition cursor-pointer"
              >
                <div className="w-10 h-10 rounded-full bg-[#82AB85] text-white flex items-center justify-center text-lg">
                  <i className="fa-solid fa-user"></i>
                </div>
                <span className="font-semibold text-gray-700 text-sm">User / Renter</span>
              </button>

              <button 
                onClick={() => startRegistration('OWNER')}
                className="w-full bg-[#EFECE1] border border-gray-300/80 rounded-full py-3 px-4 flex items-center gap-3 shadow-sm hover:border-[#82AB85] transition cursor-pointer"
              >
                <div className="w-10 h-10 rounded-full bg-[#82AB85] text-white flex items-center justify-center text-lg">
                  <i className="fa-solid fa-store"></i>
                </div>
                <span className="font-semibold text-gray-700 text-sm">Owner / Landlord</span>
              </button>
            </div>

            <p className="text-xs text-gray-500 mt-6">
              Already have an account? {' '}
              <button onClick={() => setCurrentScreen('LOGIN_ROLE')} className="text-[#82AB85] font-bold underline cursor-pointer">
                Log In
              </button>
            </p>
          </div>

          <div className="flex justify-between w-full text-[10px] text-gray-500 px-6 z-10">
            <button type="button" onClick={openCookieSettings} className="underline transition hover:text-emerald-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700 cursor-pointer">Cookies Settings</button>
            <button type="button" onClick={() => setLegalDialog('privacy')} className="underline transition hover:text-emerald-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700 cursor-pointer">Privacy and Policy</button>
          </div>
        </div>
      )}


      {/* ---------------- SCREEN 4: LOG IN ROLE SELECTION ---------------- */}
      {currentScreen === 'LOGIN_ROLE' && (
        <div className="w-full h-full flex flex-col items-center justify-between p-6 text-center relative bg-[#F8F6F0]">
          <button
            type="button"
            aria-label="Back to welcome"
            onClick={() => setCurrentScreen('WELCOME')}
            className="absolute top-5 left-5 text-gray-700 hover:text-[#6B946E] text-lg"
          >
            <i className="fa-solid fa-arrow-left"></i>
          </button>
          <div className="mt-6 flex flex-col items-center z-10">
            <h2 className="text-xs font-serif font-semibold tracking-widest text-gray-600">WELCOME TO</h2>
            <h1 className="text-2xl font-serif font-bold tracking-wide mt-1">
              Board<span className="text-[#82AB85]">Mate</span>
            </h1>
            <p className="text-[11px] text-gray-500 mt-1">Find your place. Find your mate.</p>
          </div>

          <div className="w-full z-10 px-4 my-auto">
            <h3 className="text-xl font-bold mb-6 text-gray-800">Log In</h3>

            <div className="space-y-4">
              <button 
                onClick={() => { setUserRole('RENTER'); setCurrentScreen('RENTER_LOGIN'); }}
                className="w-full bg-[#EFECE1] border border-gray-300/80 rounded-full py-3 px-4 flex items-center gap-3 shadow-sm hover:border-[#82AB85] transition cursor-pointer"
              >
                <div className="w-10 h-10 rounded-full bg-[#82AB85] text-white flex items-center justify-center text-lg">
                  <i className="fa-solid fa-user"></i>
                </div>
                <span className="font-semibold text-gray-700 text-sm">User / Renter</span>
              </button>

              <button 
                onClick={() => { setUserRole('OWNER'); setCurrentScreen('OWNER_LOGIN'); }}
                className="w-full bg-[#EFECE1] border border-gray-300/80 rounded-full py-3 px-4 flex items-center gap-3 shadow-sm hover:border-[#82AB85] transition cursor-pointer"
              >
                <div className="w-10 h-10 rounded-full bg-[#82AB85] text-white flex items-center justify-center text-lg">
                  <i className="fa-solid fa-store"></i>
                </div>
                <span className="font-semibold text-gray-700 text-sm">Owner / Landlord</span>
              </button>
            </div>

            <p className="text-xs text-gray-500 mt-6">
              Don't have an account? {' '}
              <button onClick={() => setCurrentScreen('SIGNUP_ROLE')} className="text-[#82AB85] font-bold underline cursor-pointer">
                Sign Up
              </button>
            </p>
          </div>

          <div className="flex justify-between w-full text-[10px] text-gray-500 px-6 z-10">
            <button type="button" onClick={openCookieSettings} className="underline transition hover:text-emerald-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700 cursor-pointer">Cookies Settings</button>
            <button type="button" onClick={() => setLegalDialog('privacy')} className="underline transition hover:text-emerald-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700 cursor-pointer">Privacy and Policy</button>
          </div>
        </div>
      )}

      {/* ---------------- SCREEN 5: RENTER / OWNER LOGIN FORM ---------------- */}
      {(currentScreen === 'RENTER_LOGIN' || currentScreen === 'OWNER_LOGIN') && (
        <div className="w-full h-full flex flex-col justify-between p-6 bg-[#F8F6F0]">
          <button
            type="button"
            aria-label="Cancel login and go back"
            onClick={() => {
              setLoginInput('');
              setLoginPassword('');
              setCurrentScreen('LOGIN_ROLE');
            }}
            className="absolute top-5 left-5 z-10 text-gray-700 hover:text-[#6B946E] text-lg"
          >
            <i className="fa-solid fa-arrow-left"></i>
          </button>
          <div className="flex flex-col items-center mt-4">
            <h2 className="text-xl font-serif font-bold text-center tracking-wide uppercase">
              WELCOME BACK!<br/>
              <span className="text-sm font-normal text-gray-600 capitalize block mt-1 font-sans">
                {currentScreen === 'RENTER_LOGIN' ? 'Renter' : 'Owner'}
              </span>
            </h2>

            <div className="mt-4 flex flex-col items-center">
              <h1 className="text-2xl font-serif font-bold">
                Board<span className="text-[#82AB85]">Mate</span>
              </h1>
              <p className="text-[11px] text-gray-500 italic">
                {currentScreen === 'RENTER_LOGIN' ? 'Find your place. Find your mate.' : 'Manage your property with ease.'}
              </p>
            </div>
          </div>

          <form onSubmit={handleLogin} className="boardmate-login-form my-auto w-full space-y-4 px-2">
            <div>
              <input
                type="email"
                autoComplete="email"
                aria-label="Email address"
                placeholder="Email address"
                value={loginInput}
                onChange={(e) => setLoginInput(e.target.value)}
                required
                className="w-full px-4 py-3 rounded-xl bg-[#EFECE1] border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-[#82AB85]"
              />
            </div>
            <div>
              <div className="relative">
                <input
                  type={passwordVisibility.login ? 'text' : 'password'}
                  autoComplete="current-password"
                  aria-label="Password"
                  placeholder="Password"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  required
                  className="w-full px-4 py-3 pr-12 rounded-xl bg-[#EFECE1] border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-[#82AB85]"
                />
                <button
                  type="button"
                  onClick={() => togglePasswordVisibility('login')}
                  aria-label={passwordVisibility.login ? 'Hide password' : 'Show password'}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 active:scale-95"
                >
                  <i className={`fa-regular ${passwordVisibility.login ? 'fa-eye-slash' : 'fa-eye'}`}></i>
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between text-xs text-gray-600 px-1">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" className="rounded text-[#82AB85] focus:ring-0" />
                <span>Remember me</span>
              </label>
              <button type="button" onClick={() => setRecoveryOpen(true)} className="text-[#82AB85] underline cursor-pointer">Forgot password?</button>
            </div>

            <button 
              type="submit"
              disabled={loading}
              className="w-full py-3.5 bg-[#82AB85] text-white rounded-xl font-bold shadow-md hover:bg-[#6B946E] transition mt-4 disabled:opacity-50 cursor-pointer"
            >
              {loading ? 'Please wait…' : 'Log In'}
            </button>
          </form>

          <div className="flex justify-between w-full text-[10px] text-gray-500 px-4">
            <button type="button" onClick={openCookieSettings} className="underline cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700">Cookies Settings</button>
            <button type="button" onClick={() => setLegalDialog('privacy')} className="underline cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700">Privacy and Policy</button>
          </div>
        </div>
      )}

      {/* ---------------- SCREEN 6: REGISTRATION FLOW ---------------- */}
      {currentScreen === 'REGISTRATION' && (
        <div className="w-full h-full flex flex-col justify-between bg-[#F8F6F0]">
          
          {/* Header */}
          <div className="p-4 pt-6 bg-[#F8F6F0] border-b border-gray-200/60 text-center flex flex-col items-center">
            <div className="flex items-center justify-center gap-2 mb-1">
              <BoardMateHouseIcon className="w-5 h-5 text-[#82AB85]" />
              <span className="font-serif font-bold text-sm">Board<span className="text-[#82AB85]">Mate</span></span>
            </div>
            <h2 className="text-xl font-bold text-gray-800">
              {userRole === 'OWNER' ? 'Owner Registration' : 'User Registration'}
            </h2>
            <button
              type="button"
              aria-label="Cancel sign up and go back"
              disabled={loading}
              onClick={() => {
                setRegStep(1);
                setCurrentScreen('SIGNUP_ROLE');
              }}
              className="absolute top-5 left-5 text-gray-700 hover:text-[#6B946E] text-lg"
            >
              <i className="fa-solid fa-arrow-left"></i>
            </button>
            <p className="text-[11px] text-gray-500">
              {regStep === 1 && (userRole === 'OWNER' ? 'Create your account as Owner / Landlord to get started.' : 'Create your account as User / Renter to get started.')}
              {regStep === 2 && 'We need to verify your identity. Upload clear photo of your ID.'}
              {regStep === 3 && 'Please review your details before submitting your registration.'}
            </p>

            {/* Stepper Header */}
            <div className="flex items-center justify-center gap-6 mt-4 w-full max-w-[260px]">
              <div className="flex flex-col items-center">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs ${regStep >= 1 ? 'bg-[#82AB85] text-white' : 'bg-gray-300 text-gray-600'}`}>
                  1
                </div>
                <span className="text-[10px] font-semibold mt-1">Account Info</span>
              </div>
              <div className={`h-[2px] w-8 ${regStep >= 2 ? 'bg-[#82AB85]' : 'bg-gray-300'}`}></div>
              <div className="flex flex-col items-center">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs ${regStep >= 2 ? 'bg-[#82AB85] text-white' : 'bg-gray-300 text-gray-600'}`}>
                  2
                </div>
                <span className="text-[10px] font-semibold mt-1">Verification</span>
              </div>
              <div className={`h-[2px] w-8 ${regStep >= 3 ? 'bg-[#82AB85]' : 'bg-gray-300'}`}></div>
              <div className="flex flex-col items-center">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs ${regStep === 3 ? 'bg-[#82AB85] text-white' : 'bg-gray-300 text-gray-600'}`}>
                  3
                </div>
                <span className="text-[10px] font-semibold mt-1">Review</span>
              </div>
            </div>
          </div>

          {/* Form Body (Scrollable) */}
          <div className="flex-1 overflow-y-auto p-5 space-y-4 no-scrollbar">
            
            {/* STEP 1: Account Info */}
            {regStep === 1 && (
              <div className="space-y-3">
                <div>
                  <label className="text-[11px] font-medium text-gray-600 block mb-1">Full Name</label>
                  <input 
                    type="text" 
                    name="fullName"
                    placeholder="Enter your Full Name" 
                    value={formData.fullName}
                    onChange={handleInputChange}
                    required
                    aria-invalid={Boolean(registrationErrors.fullName)}
                    aria-describedby={registrationErrors.fullName ? 'fullName-error' : undefined}
                    className={registrationInputClass('fullName')}
                  />
                  {registrationFieldError('fullName')}
                </div>

                <div>
                  <label className="text-[11px] font-medium text-gray-600 block mb-1">Email Address</label>
                  <input 
                    type="email" 
                    name="email"
                    placeholder="Enter your Email Address" 
                    value={formData.email}
                    onChange={handleInputChange}
                    required
                    aria-invalid={Boolean(registrationErrors.email)}
                    aria-describedby={registrationErrors.email ? 'email-error' : undefined}
                    className={registrationInputClass('email')}
                  />
                  {registrationFieldError('email')}
                </div>

                <div>
                  <label className="text-[11px] font-medium text-gray-600 block mb-1">Phone Number</label>
                  <input 
                    type="text" 
                    name="phone"
                    placeholder="09xx xxx xxxx" 
                    value={formData.phone}
                    onChange={handleInputChange}
                    required
                    aria-invalid={Boolean(registrationErrors.phone)}
                    aria-describedby={registrationErrors.phone ? 'phone-error' : undefined}
                    className={registrationInputClass('phone')}
                  />
                  {registrationFieldError('phone')}
                </div>

                <div>
                  <label className="text-[11px] font-medium text-gray-600 block mb-1">Password</label>
                  <div className="relative">
                    <input
                      type={passwordVisibility.registration ? 'text' : 'password'}
                      name="password"
                      minLength={minimumPasswordLength}
                      autoComplete="new-password"
                      placeholder="Create Password"
                      value={formData.password}
                      onChange={handleInputChange}
                      required
                      aria-invalid={Boolean(registrationErrors.password)}
                      aria-describedby={registrationErrors.password ? 'password-help password-error' : 'password-help'}
                      className={`${registrationInputClass('password')} pr-11`}
                    />
                    <button
                      type="button"
                      onClick={() => togglePasswordVisibility('registration')}
                      aria-label={passwordVisibility.registration ? 'Hide password' : 'Show password'}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 active:scale-95"
                    >
                      <i className={`fa-regular ${passwordVisibility.registration ? 'fa-eye-slash' : 'fa-eye'}`}></i>
                    </button>
                  </div>
                  <p id="password-help" className="mt-1 text-[11px] text-gray-600">Use at least 6 characters.</p>
                  {registrationFieldError('password')}
                </div>

                <div>
                  <label className="text-[11px] font-medium text-gray-600 block mb-1">Confirm Password</label>
                  <div className="relative">
                    <input
                      type={passwordVisibility.confirmRegistration ? 'text' : 'password'}
                      name="confirmPassword"
                      placeholder="Confirm Password"
                      value={formData.confirmPassword}
                      onChange={handleInputChange}
                      required
                      aria-invalid={Boolean(registrationErrors.confirmPassword)}
                      aria-describedby={registrationErrors.confirmPassword ? 'confirmPassword-error' : undefined}
                      className={`${registrationInputClass('confirmPassword')} pr-11`}
                    />
                    <button
                      type="button"
                      onClick={() => togglePasswordVisibility('confirmRegistration')}
                      aria-label={passwordVisibility.confirmRegistration ? 'Hide confirm password' : 'Show confirm password'}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 active:scale-95"
                    >
                      <i className={`fa-regular ${passwordVisibility.confirmRegistration ? 'fa-eye-slash' : 'fa-eye'}`}></i>
                    </button>
                  </div>
                  {registrationFieldError('confirmPassword')}
                </div>

                <div>
                  <label className="text-[11px] font-medium text-gray-600 block mb-1">Date of Birth</label>
                  <input 
                    type="date" 
                    name="dob"
                    value={formData.dob}
                    onChange={handleInputChange}
                    required
                    aria-invalid={Boolean(registrationErrors.dob)}
                    aria-describedby={registrationErrors.dob ? 'dob-error' : undefined}
                    className={`${registrationInputClass('dob')} text-gray-700`}
                  />
                  {registrationFieldError('dob')}
                </div>

                <div>
                  <label className="text-[11px] font-medium text-gray-600 block mb-1">Gender</label>
                  <select 
                    name="gender" 
                    value={formData.gender}
                    onChange={handleInputChange}
                    required
                    aria-invalid={Boolean(registrationErrors.gender)}
                    aria-describedby={registrationErrors.gender ? 'gender-error' : undefined}
                    className={`${registrationInputClass('gender')} text-gray-700`}
                  >
                    <option value="">Select your Gender</option>
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                    <option value="Other">Other</option>
                  </select>
                  {registrationFieldError('gender')}
                </div>

                {userRole === 'OWNER' && (
                  <>
                    <div>
                      <label className="text-[11px] font-medium text-gray-600 block mb-1">Business / Owner Name</label>
                      <input 
                        type="text" 
                        name="businessName"
                        placeholder="Enter your Business or Owner Name" 
                        value={formData.businessName}
                        onChange={handleInputChange}
                        required
                        aria-invalid={Boolean(registrationErrors.businessName)}
                        aria-describedby={registrationErrors.businessName ? 'businessName-error' : undefined}
                        className={registrationInputClass('businessName')}
                      />
                      {registrationFieldError('businessName')}
                    </div>

                    <div>
                      <label className="text-[11px] font-medium text-gray-600 block mb-1">Address</label>
                      <input 
                        type="text" 
                        name="address"
                        placeholder="Enter your Complete Address" 
                        value={formData.address}
                        onChange={handleInputChange}
                        required
                        aria-invalid={Boolean(registrationErrors.address)}
                        aria-describedby={registrationErrors.address ? 'address-error' : undefined}
                        className={registrationInputClass('address')}
                      />
                      {registrationFieldError('address')}
                    </div>

                    <div>
                      <label className="text-[11px] font-medium text-gray-600 block mb-1">Government ID Number</label>
                      <input 
                        type="text" 
                        name="govIdNumber"
                        placeholder="Enter your ID Number" 
                        value={formData.govIdNumber}
                        onChange={handleInputChange}
                        required
                        aria-invalid={Boolean(registrationErrors.govIdNumber)}
                        aria-describedby={registrationErrors.govIdNumber ? 'govIdNumber-error' : undefined}
                        className={registrationInputClass('govIdNumber')}
                      />
                      {registrationFieldError('govIdNumber')}
                    </div>

                    <div>
                      <label className="text-[11px] font-medium text-gray-600 block mb-1">Role / Property Type</label>
                      <select 
                        name="propertyType"
                        value={formData.propertyType}
                        onChange={handleInputChange}
                        required
                        aria-invalid={Boolean(registrationErrors.propertyType)}
                        aria-describedby={registrationErrors.propertyType ? 'propertyType-error' : undefined}
                        className={`${registrationInputClass('propertyType')} text-gray-700`}
                      >
                        <option value="">Select property type</option>
                        <option value="Boarding House">Boarding House</option>
                        <option value="Apartment">Apartment</option>
                        <option value="Dormitory">Dormitory</option>
                      </select>
                      {registrationFieldError('propertyType')}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* STEP 2: CLICKABLE ID & SELFIE UPLOAD */}
            {regStep === 2 && (
              <div className="space-y-4">
                <p className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-[11px] leading-5 text-emerald-800">
                  Select your ID and selfie now. They will upload securely after your account is created and signed in.
                </p>
                {/* ID Upload Box */}
                <div>
                  <label className="text-xs font-bold text-gray-700 block mb-1">1. Upload a valid ID</label>
                  <p className="text-[10px] text-gray-500 mb-2">Accepted: Passport, Driver's License, UMID, National ID, Student ID</p>
                  
                  <label
                    tabIndex={-1}
                    data-registration-field="idFile"
                    aria-invalid={Boolean(registrationErrors.idFile)}
                    className={`border-2 border-dashed ${registrationErrors.idFile ? 'border-red-500' : 'border-gray-300'} bg-[#EFECE1] rounded-2xl p-6 text-center flex flex-col items-center justify-center cursor-pointer hover:border-[#82AB85] focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-500 block`}
                  >
                    <ImageUploadInput 
                      type="file" 
                      accept="image/jpeg,image/png,image/webp,application/pdf" 
                      onChange={handleIdUpload} 
                      className="hidden" 
                    />
                    <i className="fa-solid fa-id-card text-3xl text-[#82AB85] mb-2"></i>
                    <span className="text-xs font-bold text-gray-700 block">
                      {idFile ? `Selected: ${idFile.name}` : 'Tap to upload your ID'}
                    </span>
                    {idFile && <span className="text-[10px] text-green-600 mt-1 block">File selected for review</span>}
                  </label>
                  <VerificationFilePreview key={idFile?.name || 'empty-id'} file={idFile} label="Government ID" onRemove={() => setIdFile(null)} disabled={loading} />
                  {registrationFieldError('idFile')}
                  {registrationFieldError('documents')}
                </div>

                {/* Selfie Upload Box */}
                <div>
                  <label className="text-xs font-bold text-gray-700 block mb-1">2. Take a selfie</label>
                  <p className="text-[10px] text-gray-500 mb-2">Ensure lighting and remove sunglasses or mask.</p>

                  <div
                    tabIndex={-1}
                    data-registration-field="selfieFile"
                    aria-invalid={Boolean(registrationErrors.selfieFile)}
                    className={registrationErrors.selfieFile ? 'rounded-2xl ring-2 ring-red-500' : ''}
                  >
                    <SelfieCamera onCapture={handleSelfieCapture} captured={selfieFile} disabled={loading} />
                  </div>
                  {registrationFieldError('selfieFile')}
                </div>
              </div>
            )}

            {/* STEP 3: REVIEW DETAILS */}
            {regStep === 3 && (
              <div className="space-y-4">
                <div className="bg-[#EFECE1] p-4 rounded-2xl border border-gray-300 space-y-2 text-xs">
                  <div className="flex justify-between items-center border-b pb-1 font-bold text-gray-700">
                    <span>Account Information</span>
                    <button disabled={loading} onClick={() => setRegStep(1)} className="text-[#82AB85] underline text-[11px] cursor-pointer">Edit</button>
                  </div>
                  <p><span className="text-gray-500">Full Name:</span> {formData.fullName || 'None'}</p>
                  <p><span className="text-gray-500">Email Address:</span> {formData.email || 'None'}</p>
                  <p><span className="text-gray-500">Phone Number:</span> {formData.phone || 'None'}</p>
                  <p><span className="text-gray-500">Gender:</span> {formData.gender || 'None'}</p>
                  {userRole === 'OWNER' && (
                    <>
                      <p><span className="text-gray-500">Business Name:</span> {formData.businessName || 'None'}</p>
                      <p><span className="text-gray-500">Address:</span> {formData.address || 'None'}</p>
                    </>
                  )}
                </div>

                <div className="bg-[#EFECE1] p-4 rounded-2xl border border-gray-300 space-y-2 text-xs">
                  <div className="flex justify-between items-center border-b pb-1 font-bold text-gray-700">
                    <span>Verification Documents</span>
                    <button disabled={loading} onClick={() => setRegStep(2)} className="text-[#82AB85] underline text-[11px] cursor-pointer">Edit</button>
                  </div>
                  <VerificationFilePreview file={idFile} label="Government ID" disabled={loading} onRemove={() => { setIdFile(null); setRegStep(2); }} />
                  {!idFile && <p>No ID selected.</p>}
                  <SelfieCamera captured={selfieFile} onCapture={handleSelfieCapture} disabled={loading} />
                  {!selfieFile && <p>No selfie selected.</p>}
                </div>
              </div>
            )}
          </div>

          {/* Footer Buttons */}
          <div className="p-4 bg-[#F8F6F0] border-t border-gray-200/60 space-y-2">
            {regStep < 3 ? (
              <button 
                type="button"
                onClick={handleRegistrationNext}
                className="w-full py-3 bg-[#82AB85] text-white rounded-xl font-bold flex items-center justify-center gap-2 shadow hover:bg-[#6B946E] transition text-sm cursor-pointer"
              >
                <span>Next</span>
                <i className="fa-solid fa-arrow-right"></i>
              </button>
            ) : (
              <button 
                onClick={handleFinalSubmit}
                disabled={loading}
                className="w-full py-3 bg-[#82AB85] text-white rounded-xl font-bold flex items-center justify-center gap-2 shadow hover:bg-[#6B946E] transition text-sm disabled:opacity-50 cursor-pointer"
              >
                <span>{loading ? 'Submitting to Supabase...' : 'Submit Registration'}</span>
                <i className="fa-solid fa-paper-plane"></i>
              </button>
            )}

            <button 
              disabled={loading}
              onClick={() => {
                if (regStep > 1) setRegStep(prev => prev - 1);
                else setCurrentScreen('SIGNUP_ROLE');
              }}
              className="w-full py-2 text-xs font-semibold text-gray-600 hover:text-gray-800 transition cursor-pointer"
            >
              <i className="fa-solid fa-arrow-left mr-1"></i> Back
            </button>
            <div className="flex justify-between pt-1 text-[10px] text-gray-500">
              <button type="button" onClick={openCookieSettings} className="underline hover:text-emerald-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700">Cookies Settings</button>
              <button type="button" onClick={() => setLegalDialog('privacy')} className="underline hover:text-emerald-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700">Privacy and Policy</button>
            </div>
          </div>

        </div>
      )}



      {currentScreen === 'ACCOUNT_REVIEW' && currentUserProfile && canSubmitInitialVerification(currentUserProfile) && (
        <AccountReviewScreen
          key={`${currentUserProfile.id}:${currentUserProfile.idDocumentPath || ''}:${currentUserProfile.selfieDocumentPath || ''}:${registrationAccountId || ''}:${currentUserProfile.verificationRevision || ''}`}
          user={currentUserProfile}
          status={currentUserProfile.verificationStatus || verificationStatus}
          reason={currentUserProfile.verificationReason}
          initialIdFile={registrationAccountId === currentUserProfile.id ? idFile : null}
          initialSelfieFile={registrationAccountId === currentUserProfile.id ? selfieFile : null}
          submitting={submittingVerification}
          progress={verificationProgress}
          submissionError={verificationError}
          submissionMessage={verificationMessage}
          onSubmit={handleVerificationSubmit}
          onBack={() => setCurrentScreen(userRole === 'OWNER' ? 'OWNER_DASHBOARD' : 'RENTER_DASHBOARD')}
          onLogout={handleLogout}
        />
      )}

      {/* ---------------- SCREEN 7: OWNER DASHBOARD ---------------- */}
      {(currentScreen === 'OWNER_DASHBOARD' || (currentScreen === 'ACCOUNT_REVIEW' && currentUserProfile && !canSubmitInitialVerification(currentUserProfile) && userRole === 'OWNER')) && (
        <OwnerDashboard 
          userProfile={currentUserProfile}
          onProfileUpdate={setCurrentUserProfile}
          initialSettingsSection={verificationSettingsEntry || currentScreen === 'ACCOUNT_REVIEW' ? 'verification' : null}
          onVerificationSubmit={handleVerificationSubmit}
          verificationSubmission={{ submitting: submittingVerification, progress: verificationProgress, error: verificationError, message: verificationMessage }}
          onLogout={handleLogout}
        />
      )}  

{/* SCREEN 8: RENTER DASHBOARD */}
{(currentScreen === 'RENTER_DASHBOARD' || (currentScreen === 'ACCOUNT_REVIEW' && currentUserProfile && !canSubmitInitialVerification(currentUserProfile) && userRole === 'RENTER')) && (
  <RenterDashboard 
    user={currentUserProfile}
    onProfileUpdate={setCurrentUserProfile}
    initialSettingsSection={verificationSettingsEntry || currentScreen === 'ACCOUNT_REVIEW' ? 'verification' : null}
    onVerificationSubmit={handleVerificationSubmit}
    verificationSubmission={{ submitting: submittingVerification, progress: verificationProgress, error: verificationError, message: verificationMessage }}
    onLogout={handleLogout}
  />
      )}

      {isLoggingOut && (
        <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-3 bg-black/50 text-white" role="status" aria-live="polite">
          <i className="fa-solid fa-circle-notch fa-spin text-4xl"></i>
          <span className="text-sm font-semibold">Logging out...</span>
        </div>
      )}

      {legalDialog && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/55 p-4" onMouseDown={event => {
          if (event.target === event.currentTarget) setLegalDialog(null);
        }}>
          <section className="max-h-[85cqh] w-full max-w-md overflow-y-auto rounded-2xl bg-[#FAF7EE] p-5 text-left shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="legal-dialog-title">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-800">BoardMate</p>
                <h2 id="legal-dialog-title" className="mt-1 text-lg font-bold text-gray-900">
                  {legalDialog === 'cookies' ? 'Cookie settings' : 'Privacy and policy'}
                </h2>
              </div>
              <button type="button" onClick={() => setLegalDialog(null)} aria-label="Close dialog" className="rounded-full px-2 text-xl text-gray-500 transition hover:bg-gray-200">×</button>
            </div>
            {legalDialog === 'cookies' ? (
              <div className="space-y-4 text-xs text-gray-700">
                <p>BoardMate uses essential browser storage to keep the app secure and remember your preferences. These settings do not affect your account or listings.</p>
                <div className="flex items-start justify-between gap-3 rounded-xl bg-white p-3">
                  <div>
                    <p className="font-bold text-gray-900">Essential storage</p>
                    <p className="mt-1 text-[10px] text-gray-500">Required for core app behavior and always enabled.</p>
                  </div>
                  <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-1 text-[9px] font-bold text-emerald-800">Always on</span>
                </div>
                <label className="flex items-start gap-3 rounded-xl bg-white p-3">
                  <input type="checkbox" checked={optionalCookies} onChange={event => setOptionalCookies(event.target.checked)} className="mt-0.5 accent-emerald-700" />
                  <span>
                    <span className="block font-bold text-gray-900">Optional preference storage</span>
                    <span className="mt-1 block text-[10px] text-gray-500">Allow BoardMate to remember this optional preference. Disabled by default.</span>
                  </span>
                </label>
                <button type="button" onClick={saveCookieSettings} className="w-full rounded-xl bg-emerald-700 px-4 py-2.5 text-xs font-bold text-white transition hover:bg-emerald-800 active:scale-[0.98]">Save preferences</button>
              </div>
            ) : (
              <div className="space-y-3 text-xs leading-relaxed text-gray-700">
                <p>This notice explains the basic information BoardMate uses to provide accommodation listings, roommate posts, messaging, account verification, and safety tools.</p>
                <section><h3 className="font-bold text-gray-900">Information and use</h3><p>BoardMate processes account and profile details, content you submit, and messages needed to provide these features, protect users, and support moderation.</p></section>
                <section><h3 className="font-bold text-gray-900">Storage and sharing</h3><p>App data is stored in the Supabase project configured for BoardMate. Private messages and verification documents are restricted to their intended participants or authorized administrators.</p></section>
                <section><h3 className="font-bold text-gray-900">Your choices</h3><p>You can manage profile visibility and optional browser storage in settings. You can also contact the BoardMate administrators through the in-app problem report tools.</p></section>
                <p className="rounded-lg bg-amber-50 p-3 text-[10px]">This is a basic in-app privacy notice, not legal advice. Contact the BoardMate administrator for questions about data requests.</p>
                <button type="button" onClick={() => setLegalDialog(null)} className="w-full rounded-xl bg-emerald-700 px-4 py-2.5 text-xs font-bold text-white transition hover:bg-emerald-800 active:scale-[0.98]">Close</button>
              </div>
            )}
          </section>
        </div>
      )}
      <ErrorDialog message={cookieSettingsError} onClose={() => setCookieSettingsError('')} />

    </AppViewport>
  );
}
