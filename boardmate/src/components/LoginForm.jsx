import { signUpWithDuplicateValidation } from '../lib/registration';
import { registrationErrorMessage } from '../lib/registrationErrors';
import useAppDialog from '../hooks/useAppDialog';
import { useState } from 'react';
import { supabase } from '../supabaseClient';
import { signInWithEmail } from '../lib/authentication';
import { getAuthenticationErrorMessage } from '../lib/authErrors';
import PasswordRecovery from './PasswordRecovery';

export default function LoginForm({ role, onNavigate }) {
  const { notify } = useAppDialog();
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [recoveryOpen, setRecoveryOpen] = useState(false);

  const handleAuth = async (e) => {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setErrorMessage('');

    try {
      if (isSignUp) {
        // 1. SUPABASE SIGN UP (Kasama ang role sa user metadata)
        const { data, error } = await signUpWithDuplicateValidation(supabase, {
          email: email.trim().toLowerCase(),
          password,
          options: {
            data: {
              full_name: fullName.trim(),
              role: role.toUpperCase(), // 'RENTER' o 'LANDLORD'
            },
          },
        });

        if (error) throw error;

        if (Array.isArray(data?.user?.identities) && data.user.identities.length === 0 && !data.session) throw Object.assign(new Error('This email address is already registered.'), { code: 'email_exists' });
        if (!data?.user) throw new Error('Registration could not be confirmed. Try signing in before registering again.');
        setPassword('');
        const { error: logoutError } = await supabase.auth.signOut({ scope: 'local' });
        if (logoutError) throw logoutError;
        setIsSignUp(false);
        notify('Account created. Sign in to submit your government ID and selfie for administrator approval.');
      } else {
        // 2. SUPABASE LOG IN
        const { data, error } = await signInWithEmail(email, password);

        if (error) throw error;

        // Kunin ang user role mula sa user metadata o fallback sa binuksang role
        const userRole = data.user?.user_metadata?.role || role.toUpperCase();

        if (userRole === 'LANDLORD' || userRole === 'OWNER') {
          onNavigate('OWNER_DASHBOARD');
        } else {
          onNavigate('RENTER_DASHBOARD');
        }
      }
    } catch (error) {
      if (isSignUp) notify(registrationErrorMessage(error), 'Registration error');
      else setErrorMessage(getAuthenticationErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };


  if (recoveryOpen) return <PasswordRecovery initialEmail={email} onBack={() => setRecoveryOpen(false)} onComplete={message => {
    setRecoveryOpen(false); setPassword(''); setIsSignUp(false); notify(message);
  }} />;

  return (
    <div className="flex flex-col justify-center h-full px-6 py-8">
      <div className="text-center mb-6">
        <h2 className="text-2xl font-black text-gray-800">
          {isSignUp ? 'Create Account' : 'Welcome Back!'}
        </h2>
        <p className="text-xs text-gray-500 font-bold uppercase tracking-wider mt-1">
          Logging in as: <span className="text-[#3D6B4A]">{role}</span>
        </p>
      </div>

      {errorMessage && (
        <div className="bg-red-100 border border-red-400 text-red-700 text-xs px-3 py-2 rounded-xl mb-4 text-center">
          {errorMessage}
        </div>
      )}

      <form onSubmit={handleAuth} className="space-y-4">
        {isSignUp && (
          <div>
            <label className="text-xs font-bold text-gray-700 block mb-1">Full Name</label>
            <input
              type="text"
              required
              placeholder="e.g. Juan Dela Cruz"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-xs focus:outline-none focus:border-emerald-600 bg-white"
            />
          </div>
        )}

        <div>
          <label className="text-xs font-bold text-gray-700 block mb-1">Email address</label>
          <input
            type="email"
            required
            placeholder="enter your email address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-xs focus:outline-none focus:border-emerald-600 bg-white"
          />
        </div>

        <div>
          <label className="text-xs font-bold text-gray-700 block mb-1">Password</label>
          <input
            type="password"
            required
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-xs focus:outline-none focus:border-emerald-600 bg-white"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full py-3 bg-[#3D6B4A] hover:bg-emerald-900 text-white font-bold rounded-xl text-xs shadow-md transition cursor-pointer"
        >
          {loading ? 'Processing...' : isSignUp ? 'Sign Up' : 'Log In'}
        </button>
      </form>

      <div className="mt-4 text-center space-y-2">
        {!isSignUp && <button type="button" onClick={() => setRecoveryOpen(true)} className="block mx-auto text-xs text-emerald-800 underline">Forgot password?</button>}
        <button
          type="button"
          onClick={() => {
            setIsSignUp(!isSignUp);
            setErrorMessage('');
          }}
          className="text-xs text-emerald-800 font-bold hover:underline"
        >
          {isSignUp ? 'Already have an account? Log In' : "Don't have an account? Sign Up"}
        </button>

        <div>
          <button
            type="button"
            onClick={() => onNavigate('ROLE_SELECT')}
            className="text-xs text-gray-400 hover:text-gray-600 font-medium"
          >
            ← Back to Role Selection
          </button>
        </div>
      </div>
    </div>
  );
}
