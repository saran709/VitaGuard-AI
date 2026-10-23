import React, { useState } from 'react';
import { KeyRound, Lock, LogIn, ShieldAlert, UserPlus } from 'lucide-react';
import { evaluateProtectedRouteAccess, useAuth } from '../context/AuthContext';

type AuthMode = 'login' | 'register' | 'reset';

export const AuthGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const {
    user,
    authReady,
    authLoading,
    authError,
    signInEmail,
    registerEmail,
    sendResetEmail,
    signInLocalSandbox,
    clearAuthError,
  } = useAuth();

  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [resetSuccess, setResetSuccess] = useState<string | null>(null);

  const routeAccess = evaluateProtectedRouteAccess(authReady, user);

  if (routeAccess.reason === 'loading') {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-6">
        <div className="bg-white border border-slate-200 rounded-xl p-8 max-w-md w-full text-center space-y-3">
          <div className="text-base font-bold text-slate-900">
            VitaGuard AI — Initializing Security Context
          </div>
          <p className="text-xs text-slate-500">
            Verifying Firebase Authentication session and Firestore rules connection...
          </p>
        </div>
      </div>
    );
  }

  const switchMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    clearAuthError();
    setResetSuccess(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearAuthError();
    setResetSuccess(null);

    try {
      if (mode === 'login') {
        await signInEmail(email, password);
      } else if (mode === 'register') {
        await registerEmail(email, password, displayName);
      } else if (mode === 'reset') {
        const msg = await sendResetEmail(email);
        setResetSuccess(msg);
      }
    } catch {
      // Error is stored in authError state
    }
  };

  // Protected Route Gate: When logged out (user === null), require authentication to access the dashboard
  if (!routeAccess.allowed) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex flex-col justify-between">
        {/* Simulation Mode Banner */}
        <div className="bg-amber-50 border-b border-amber-200 px-6 py-2.5">
          <div className="max-w-[1440px] mx-auto flex items-center justify-between gap-2 text-xs text-amber-950">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-amber-700 shrink-0" aria-hidden="true" />
              <span className="font-bold">SIMULATION MODE</span>
              <span aria-hidden="true">·</span>
              <span>
                VitaGuard AI — Protected Route & Isolated User Storage (`vitaguard-ai-65bbb`)
              </span>
            </div>
          </div>
        </div>

        <div className="flex-1 flex items-center justify-center p-6">
          <div className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8 max-w-md w-full space-y-6">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono text-slate-500">
                  Protected Safety Workspace
                </span>
                <Lock className="w-4 h-4 text-slate-700" aria-hidden="true" />
              </div>
              <h1 className="text-xl font-bold text-slate-900">
                {mode === 'login'
                  ? 'Sign In to VitaGuard AI'
                  : mode === 'register'
                  ? 'Create VitaGuard AI Account'
                  : 'Reset Account Password'}
              </h1>
              <p className="text-xs text-slate-500">
                {mode === 'login'
                  ? 'Sign in with your Email and Password to load your isolated risk assessments, alert history, settings, and emergency contacts.'
                  : mode === 'register'
                  ? 'Register a new user account to initialize an isolated /users/{uid} profile and settings workspace.'
                  : 'Enter your account email address to receive a password reset link.'}
              </p>
            </div>

            {/* Mode Switcher Tabs */}
            <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-lg text-xs font-medium">
              <button
                type="button"
                onClick={() => switchMode('login')}
                className={`py-2 rounded-md transition-colors ${
                  mode === 'login'
                    ? 'bg-white text-slate-900 shadow-xs font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => switchMode('register')}
                className={`py-2 rounded-md transition-colors ${
                  mode === 'register'
                    ? 'bg-white text-slate-900 shadow-xs font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Register
              </button>
              <button
                type="button"
                onClick={() => switchMode('reset')}
                className={`py-2 rounded-md transition-colors ${
                  mode === 'reset'
                    ? 'bg-white text-slate-900 shadow-xs font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Reset Password
              </button>
            </div>

            {authError && (
              <div
                role="alert"
                className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800 space-y-1"
              >
                <div className="font-semibold">Authentication Notice</div>
                <div>{authError}</div>
              </div>
            )}

            {resetSuccess && (
              <div
                role="status"
                className="p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800"
              >
                {resetSuccess}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              {mode === 'register' && (
                <div>
                  <label
                    htmlFor="auth-display-name"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Display Name
                  </label>
                  <input
                    id="auth-display-name"
                    type="text"
                    required
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Dr. Sarah Chen"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900"
                  />
                </div>
              )}

              <div>
                <label
                  htmlFor="auth-email"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Email Address
                </label>
                <input
                  id="auth-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="operator@example.com"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900"
                />
              </div>

              {mode !== 'reset' && (
                <div>
                  <label
                    htmlFor="auth-password"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Password
                  </label>
                  <input
                    id="auth-password"
                    type="password"
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 6 characters"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900"
                  />
                </div>
              )}

              <button
                type="submit"
                disabled={authLoading}
                className="w-full py-2.5 px-4 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-50 transition-colors inline-flex items-center justify-center gap-2"
              >
                {mode === 'login' ? (
                  <>
                    <LogIn className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>{authLoading ? 'Signing In...' : 'Sign In'}</span>
                  </>
                ) : mode === 'register' ? (
                  <>
                    <UserPlus className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>{authLoading ? 'Creating Account...' : 'Register Account'}</span>
                  </>
                ) : (
                  <>
                    <KeyRound className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>{authLoading ? 'Sending Reset Link...' : 'Send Password Reset Email'}</span>
                  </>
                )}
              </button>
            </form>

            <div className="pt-4 border-t border-slate-200 space-y-2.5">
              <button
                type="button"
                onClick={() => signInLocalSandbox('operator@vitaguard.demo')}
                className="w-full py-2 px-4 text-xs font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors"
              >
                Quick Sign In as Default Operator (`operator@vitaguard.demo`)
              </button>
              <p className="text-[11px] text-slate-500 text-center">
                All user records are strictly isolated per UID (`users/&#123;uid&#125;`).
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};
