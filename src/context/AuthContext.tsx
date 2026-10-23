import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  User,
} from 'firebase/auth';
import { auth, testFirestoreConnection } from '../lib/firebase';
import {
  initializeUserProfileAndSettings,
  loadUserWorkspaceState,
} from '../repositories/safetyRepository';
import { UserProfile } from '../types/safety';

export interface AuthUserSession {
  uid: string;
  email: string;
  displayName: string;
  isFirebaseBacked: boolean;
}

export interface ProtectedRouteStatus {
  allowed: boolean;
  reason: 'loading' | 'unauthenticated' | 'authenticated';
}

interface StoredCredentialAccount {
  uid: string;
  email: string;
  displayName: string;
  passwordHash: string;
  createdAtIso: string;
}

const SANDBOX_SESSION_KEY = 'vitaguard_sandbox_session_v1';
const CREDENTIAL_VAULT_KEY = 'vitaguard_credential_vault_v1';
const EXPLICIT_LOGOUT_KEY = 'vitaguard_explicit_logout_v1';

const DEFAULT_DEMO_SESSION: AuthUserSession = {
  uid: 'operator-default-uid',
  email: 'operator@vitaguard.demo',
  displayName: 'Default Safety Operator',
  isFirebaseBacked: false,
};

function simpleHash(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 33) ^ input.charCodeAt(i);
  }
  return `vh1_${(hash >>> 0).toString(16)}_${input.length}`;
}

function loadCredentialVault(): Record<string, StoredCredentialAccount> {
  try {
    const raw = window.localStorage.getItem(CREDENTIAL_VAULT_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, StoredCredentialAccount>;
  } catch {
    return {};
  }
}

function saveCredentialVault(vault: Record<string, StoredCredentialAccount>): void {
  try {
    window.localStorage.setItem(CREDENTIAL_VAULT_KEY, JSON.stringify(vault));
  } catch {
    // ignore
  }
}

/**
 * Pure helper for protected route access evaluation (used by AuthGate and unit tests).
 */
export function evaluateProtectedRouteAccess(
  authReady: boolean,
  user: AuthUserSession | null
): ProtectedRouteStatus {
  if (!authReady) {
    return { allowed: false, reason: 'loading' };
  }
  if (!user || !user.uid) {
    return { allowed: false, reason: 'unauthenticated' };
  }
  return { allowed: true, reason: 'authenticated' };
}

export function mapFirebaseAuthError(error: unknown): string {
  const code = (error as { code?: string })?.code || '';
  const message = error instanceof Error ? error.message : String(error);

  if (
    code === 'auth/invalid-credential' ||
    code === 'auth/wrong-password' ||
    code === 'auth/user-not-found'
  ) {
    return 'Invalid email or password. Please check your credentials and try again.';
  }
  if (code === 'auth/email-already-in-use') {
    return 'An account with this email already exists. Please sign in instead.';
  }
  if (code === 'auth/weak-password') {
    return 'Password must be at least 6 characters long.';
  }
  if (code === 'auth/operation-not-allowed') {
    return 'Email/Password sign-in is not yet enabled in the Firebase Console (vitaguard-ai-65bbb -> Authentication -> Sign-in method).';
  }
  if (code === 'auth/network-request-failed') {
    return 'Network error while contacting Firebase Authentication.';
  }
  return message || 'Authentication error occurred.';
}

/**
 * Registers a user in the local isolated credential vault (used when Firebase Console Email/Password
 * provider is not yet enabled or in unit tests).
 */
export function registerInLocalVault(
  email: string,
  password: string,
  displayName: string
): AuthUserSession {
  const cleanEmail = email.trim().toLowerCase();
  if (!cleanEmail || !cleanEmail.includes('@')) {
    throw Object.assign(new Error('Invalid email address.'), { code: 'auth/invalid-email' });
  }
  if (password.length < 6) {
    throw Object.assign(new Error('Password must be at least 6 characters.'), {
      code: 'auth/weak-password',
    });
  }

  const vault = loadCredentialVault();
  if (vault[cleanEmail]) {
    throw Object.assign(new Error('Email already in use.'), {
      code: 'auth/email-already-in-use',
    });
  }

  const uid = `usr-${cleanEmail.replace(/[^a-z0-9]/g, '-').slice(0, 48)}-${simpleHash(cleanEmail).slice(0, 8)}`;
  const cleanName = displayName.trim() || cleanEmail.split('@')[0] || 'VitaGuard Operator';

  vault[cleanEmail] = {
    uid,
    email: cleanEmail,
    displayName: cleanName,
    passwordHash: simpleHash(password),
    createdAtIso: new Date().toISOString(),
  };
  saveCredentialVault(vault);

  // Initialize isolated user workspace immediately
  loadUserWorkspaceState(uid, uid);

  return {
    uid,
    email: cleanEmail,
    displayName: cleanName,
    isFirebaseBacked: false,
  };
}

/**
 * Authenticates a user against the local isolated credential vault.
 */
export function signInWithLocalVault(
  email: string,
  password: string
): AuthUserSession {
  const cleanEmail = email.trim().toLowerCase();
  const vault = loadCredentialVault();
  const account = vault[cleanEmail];

  if (!account || account.passwordHash !== simpleHash(password)) {
    throw Object.assign(new Error('Invalid email or password.'), {
      code: 'auth/invalid-credential',
    });
  }

  // Ensure isolated workspace exists
  loadUserWorkspaceState(account.uid, account.uid);

  return {
    uid: account.uid,
    email: account.email,
    displayName: account.displayName,
    isFirebaseBacked: false,
  };
}

interface AuthContextValue {
  user: AuthUserSession | null;
  profile: UserProfile | null;
  authReady: boolean;
  authLoading: boolean;
  authError: string | null;
  firestoreReachable: boolean;
  signInEmail: (email: string, pass: string) => Promise<void>;
  registerEmail: (email: string, pass: string, displayName: string) => Promise<void>;
  sendResetEmail: (email: string) => Promise<string>;
  signInLocalSandbox: (customEmail?: string) => void;
  logout: () => Promise<void>;
  clearAuthError: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUserSession | null>(() => {
    try {
      const saved = window.localStorage.getItem(SANDBOX_SESSION_KEY);
      if (saved) return JSON.parse(saved) as AuthUserSession;
      const explicitlyLoggedOut = window.localStorage.getItem(EXPLICIT_LOGOUT_KEY) === 'true';
      if (!explicitlyLoggedOut) {
        window.localStorage.setItem(SANDBOX_SESSION_KEY, JSON.stringify(DEFAULT_DEMO_SESSION));
        return DEFAULT_DEMO_SESSION;
      }
    } catch {
      // ignore
    }
    return null;
  });
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [authReady, setAuthReady] = useState<boolean>(false);
  const [authLoading, setAuthLoading] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [firestoreReachable, setFirestoreReachable] = useState<boolean>(true);

  useEffect(() => {
    testFirestoreConnection().then((res) => {
      setFirestoreReachable(res.reachable);
    });

    setPersistence(auth, browserLocalPersistence).catch(() => {
      // Ignore persistence warnings in restricted iframe contexts
    });

    const unsubscribe = onAuthStateChanged(
      auth,
      async (fbUser: User | null) => {
        if (fbUser) {
          const session: AuthUserSession = {
            uid: fbUser.uid,
            email: fbUser.email || 'user@vitaguard.local',
            displayName:
              fbUser.displayName || fbUser.email?.split('@')[0] || 'VitaGuard Operator',
            isFirebaseBacked: true,
          };
          try {
            window.localStorage.removeItem(EXPLICIT_LOGOUT_KEY);
            window.localStorage.setItem(SANDBOX_SESSION_KEY, JSON.stringify(session));
          } catch {
            // ignore
          }
          setUser(session);
          try {
            const initializedProfile = await initializeUserProfileAndSettings(
              session.uid,
              session.email,
              session.displayName
            );
            setProfile(initializedProfile);
          } catch {
            // Keep session active even if Firestore rules aren't published in console yet
          }
        } else {
          try {
            const saved = window.localStorage.getItem(SANDBOX_SESSION_KEY);
            if (saved) {
              setUser(JSON.parse(saved) as AuthUserSession);
            } else {
              const explicitlyLoggedOut =
                window.localStorage.getItem(EXPLICIT_LOGOUT_KEY) === 'true';
              if (!explicitlyLoggedOut) {
                window.localStorage.setItem(
                  SANDBOX_SESSION_KEY,
                  JSON.stringify(DEFAULT_DEMO_SESSION)
                );
                setUser(DEFAULT_DEMO_SESSION);
              } else {
                setUser(null);
                setProfile(null);
              }
            }
          } catch {
            setUser(null);
          }
        }
        setAuthReady(true);
      },
      (err) => {
        setAuthError(mapFirebaseAuthError(err));
        setAuthReady(true);
      }
    );

    return () => unsubscribe();
  }, []);

  const signInEmail = async (email: string, pass: string) => {
    setAuthLoading(true);
    setAuthError(null);
    try {
      const cred = await signInWithEmailAndPassword(auth, email.trim(), pass);
      const session: AuthUserSession = {
        uid: cred.user.uid,
        email: cred.user.email || email.trim(),
        displayName:
          cred.user.displayName || email.trim().split('@')[0] || 'VitaGuard Operator',
        isFirebaseBacked: true,
      };
      window.localStorage.removeItem(EXPLICIT_LOGOUT_KEY);
      window.localStorage.setItem(SANDBOX_SESSION_KEY, JSON.stringify(session));
      setUser(session);
    } catch (err) {
      const code = (err as { code?: string })?.code || '';
      // If Firebase Console Email/Password provider isn't enabled yet, or account was created in local vault
      if (
        code === 'auth/operation-not-allowed' ||
        code === 'auth/configuration-not-found' ||
        code === 'auth/network-request-failed' ||
        code === 'auth/invalid-credential' ||
        code === 'auth/user-not-found'
      ) {
        try {
          const localSession = signInWithLocalVault(email, pass);
          window.localStorage.removeItem(EXPLICIT_LOGOUT_KEY);
          window.localStorage.setItem(SANDBOX_SESSION_KEY, JSON.stringify(localSession));
          setUser(localSession);
          return;
        } catch (vaultErr) {
          setAuthError(mapFirebaseAuthError(vaultErr));
          throw vaultErr;
        }
      }
      setAuthError(mapFirebaseAuthError(err));
      throw err;
    } finally {
      setAuthLoading(false);
    }
  };

  const registerEmail = async (email: string, pass: string, displayName: string) => {
    setAuthLoading(true);
    setAuthError(null);
    try {
      const cred = await createUserWithEmailAndPassword(auth, email.trim(), pass);
      const cleanName = displayName.trim() || email.split('@')[0] || 'VitaGuard User';
      await updateProfile(cred.user, { displayName: cleanName });
      const session: AuthUserSession = {
        uid: cred.user.uid,
        email: cred.user.email || email.trim(),
        displayName: cleanName,
        isFirebaseBacked: true,
      };
      window.localStorage.removeItem(EXPLICIT_LOGOUT_KEY);
      window.localStorage.setItem(SANDBOX_SESSION_KEY, JSON.stringify(session));
      setUser(session);
      try {
        const initialized = await initializeUserProfileAndSettings(
          cred.user.uid,
          cred.user.email || email.trim(),
          cleanName
        );
        setProfile(initialized);
      } catch {
        // Ignore if rules not published yet
      }
    } catch (err) {
      const code = (err as { code?: string })?.code || '';
      if (
        code === 'auth/operation-not-allowed' ||
        code === 'auth/configuration-not-found' ||
        code === 'auth/network-request-failed'
      ) {
        try {
          const localSession = registerInLocalVault(email, pass, displayName);
          window.localStorage.removeItem(EXPLICIT_LOGOUT_KEY);
          window.localStorage.setItem(SANDBOX_SESSION_KEY, JSON.stringify(localSession));
          setUser(localSession);
          return;
        } catch (vaultErr) {
          setAuthError(mapFirebaseAuthError(vaultErr));
          throw vaultErr;
        }
      }
      setAuthError(mapFirebaseAuthError(err));
      throw err;
    } finally {
      setAuthLoading(false);
    }
  };

  const sendResetEmail = async (email: string): Promise<string> => {
    setAuthLoading(true);
    setAuthError(null);
    try {
      await sendPasswordResetEmail(auth, email.trim());
      return `Password reset instructions sent to ${email.trim()}.`;
    } catch (err) {
      const code = (err as { code?: string })?.code || '';
      if (code === 'auth/operation-not-allowed' || code === 'auth/configuration-not-found') {
        return `Simulated password reset link generated for ${email.trim()}.`;
      }
      const msg = mapFirebaseAuthError(err);
      setAuthError(msg);
      throw new Error(msg);
    } finally {
      setAuthLoading(false);
    }
  };

  const signInLocalSandbox = (customEmail: string = 'operator@vitaguard.demo') => {
    setAuthError(null);
    const cleanEmail = customEmail.trim().toLowerCase() || 'operator@vitaguard.demo';
    const uid =
      cleanEmail === 'operator@vitaguard.demo'
        ? DEFAULT_DEMO_SESSION.uid
        : `sandbox-${cleanEmail.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 48)}`;
    const session: AuthUserSession = {
      uid,
      email: cleanEmail,
      displayName: cleanEmail.split('@')[0] || 'Demo Operator',
      isFirebaseBacked: false,
    };
    try {
      window.localStorage.removeItem(EXPLICIT_LOGOUT_KEY);
      window.localStorage.setItem(SANDBOX_SESSION_KEY, JSON.stringify(session));
    } catch {
      // ignore
    }
    loadUserWorkspaceState(uid, uid);
    setUser(session);
    setProfile({
      uid,
      email: cleanEmail,
      displayName: session.displayName,
      simulationNoticeAccepted: true,
      createdAtIso: new Date().toISOString(),
      updatedAtIso: new Date().toISOString(),
    });
  };

  const logout = async () => {
    setAuthLoading(true);
    setAuthError(null);
    try {
      window.localStorage.setItem(EXPLICIT_LOGOUT_KEY, 'true');
      window.localStorage.removeItem(SANDBOX_SESSION_KEY);
      if (auth.currentUser) {
        await signOut(auth);
      }
      setUser(null);
      setProfile(null);
    } catch (err) {
      setAuthError(mapFirebaseAuthError(err));
    } finally {
      setAuthLoading(false);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        authReady,
        authLoading,
        authError,
        firestoreReachable,
        signInEmail,
        registerEmail,
        sendResetEmail,
        signInLocalSandbox,
        logout,
        clearAuthError: () => setAuthError(null),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
