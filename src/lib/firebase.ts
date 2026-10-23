import { FirebaseApp, getApps, initializeApp } from 'firebase/app';
import {
  Auth,
  connectAuthEmulator,
  getAuth,
} from 'firebase/auth';
import {
  connectFirestoreEmulator,
  doc,
  Firestore,
  getDocFromServer,
  getFirestore,
} from 'firebase/firestore';
import {
  connectFunctionsEmulator,
  Functions,
  getFunctions,
} from 'firebase/functions';
import { FirestoreErrorInfo, OperationType } from '../types/safety';

const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env || {};

export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY || 'AIzaSyBmTMZ6E2gybAphMGv7ACoqlTsTP4HBLG4',
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || 'vitaguard-ai-65bbb.firebaseapp.com',
  projectId: env.VITE_FIREBASE_PROJECT_ID || 'vitaguard-ai-65bbb',
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || 'vitaguard-ai-65bbb.firebasestorage.app',
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || '232804582617',
  appId: env.VITE_FIREBASE_APP_ID || '1:232804582617:web:0955df3cd0e8eef51d6ac8',
  measurementId: env.VITE_FIREBASE_MEASUREMENT_ID || 'G-PH2637L62W',
};

export const app: FirebaseApp =
  getApps().length > 0 ? getApps()[0] : initializeApp(firebaseConfig);

export const auth: Auth = getAuth(app);
export const db: Firestore = getFirestore(app);
export const functions: Functions = getFunctions(app);

let emulatorsConnected = false;

if (env.VITE_USE_FIREBASE_EMULATOR === 'true' && !emulatorsConnected) {
  emulatorsConnected = true;
  const authHost = env.VITE_FIREBASE_AUTH_EMULATOR_HOST || 'localhost:9099';
  const [fsHost, fsPortStr] = (
    env.VITE_FIREBASE_FIRESTORE_EMULATOR_HOST || 'localhost:8080'
  ).split(':');
  const [fnHost, fnPortStr] = (
    env.VITE_FIREBASE_FUNCTIONS_EMULATOR_HOST || 'localhost:5001'
  ).split(':');

  connectAuthEmulator(auth, `http://${authHost}`, { disableWarnings: true });
  connectFirestoreEmulator(db, fsHost, Number(fsPortStr || 8080));
  connectFunctionsEmulator(functions, fnHost, Number(fnPortStr || 5001));
}

/**
 * Validates connection to Firestore on boot using getDocFromServer.
 */
export async function testFirestoreConnection(): Promise<{
  reachable: boolean;
  offlineMessage?: string;
}> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return { reachable: true };
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
      return {
        reachable: false,
        offlineMessage: 'Firestore client is offline. Operating with local cache.',
      };
    }
    // Permission denied on /test/connection is expected due to default-deny security rules,
    // which confirms the Firestore backend is online and enforcing rules!
    return { reachable: true };
  }
}

/**
 * Mandatory structured Firestore error handler conforming to FirestoreErrorInfo.
 */
export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const currentUser = auth.currentUser;
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: currentUser?.uid ?? null,
      email: currentUser?.email ?? null,
      emailVerified: currentUser?.emailVerified ?? null,
      isAnonymous: currentUser?.isAnonymous ?? null,
      tenantId: currentUser?.tenantId ?? null,
      providerInfo:
        currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}
