import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  Unsubscribe,
  updateDoc,
  where,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import {
  acknowledgeAlertIdempotent,
  canEscalateAlert,
  computeEscalationStage,
  resolveAlert,
} from '../engine/alertManager';
import {
  DEFAULT_THRESHOLDS,
  RULE_ENGINE_VERSION,
  SIMULATION_PRESETS,
} from '../engine/riskEngine';
import { auth, db, functions, handleFirestoreError } from '../lib/firebase';
import {
  AlertLifecycleStatus,
  EmergencyContact,
  EnvironmentReadings,
  EscalationPolicyConfig,
  EscalationStage,
  EscalationTaskRecord,
  NormalizedObservation,
  NotificationAttemptRecord,
  OperationType,
  PersistedAIExplanation,
  RiskAssessment,
  RiskLevel,
  RiskThresholds,
  SafetyAlert,
  SafetyEvent,
  TelemetryPoint,
  UserProfile,
  VitalReadings,
} from '../types/safety';
import { DEFAULT_ESCALATION_POLICY } from '../services/notificationEngine';

const VALID_ID_REGEX = /^[a-zA-Z0-9_\-]+$/;

export function sanitizeId(rawId: string): string {
  const cleaned = rawId.replace(/[^a-zA-Z0-9_\-]/g, '-').slice(0, 128);
  if (!cleaned || !VALID_ID_REGEX.test(cleaned)) {
    throw new Error(`Invalid document identifier: "${rawId}"`);
  }
  return cleaned;
}

function timestampToIso(val: unknown, fallbackIso: string = new Date().toISOString()): string {
  if (val instanceof Timestamp) {
    return val.toDate().toISOString();
  }
  if (typeof val === 'string' && val.length > 0) {
    return val;
  }
  return fallbackIso;
}

export interface PersistedUserWorkspace {
  uid: string;
  ruleVersion: string;
  vitals: VitalReadings;
  environment: EnvironmentReadings;
  activePresetId: string | null;
  thresholds: RiskThresholds;
  contacts: EmergencyContact[];
  activeAlert: SafetyAlert | null;
  alertHistory: SafetyAlert[];
  events: SafetyEvent[];
  telemetryHistory: TelemetryPoint[];
  lastAssessment?: RiskAssessment;
  aiExplanation?: PersistedAIExplanation | null;
  escalationPolicy?: EscalationPolicyConfig;
  escalationTasks?: EscalationTaskRecord[];
  notificationAttempts?: NotificationAttemptRecord[];
  normalizedObservations?: NormalizedObservation[];
  updatedAtIso: string;
}

const WORKSPACE_STORAGE_PREFIX = 'vitaguard_user_workspace_v1:';

const DEFAULT_DEMO_CONTACTS: EmergencyContact[] = [
  {
    id: 'contact-1',
    name: 'Elena Vance',
    relationship: 'Primary Partner / Emergency Proxy',
    phoneDisplay: '+1 (555) 014-8921',
    email: 'elena.vance.demo@example.org',
    isPrimary: true,
    notifyOnLevel: RiskLevel.HIGH,
    verificationStatus: 'VERIFIED',
    consentGranted: true,
    verifiedAtIso: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'contact-2',
    name: 'Marcus Chen',
    relationship: 'Field Safety Coordinator',
    phoneDisplay: '+1 (555) 018-4410',
    email: 'm.chen.demo@example.org',
    isPrimary: false,
    notifyOnLevel: RiskLevel.CRITICAL,
    verificationStatus: 'PENDING_CODE',
    consentGranted: false,
  },
];

export function createInitialUserWorkspace(uid: string): PersistedUserWorkspace {
  const cleanUid = sanitizeId(uid);
  const now = new Date();
  const initialHistory: TelemetryPoint[] = Array.from({ length: 8 }, (_, idx) => {
    const t = new Date(now.getTime() - (7 - idx) * 10000);
    return {
      timestamp: t.toISOString(),
      timeLabel: t.toLocaleTimeString([], {
        minute: '2-digit',
        second: '2-digit',
      }),
      heartRateBpm: 70 + (idx % 3),
      oxygenSaturationPct: 98,
      bodyTempCelsius: 36.8,
      ambientTempCelsius: 22,
      riskScore: 8,
      riskLevel: RiskLevel.LOW,
    };
  });

  return {
    uid: cleanUid,
    ruleVersion: RULE_ENGINE_VERSION,
    vitals: { ...SIMULATION_PRESETS[0].vitals },
    environment: { ...SIMULATION_PRESETS[0].environment },
    activePresetId: SIMULATION_PRESETS[0].id,
    thresholds: structuredClone(DEFAULT_THRESHOLDS),
    contacts: structuredClone(DEFAULT_DEMO_CONTACTS),
    activeAlert: null,
    alertHistory: [],
    events: [
      {
        id: 'evt-init',
        timestamp: now.toISOString(),
        type: 'assessment_change',
        riskLevel: RiskLevel.LOW,
        title: 'VitaGuard AI Workspace Initialized',
        detail: `Loaded isolated safety workspace for UID ${cleanUid}. Rule engine ${RULE_ENGINE_VERSION} active.`,
      },
    ],
    telemetryHistory: initialHistory,
    escalationPolicy: structuredClone(DEFAULT_ESCALATION_POLICY),
    escalationTasks: [],
    notificationAttempts: [],
    updatedAtIso: now.toISOString(),
  };
}

/**
 * Loads the persisted workspace state for a specific authenticated user (`uid`).
 * Strictly verifies that `actingUid === targetUid` to enforce user data isolation.
 */
export function loadUserWorkspaceState(
  actingUid: string | null,
  targetUid: string
): PersistedUserWorkspace {
  const path = `users/${targetUid}`;
  if (!actingUid) {
    handleFirestoreError(new Error('PERMISSION_DENIED: Unauthenticated read.'), OperationType.GET, path);
  }
  if (actingUid !== targetUid) {
    handleFirestoreError(
      new Error(`PERMISSION_DENIED: User ${actingUid} cannot access user ${targetUid} workspace.`),
      OperationType.GET,
      path
    );
  }

  const cleanUid = sanitizeId(targetUid);
  try {
    const raw = window.localStorage.getItem(`${WORKSPACE_STORAGE_PREFIX}${cleanUid}`);
    if (raw) {
      const parsed = JSON.parse(raw) as PersistedUserWorkspace;
      if (parsed && parsed.uid === cleanUid) {
        return parsed;
      }
    }
  } catch {
    // Fallback to initial workspace
  }
  const initial = createInitialUserWorkspace(cleanUid);
  saveUserWorkspaceState(cleanUid, cleanUid, initial);
  return initial;
}

/**
 * Persists the user's workspace state (settings, contacts, latest readings, risk assessments,
 * activeAlert, alertHistory, and audit events) scoped strictly to `targetUid`.
 */
export function saveUserWorkspaceState(
  actingUid: string | null,
  targetUid: string,
  workspace: PersistedUserWorkspace
): void {
  const path = `users/${targetUid}`;
  if (!actingUid) {
    handleFirestoreError(new Error('PERMISSION_DENIED: Unauthenticated write.'), OperationType.WRITE, path);
  }
  if (actingUid !== targetUid || workspace.uid !== sanitizeId(targetUid)) {
    handleFirestoreError(
      new Error(`PERMISSION_DENIED: User ${actingUid} cannot modify user ${targetUid} workspace.`),
      OperationType.WRITE,
      path
    );
  }

  const cleanUid = sanitizeId(targetUid);
  try {
    window.localStorage.setItem(
      `${WORKSPACE_STORAGE_PREFIX}${cleanUid}`,
      JSON.stringify({
        ...workspace,
        uid: cleanUid,
        updatedAtIso: new Date().toISOString(),
      })
    );
  } catch {
    // Ignore storage quota errors
  }
}

/**
 * Deduplication cache to prevent duplicate rapid writes of identical observations/assessments.
 */
const lastWriteSignatures = new Map<string, string>();

export function shouldSkipDuplicateWrite(key: string, signature: string): boolean {
  const prev = lastWriteSignatures.get(key);
  if (prev === signature) {
    return true;
  }
  lastWriteSignatures.set(key, signature);
  return false;
}

export function clearWriteDeduplicationCache(): void {
  lastWriteSignatures.clear();
}

/**
 * Initializes `/users/{uid}` and `/users/{uid}/settings/default` for an authenticated user.
 */
export async function initializeUserProfileAndSettings(
  uid: string,
  email: string,
  displayName: string
): Promise<UserProfile> {
  const cleanUid = sanitizeId(uid);
  const nowIso = new Date().toISOString();
  const cleanEmail = (email || 'user@example.com').trim().slice(0, 254);
  const cleanName = (displayName || cleanEmail.split('@')[0] || 'VitaGuard User')
    .trim()
    .slice(0, 100);

  if (!auth.currentUser || auth.currentUser.uid !== cleanUid) {
    return {
      uid: cleanUid,
      email: cleanEmail,
      displayName: cleanName,
      simulationNoticeAccepted: true,
      createdAtIso: nowIso,
      updatedAtIso: nowIso,
    };
  }

  const profilePath = `users/${cleanUid}`;
  const profileRef = doc(db, 'users', cleanUid);

  try {
    const existingSnap = await getDoc(profileRef);

    if (!existingSnap.exists()) {
      await setDoc(profileRef, {
        uid: cleanUid,
        email: cleanEmail,
        displayName: cleanName,
        simulationNoticeAccepted: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    const settingsRef = doc(db, 'users', cleanUid, 'settings', 'default');
    const settingsSnap = await getDoc(settingsRef);
    if (!settingsSnap.exists()) {
      await saveUserSettingsToFirestore(cleanUid, DEFAULT_THRESHOLDS);
    }

    return {
      uid: cleanUid,
      email: cleanEmail,
      displayName: cleanName,
      simulationNoticeAccepted: true,
      createdAtIso: nowIso,
      updatedAtIso: nowIso,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, profilePath);
  }
}

/**
 * Persists user-configured risk thresholds to `/users/{uid}/settings/default`.
 */
export async function saveUserSettingsToFirestore(
  uid: string,
  thresholds: RiskThresholds
): Promise<void> {
  const cleanUid = sanitizeId(uid);
  if (!auth.currentUser || auth.currentUser.uid !== cleanUid) {
    return;
  }
  const path = `users/${cleanUid}/settings/default`;
  const settingsRef = doc(db, 'users', cleanUid, 'settings', 'default');

  try {
    await setDoc(settingsRef, {
      userId: cleanUid,
      ruleVersion: RULE_ENGINE_VERSION,
      hrCriticalLow: Number(thresholds.heartRate.criticalLow),
      hrLowMin: Number(thresholds.heartRate.lowMin),
      hrModerateHigh: Number(thresholds.heartRate.moderateHigh),
      hrHighHigh: Number(thresholds.heartRate.highHigh),
      hrCriticalHigh: Number(thresholds.heartRate.criticalHigh),
      spo2NormalMin: Number(thresholds.oxygenSaturation.normalMin),
      spo2ModerateMin: Number(thresholds.oxygenSaturation.moderateMin),
      spo2HighMin: Number(thresholds.oxygenSaturation.highMin),
      bodyTempLowHypothermia: Number(thresholds.bodyTemp.lowHypothermia),
      bodyTempNormalMin: Number(thresholds.bodyTemp.normalMin),
      bodyTempNormalMax: Number(thresholds.bodyTemp.normalMax),
      bodyTempModerateMax: Number(thresholds.bodyTemp.moderateMax),
      bodyTempHighMax: Number(thresholds.bodyTemp.highMax),
      ambientColdCritical: Number(thresholds.ambientTemp.coldCritical),
      ambientColdWarn: Number(thresholds.ambientTemp.coldWarn),
      ambientHeatWarn: Number(thresholds.ambientTemp.heatWarn),
      ambientHeatHigh: Number(thresholds.ambientTemp.heatHigh),
      ambientHeatCritical: Number(thresholds.ambientTemp.heatCritical),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

/**
 * Persists a demo-only emergency contact to `/users/{uid}/emergencyContacts/{contactId}`.
 */
export async function saveEmergencyContactToFirestore(
  uid: string,
  contact: EmergencyContact
): Promise<void> {
  const cleanUid = sanitizeId(uid);
  if (!auth.currentUser || auth.currentUser.uid !== cleanUid) {
    return;
  }
  const cleanContactId = sanitizeId(contact.id);
  const path = `users/${cleanUid}/emergencyContacts/${cleanContactId}`;
  const contactRef = doc(db, 'users', cleanUid, 'emergencyContacts', cleanContactId);

  try {
    const snap = await getDoc(contactRef);
    const basePayload = {
      userId: cleanUid,
      name: contact.name.trim().slice(0, 100),
      relationship: contact.relationship.trim().slice(0, 80),
      phoneDisplay: contact.phoneDisplay.trim().slice(0, 40),
      email: (contact.email || 'demo.contact@example.com').trim().slice(0, 254),
      isPrimary: Boolean(contact.isPrimary),
      notifyOnLevel: contact.notifyOnLevel === RiskLevel.HIGH ? 'high' : 'critical',
      isDemoOnly: true,
      updatedAt: serverTimestamp(),
    };

    if (!snap.exists()) {
      await setDoc(contactRef, {
        ...basePayload,
        createdAt: serverTimestamp(),
      });
    } else {
      await updateDoc(contactRef, {
        name: basePayload.name,
        relationship: basePayload.relationship,
        phoneDisplay: basePayload.phoneDisplay,
        email: basePayload.email,
        isPrimary: basePayload.isPrimary,
        notifyOnLevel: basePayload.notifyOnLevel,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

/**
 * Deletes a demo emergency contact from `/users/{uid}/emergencyContacts/{contactId}`.
 */
export async function deleteEmergencyContactFromFirestore(
  uid: string,
  contactId: string
): Promise<void> {
  const cleanUid = sanitizeId(uid);
  if (!auth.currentUser || auth.currentUser.uid !== cleanUid) {
    return;
  }
  const cleanContactId = sanitizeId(contactId);
  const path = `users/${cleanUid}/emergencyContacts/${cleanContactId}`;
  try {
    await deleteDoc(doc(db, 'users', cleanUid, 'emergencyContacts', cleanContactId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

/**
 * Persists a simulated observation and deterministic risk assessment to
 * `/users/{uid}/observations/{obsId}` and `/users/{uid}/riskAssessments/{assessmentId}`.
 * Explicitly tags `isSimulated: true` and deduplicates identical back-to-back states.
 */
export async function recordSimulatedObservationAndAssessment(
  uid: string,
  vitals: VitalReadings,
  environment: EnvironmentReadings,
  assessment: RiskAssessment
): Promise<void> {
  const cleanUid = sanitizeId(uid);
  const signature = JSON.stringify({
    hr: vitals.heartRateBpm,
    spo2: vitals.oxygenSaturationPct,
    bt: vitals.bodyTempCelsius,
    act: vitals.activityLevel,
    amb: environment.ambientTempCelsius,
    rh: environment.humidityPct,
    wx: environment.weatherCondition,
    lvl: assessment.riskLevel,
    score: assessment.overallScore,
  });

  if (shouldSkipDuplicateWrite(`obs:${cleanUid}`, signature)) {
    return;
  }

  const stampId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const obsPath = `users/${cleanUid}/observations/obs-${stampId}`;
  const riskPath = `users/${cleanUid}/riskAssessments/risk-${stampId}`;

  try {
    await setDoc(doc(db, 'users', cleanUid, 'observations', `obs-${stampId}`), {
      userId: cleanUid,
      isSimulated: true,
      sourceLabel: 'VitaGuard Simulation Sandbox',
      heartRateBpm: Math.max(20, Math.min(250, Number(vitals.heartRateBpm))),
      oxygenSaturationPct: Math.max(50, Math.min(100, Number(vitals.oxygenSaturationPct))),
      bodyTempCelsius: Math.max(30, Math.min(45, Number(vitals.bodyTempCelsius))),
      activityLevel: vitals.activityLevel,
      ambientTempCelsius: Math.max(-50, Math.min(70, Number(environment.ambientTempCelsius))),
      humidityPct: Math.max(0, Math.min(100, Number(environment.humidityPct))),
      weatherCondition: environment.weatherCondition,
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, obsPath);
  }

  try {
    await setDoc(doc(db, 'users', cleanUid, 'riskAssessments', `risk-${stampId}`), {
      userId: cleanUid,
      isSimulated: true,
      ruleVersion: assessment.ruleVersion || RULE_ENGINE_VERSION,
      riskLevel: assessment.riskLevel,
      overallScore: Math.max(0, Math.min(100, Number(assessment.overallScore))),
      physiologicalRisk: assessment.physiologicalRisk,
      environmentalRisk: assessment.environmentalRisk,
      heatIndexCelsius: Number(assessment.heatIndexCelsius),
      primaryConcern: assessment.primaryConcern.slice(0, 300),
      triggeredRuleCount: Math.min(20, assessment.triggeredRules.length),
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, riskPath);
  }
}

/**
 * Creates or updates an active safety alert in `/users/{uid}/alerts/{alertId}`.
 */
export async function persistAlertToFirestore(
  uid: string,
  alert: SafetyAlert
): Promise<void> {
  const cleanUid = sanitizeId(uid);
  const cleanAlertId = sanitizeId(alert.id);
  const path = `users/${cleanUid}/alerts/${cleanAlertId}`;
  const alertRef = doc(db, 'users', cleanUid, 'alerts', cleanAlertId);

  try {
    const snap = await getDoc(alertRef);
    if (!snap.exists()) {
      await setDoc(alertRef, {
        userId: cleanUid,
        isSimulated: true,
        ruleVersion: alert.ruleVersion || RULE_ENGINE_VERSION,
        status: 'ACTIVE',
        riskLevel: alert.riskLevel,
        title: alert.title.slice(0, 200),
        summary: alert.summary.slice(0, 600),
        escalationStage: alert.escalationStage,
        acknowledged: false,
        acknowledgementNote: '',
        acknowledgedAtIso: '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      const existing = snap.data();
      // Never overwrite an ACKNOWLEDGED or RESOLVED alert with an ACTIVE update
      if (existing.status === 'ACKNOWLEDGED' || existing.status === 'RESOLVED' || existing.acknowledged) {
        return;
      }
      await updateDoc(alertRef, {
        riskLevel: alert.riskLevel,
        title: alert.title.slice(0, 200),
        summary: alert.summary.slice(0, 600),
        escalationStage: alert.escalationStage,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

/**
 * Idempotently acknowledges an alert in Firestore inside a transaction and writes an audit event.
 */
export async function acknowledgeAlertInFirestore(
  uid: string,
  alertId: string,
  note: string
): Promise<{ alreadyAcknowledged: boolean; acknowledgedAtIso: string }> {
  const cleanUid = sanitizeId(uid);
  const cleanAlertId = sanitizeId(alertId);
  const path = `users/${cleanUid}/alerts/${cleanAlertId}`;
  const alertRef = doc(db, 'users', cleanUid, 'alerts', cleanAlertId);
  const cleanNote = (note.trim() || 'Confirmed safe via dashboard check-in.').slice(0, 300);

  try {
    return await runTransaction(db, async (tx) => {
      const snap = await tx.get(alertRef);
      if (!snap.exists()) {
        throw new Error(`Alert ${cleanAlertId} does not exist.`);
      }
      const data = snap.data();
      if (data.userId !== cleanUid) {
        throw new Error('Missing or insufficient permissions: owner mismatch.');
      }

      if (data.status === 'ACKNOWLEDGED' || data.status === 'RESOLVED' || data.acknowledged === true) {
        return {
          alreadyAcknowledged: true,
          acknowledgedAtIso: data.acknowledgedAtIso || new Date().toISOString(),
        };
      }

      const nowIso = new Date().toISOString();
      tx.update(alertRef, {
        status: 'ACKNOWLEDGED',
        acknowledged: true,
        acknowledgementNote: cleanNote,
        acknowledgedAtIso: nowIso,
        escalationStage: EscalationStage.ACKNOWLEDGED_SAFE,
        updatedAt: serverTimestamp(),
      });

      const auditId = `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const auditRef = doc(db, 'users', cleanUid, 'auditEvents', auditId);
      tx.set(auditRef, {
        userId: cleanUid,
        eventType: 'user_acknowledged',
        riskLevel: data.riskLevel || RiskLevel.HIGH,
        title: 'User Confirmed "I am safe"',
        detail: `Alert "${data.title}" acknowledged. Note: ${cleanNote}`.slice(0, 600),
        alertId: cleanAlertId,
        createdAt: serverTimestamp(),
      });

      return {
        alreadyAcknowledged: false,
        acknowledgedAtIso: nowIso,
      };
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

/**
 * Transitions an active or acknowledged alert to RESOLVED in Firestore when readings return to LOW risk.
 */
export async function resolveAlertInFirestore(
  uid: string,
  alertId: string
): Promise<void> {
  const cleanUid = sanitizeId(uid);
  const cleanAlertId = sanitizeId(alertId);
  const path = `users/${cleanUid}/alerts/${cleanAlertId}`;
  const alertRef = doc(db, 'users', cleanUid, 'alerts', cleanAlertId);

  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(alertRef);
      if (!snap.exists()) return;
      const data = snap.data();
      if (data.status === 'RESOLVED') return;

      tx.update(alertRef, {
        status: 'RESOLVED',
        updatedAt: serverTimestamp(),
      });
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

/**
 * Server-checked escalation update in Firestore.
 * Uses a transaction to re-read authoritative alert status before advancing escalation,
 * preventing a stale timer from escalating an ACKNOWLEDGED or RESOLVED alert.
 */
export async function escalateAlertInFirestoreSafely(
  uid: string,
  alertId: string,
  elapsedSeconds: number
): Promise<{ escalated: boolean; stage: EscalationStage }> {
  const cleanUid = sanitizeId(uid);
  const cleanAlertId = sanitizeId(alertId);
  const path = `users/${cleanUid}/alerts/${cleanAlertId}`;
  const alertRef = doc(db, 'users', cleanUid, 'alerts', cleanAlertId);

  try {
    if ((import.meta as unknown as { env?: Record<string, string> }).env?.VITE_USE_FIREBASE_EMULATOR === 'true') {
      const fn = httpsCallable(functions, 'evaluateAlertEscalation');
      await fn({ alertId: cleanAlertId, elapsedSeconds });
    }
  } catch {
    // Fallback to transactional Firestore verification below
  }

  try {
    return await runTransaction(db, async (tx) => {
      const snap = await tx.get(alertRef);
      if (!snap.exists()) {
        return { escalated: false, stage: EscalationStage.MONITORING };
      }

      const data = snap.data();
      // STALE TIMER GUARD: Abort if alert is already ACKNOWLEDGED or RESOLVED
      if (data.status !== 'ACTIVE' || data.acknowledged === true) {
        return {
          escalated: false,
          stage: (data.escalationStage as EscalationStage) || EscalationStage.ACKNOWLEDGED_SAFE,
        };
      }

      const stubAlert: SafetyAlert = {
        id: cleanAlertId,
        createdAt: '',
        updatedAt: '',
        status: data.status as AlertLifecycleStatus,
        riskLevel: data.riskLevel as RiskLevel,
        title: data.title,
        summary: data.summary,
        triggeredRuleIds: [],
        acknowledged: Boolean(data.acknowledged),
        escalationStage: data.escalationStage as EscalationStage,
        secondsSinceTriggered: elapsedSeconds,
      };

      const nextStage = computeEscalationStage(stubAlert, elapsedSeconds);
      if (nextStage === data.escalationStage) {
        return { escalated: false, stage: nextStage };
      }

      tx.update(alertRef, {
        escalationStage: nextStage,
        updatedAt: serverTimestamp(),
      });

      const auditId = `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const auditRef = doc(db, 'users', cleanUid, 'auditEvents', auditId);
      tx.set(auditRef, {
        userId: cleanUid,
        eventType: 'escalation_step',
        riskLevel: data.riskLevel || RiskLevel.HIGH,
        title: `Escalation Advanced: ${nextStage.replace(/_/g, ' ').toUpperCase()}`,
        detail: `Alert unacknowledged for ${elapsedSeconds}s. Stage transitioned to ${nextStage.replace(/_/g, ' ')} (Simulation Mode — No SMS sent).`.slice(0, 600),
        alertId: cleanAlertId,
        createdAt: serverTimestamp(),
      });

      return { escalated: true, stage: nextStage };
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

/**
 * Appends an immutable audit event to `/users/{uid}/auditEvents/{eventId}`.
 */
export async function appendAuditEventToFirestore(
  uid: string,
  event: SafetyEvent
): Promise<void> {
  const cleanUid = sanitizeId(uid);
  const cleanEventId = sanitizeId(event.id);
  const path = `users/${cleanUid}/auditEvents/${cleanEventId}`;
  const eventRef = doc(db, 'users', cleanUid, 'auditEvents', cleanEventId);

  try {
    await setDoc(eventRef, {
      userId: cleanUid,
      eventType: event.type,
      riskLevel: event.riskLevel,
      title: event.title.slice(0, 200),
      detail: event.detail.slice(0, 600),
      alertId: (event.alertId || '').slice(0, 128),
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

/**
 * Persists a validated AI explanation to `/users/{uid}/aiExplanations/{explanationId}`.
 * Enforces strict field bounds and ensures no API keys or secrets are written to Firestore.
 */
export async function persistAIExplanationToFirestore(
  uid: string,
  explanation: PersistedAIExplanation
): Promise<void> {
  const cleanUid = sanitizeId(uid);
  const cleanExplanationId = sanitizeId(explanation.explanationId);
  const cleanAssessmentId = sanitizeId(explanation.assessmentId);
  const path = `users/${cleanUid}/aiExplanations/${cleanExplanationId}`;
  const expRef = doc(db, 'users', cleanUid, 'aiExplanations', cleanExplanationId);

  if (explanation.userId !== cleanUid) {
    handleFirestoreError(
      new Error('PERMISSION_DENIED: AI explanation userId mismatch.'),
      OperationType.CREATE,
      path
    );
  }

  try {
    const existingSnap = await getDoc(expRef);
    if (existingSnap.exists()) {
      return;
    }

    await setDoc(expRef, {
      userId: cleanUid,
      assessmentId: cleanAssessmentId,
      assessmentFingerprint: explanation.assessmentFingerprint.slice(0, 128),
      modelId: explanation.modelId.slice(0, 64),
      promptVersion: explanation.promptVersion.slice(0, 64),
      schemaVersion: explanation.schemaVersion.slice(0, 64),
      dataMode: explanation.dataMode === 'REAL' ? 'REAL' : 'SIMULATED',
      summary: explanation.summary.slice(0, 1000),
      contributingFactors: explanation.contributingFactors
        .slice(0, 12)
        .map((s) => s.slice(0, 400)),
      uncertainties: explanation.uncertainties.slice(0, 12).map((s) => s.slice(0, 400)),
      recommendedActions: explanation.recommendedActions
        .slice(0, 10)
        .map((s) => s.slice(0, 400)),
      limitations: explanation.limitations.slice(0, 600),
      generatedAtIso: explanation.generatedAt.slice(0, 64),
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function persistEscalationTaskToFirestore(
  uid: string,
  task: EscalationTaskRecord
): Promise<void> {
  const cleanUid = sanitizeId(uid);
  const cleanTaskId = sanitizeId(task.taskId);
  const path = `users/${cleanUid}/escalationTasks/${cleanTaskId}`;
  const taskRef = doc(db, 'users', cleanUid, 'escalationTasks', cleanTaskId);

  try {
    await setDoc(taskRef, {
      taskId: cleanTaskId,
      alertId: sanitizeId(task.alertId),
      userId: cleanUid,
      riskLevel: task.riskLevel,
      status: task.status,
      deadlineIso: task.deadlineIso.slice(0, 64),
      timeoutSeconds: Math.max(15, Math.min(900, task.timeoutSeconds || 60)),
      executionCount: Math.max(0, Math.min(10, task.attemptCount || 0)),
      cancellationReason: (task.lastOutcomeNote || '').slice(0, 300),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function persistNotificationAttemptToFirestore(
  uid: string,
  attempt: NotificationAttemptRecord
): Promise<void> {
  const cleanUid = sanitizeId(uid);
  const cleanAttemptId = sanitizeId(attempt.attemptId);
  const path = `users/${cleanUid}/notificationAttempts/${cleanAttemptId}`;
  const attemptRef = doc(db, 'users', cleanUid, 'notificationAttempts', cleanAttemptId);

  try {
    await setDoc(attemptRef, {
      attemptId: cleanAttemptId,
      idempotencyKey: attempt.idempotencyKey.slice(0, 160),
      alertId: sanitizeId(attempt.alertId),
      userId: cleanUid,
      contactId: sanitizeId(attempt.recipientRef || 'contact-primary'),
      contactName: attempt.recipientRef.slice(0, 100) || 'Designated Contact',
      channel: 'IN_APP_SIMULATION',
      mode: 'SIMULATION',
      status:
        attempt.deliveryStatus === 'DELIVERED' || attempt.deliveryStatus === 'UNKNOWN'
          ? 'SUBMITTED'
          : attempt.deliveryStatus,
      providerName: attempt.providerId.slice(0, 80) || 'SimulationNotificationProvider',
      messagePreview: (attempt.messagePreview || 'VitaGuard safety check-in notification').slice(0, 500),
      AttemptedAtIso: attempt.attemptedAtIso.slice(0, 64),
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function persistNormalizedObservationToFirestore(
  uid: string,
  obs: NormalizedObservation
): Promise<void> {
  const cleanUid = sanitizeId(uid);
  const cleanObsId = sanitizeId(obs.observationId);
  const path = `users/${cleanUid}/normalizedObservations/${cleanObsId}`;
  const obsRef = doc(db, 'users', cleanUid, 'normalizedObservations', cleanObsId);

  try {
    await setDoc(obsRef, {
      observationId: cleanObsId,
      authenticatedOwnerId: cleanUid,
      metricType: obs.metricType,
      unit: obs.unit,
      observedAt: obs.observedAt.slice(0, 64),
      receivedAt: obs.receivedAt.slice(0, 64),
      sourceProvider: obs.sourceProvider.slice(0, 64),
      // Direct client SDK writes are restricted to SIMULATED by firestore.rules
      dataMode: 'SIMULATED',
      validationStatus:
        obs.validationStatus === 'QUARANTINED_OUT_OF_ORDER'
          ? 'QUARANTINED_OUT_OF_ORDER'
          : 'VALIDATED',
      freshnessStatus: obs.freshnessStatus,
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

/**
 * Safe Demo Reset:
 * Resets ONLY designated simulated/demo state for the authenticated user,
 * while strictly preserving any REAL observations, custom user contacts, and other users' records.
 */
export function resetDemoWorkspaceOnly(
  actingUid: string | null,
  targetUid: string
): {
  workspace: PersistedUserWorkspace;
  preservedRealObservations: NormalizedObservation[];
  purgedSimulatedCount: number;
} {
  const current = loadUserWorkspaceState(actingUid, targetUid);
  const existingObs = current.normalizedObservations ?? [];
  const preservedRealObservations = existingObs.filter((o) => o.dataMode === 'REAL');
  const purgedSimulatedCount = existingObs.filter((o) => o.dataMode === 'SIMULATED').length;

  const freshBase = createInitialUserWorkspace(targetUid);
  const nextWorkspace: PersistedUserWorkspace = {
    ...freshBase,
    // Preserve custom user settings & contacts if configured
    thresholds: current.thresholds || freshBase.thresholds,
    contacts: current.contacts?.length ? current.contacts : freshBase.contacts,
    normalizedObservations: preservedRealObservations,
    events: [
      {
        id: `evt-demo-reset-${Date.now()}`,
        timestamp: new Date().toISOString(),
        type: 'preset_applied',
        riskLevel: RiskLevel.LOW,
        title: 'Safe Demo Reset Executed (Simulated Data Only)',
        detail: `Reset synthetic demo scenario to Nominal Baseline. Preserved ${preservedRealObservations.length} REAL observation(s) and purged ${purgedSimulatedCount} SIMULATED record(s).`,
      },
    ],
    updatedAtIso: new Date().toISOString(),
  };

  saveUserWorkspaceState(actingUid, targetUid, nextWorkspace);
  return {
    workspace: nextWorkspace,
    preservedRealObservations,
    purgedSimulatedCount,
  };
}

/**
 * Attaches real-time Firestore listeners (`onSnapshot`) for the authenticated user's
 * settings, emergency contacts, alerts, and audit events.
 * Automatically returns a cleanup function that unsubscribes all listeners on unmount.
 */
export function subscribeToUserSafetyData(
  uid: string,
  callbacks: {
    onSettings: (thresholds: RiskThresholds) => void;
    onContacts: (contacts: EmergencyContact[]) => void;
    onAlerts: (alerts: SafetyAlert[]) => void;
    onAuditEvents: (events: SafetyEvent[]) => void;
    onSyncError: (message: string) => void;
  }
): Unsubscribe {
  const cleanUid = sanitizeId(uid);
  // Only attach onSnapshot listeners if auth is ready and user is authenticated with matching UID
  if (!auth.currentUser || auth.currentUser.uid !== cleanUid) {
    return () => {};
  }
  const unsubscribes: Unsubscribe[] = [];

  // 1. Settings listener
  const settingsPath = `users/${cleanUid}/settings/default`;
  unsubscribes.push(
    onSnapshot(
      doc(db, 'users', cleanUid, 'settings', 'default'),
      (snap) => {
        if (!snap.exists()) return;
        const d = snap.data();
        callbacks.onSettings({
          heartRate: {
            criticalLow: Number(d.hrCriticalLow ?? DEFAULT_THRESHOLDS.heartRate.criticalLow),
            lowMin: Number(d.hrLowMin ?? DEFAULT_THRESHOLDS.heartRate.lowMin),
            moderateLow: Number(d.hrLowMin ?? DEFAULT_THRESHOLDS.heartRate.moderateLow),
            moderateHigh: Number(d.hrModerateHigh ?? DEFAULT_THRESHOLDS.heartRate.moderateHigh),
            highHigh: Number(d.hrHighHigh ?? DEFAULT_THRESHOLDS.heartRate.highHigh),
            criticalHigh: Number(d.hrCriticalHigh ?? DEFAULT_THRESHOLDS.heartRate.criticalHigh),
          },
          oxygenSaturation: {
            normalMin: Number(d.spo2NormalMin ?? DEFAULT_THRESHOLDS.oxygenSaturation.normalMin),
            moderateMin: Number(d.spo2ModerateMin ?? DEFAULT_THRESHOLDS.oxygenSaturation.moderateMin),
            highMin: Number(d.spo2HighMin ?? DEFAULT_THRESHOLDS.oxygenSaturation.highMin),
          },
          bodyTemp: {
            lowHypothermia: Number(d.bodyTempLowHypothermia ?? DEFAULT_THRESHOLDS.bodyTemp.lowHypothermia),
            normalMin: Number(d.bodyTempNormalMin ?? DEFAULT_THRESHOLDS.bodyTemp.normalMin),
            normalMax: Number(d.bodyTempNormalMax ?? DEFAULT_THRESHOLDS.bodyTemp.normalMax),
            moderateMax: Number(d.bodyTempModerateMax ?? DEFAULT_THRESHOLDS.bodyTemp.moderateMax),
            highMax: Number(d.bodyTempHighMax ?? DEFAULT_THRESHOLDS.bodyTemp.highMax),
          },
          ambientTemp: {
            coldCritical: Number(d.ambientColdCritical ?? DEFAULT_THRESHOLDS.ambientTemp.coldCritical),
            coldWarn: Number(d.ambientColdWarn ?? DEFAULT_THRESHOLDS.ambientTemp.coldWarn),
            heatWarn: Number(d.ambientHeatWarn ?? DEFAULT_THRESHOLDS.ambientTemp.heatWarn),
            heatHigh: Number(d.ambientHeatHigh ?? DEFAULT_THRESHOLDS.ambientTemp.heatHigh),
            heatCritical: Number(d.ambientHeatCritical ?? DEFAULT_THRESHOLDS.ambientTemp.heatCritical),
          },
        });
      },
      (error) => {
        callbacks.onSyncError(error.message);
      }
    )
  );

  // 2. Emergency Contacts listener
  const contactsPath = `users/${cleanUid}/emergencyContacts`;
  const contactsQuery = query(
    collection(db, 'users', cleanUid, 'emergencyContacts'),
    where('userId', '==', cleanUid)
  );
  unsubscribes.push(
    onSnapshot(
      contactsQuery,
      (snap) => {
        const list: EmergencyContact[] = snap.docs.map((docSnap) => {
          const d = docSnap.data();
          return {
            id: docSnap.id,
            name: String(d.name || ''),
            relationship: String(d.relationship || ''),
            phoneDisplay: String(d.phoneDisplay || ''),
            email: String(d.email || ''),
            isPrimary: Boolean(d.isPrimary),
            notifyOnLevel:
              d.notifyOnLevel === 'high' ? RiskLevel.HIGH : RiskLevel.CRITICAL,
          };
        });
        if (list.length > 0) {
          callbacks.onContacts(list);
        }
      },
      (error) => {
        callbacks.onSyncError(error.message);
      }
    )
  );

  // 3. Alerts listener
  const alertsPath = `users/${cleanUid}/alerts`;
  const alertsQuery = query(
    collection(db, 'users', cleanUid, 'alerts'),
    where('userId', '==', cleanUid),
    orderBy('createdAt', 'desc'),
    limit(25)
  );
  unsubscribes.push(
    onSnapshot(
      alertsQuery,
      (snap) => {
        const list: SafetyAlert[] = snap.docs.map((docSnap) => {
          const d = docSnap.data();
          const createdIso = timestampToIso(d.createdAt);
          const updatedIso = timestampToIso(d.updatedAt, createdIso);
          return {
            id: docSnap.id,
            createdAt: createdIso,
            updatedAt: updatedIso,
            status: (d.status as AlertLifecycleStatus) || (d.acknowledged ? 'ACKNOWLEDGED' : 'ACTIVE'),
            ruleVersion: String(d.ruleVersion || RULE_ENGINE_VERSION),
            riskLevel: (d.riskLevel as RiskLevel) || RiskLevel.HIGH,
            title: String(d.title || ''),
            summary: String(d.summary || ''),
            triggeredRuleIds: [],
            acknowledged: Boolean(d.acknowledged),
            acknowledgedAt: d.acknowledgedAtIso ? String(d.acknowledgedAtIso) : undefined,
            acknowledgementNote: d.acknowledgementNote ? String(d.acknowledgementNote) : undefined,
            escalationStage:
              (d.escalationStage as EscalationStage) || EscalationStage.PROMPTED_USER,
            secondsSinceTriggered: 0,
          };
        });
        if (list.length > 0) {
          callbacks.onAlerts(list);
        }
      },
      (error) => {
        callbacks.onSyncError(error.message);
      }
    )
  );

  // 4. Audit Events listener
  const eventsPath = `users/${cleanUid}/auditEvents`;
  const eventsQuery = query(
    collection(db, 'users', cleanUid, 'auditEvents'),
    where('userId', '==', cleanUid),
    orderBy('createdAt', 'desc'),
    limit(40)
  );
  unsubscribes.push(
    onSnapshot(
      eventsQuery,
      (snap) => {
        const list: SafetyEvent[] = snap.docs.map((docSnap) => {
          const d = docSnap.data();
          return {
            id: docSnap.id,
            timestamp: timestampToIso(d.createdAt),
            type: (d.eventType as SafetyEvent['type']) || 'assessment_change',
            riskLevel: (d.riskLevel as RiskLevel) || RiskLevel.LOW,
            title: String(d.title || ''),
            detail: String(d.detail || ''),
            alertId: d.alertId ? String(d.alertId) : undefined,
          };
        });
        if (list.length > 0) {
          callbacks.onAuditEvents(list);
        }
      },
      (error) => {
        callbacks.onSyncError(error.message);
      }
    )
  );

  return () => {
    for (const unsub of unsubscribes) {
      unsub();
    }
  };
}

/**
 * Pure, deterministic Firestore Security Rules & Repository Verifier.
 * Mirrors the exact constraints in `firestore.rules` (owner isolation, strict key allowlists,
 * `isSimulated == true`, terminal state locks, and idempotent acknowledgement).
 */
export class SecureSafetyRepositorySimulator {
  private profiles = new Map<string, Record<string, unknown>>();
  private settings = new Map<string, Record<string, unknown>>();
  private contacts = new Map<string, Map<string, EmergencyContact>>();
  private observations = new Map<string, Record<string, unknown>[]>();
  private assessments = new Map<string, Record<string, unknown>[]>();
  private alerts = new Map<string, Map<string, SafetyAlert>>();
  private auditEvents = new Map<string, SafetyEvent[]>();
  private aiExplanations = new Map<string, Map<string, PersistedAIExplanation>>();
  private escalationTasks = new Map<string, Map<string, EscalationTaskRecord>>();
  private notificationAttempts = new Map<string, NotificationAttemptRecord[]>();
  private normalizedObservations = new Map<string, NormalizedObservation[]>();
  private offlineMode = false;

  public setOfflineMode(offline: boolean): void {
    this.offlineMode = offline;
  }

  private assertOnline(path: string, op: OperationType): void {
    if (this.offlineMode) {
      handleFirestoreError(new Error('Failed to get document because the client is offline.'), op, path);
    }
  }

  private assertOwnerAndValidId(
    actingUid: string | null,
    targetUid: string,
    docId: string,
    path: string,
    op: OperationType
  ): void {
    if (!actingUid) {
      handleFirestoreError(new Error('PERMISSION_DENIED: Unauthenticated request.'), op, path);
    }
    if (actingUid !== targetUid) {
      handleFirestoreError(
        new Error(`PERMISSION_DENIED: User ${actingUid} cannot access user ${targetUid} records.`),
        op,
        path
      );
    }
    if (!VALID_ID_REGEX.test(targetUid) || targetUid.length > 128 || !VALID_ID_REGEX.test(docId) || docId.length > 128) {
      handleFirestoreError(new Error('PERMISSION_DENIED: Invalid document ID format.'), op, path);
    }
  }

  private assertProfileExists(targetUid: string, path: string, op: OperationType): void {
    if (!this.profiles.has(targetUid)) {
      handleFirestoreError(
        new Error('PERMISSION_DENIED: Master Gate failed — parent user profile does not exist.'),
        op,
        path
      );
    }
  }

  public createProfile(
    actingUid: string | null,
    targetUid: string,
    payload: Record<string, unknown>
  ): void {
    const path = `users/${targetUid}`;
    this.assertOnline(path, OperationType.CREATE);
    this.assertOwnerAndValidId(actingUid, targetUid, targetUid, path, OperationType.CREATE);

    const allowedKeys = [
      'uid',
      'email',
      'displayName',
      'simulationNoticeAccepted',
      'createdAt',
      'updatedAt',
    ];
    const keys = Object.keys(payload);
    if (
      !allowedKeys.every((k) => keys.includes(k)) ||
      !keys.every((k) => allowedKeys.includes(k))
    ) {
      handleFirestoreError(
        new Error('PERMISSION_DENIED: Shadow field or missing required field on UserProfile.'),
        OperationType.CREATE,
        path
      );
    }
    if (payload.uid !== actingUid || payload.simulationNoticeAccepted !== true) {
      handleFirestoreError(
        new Error('PERMISSION_DENIED: Invalid UserProfile ownership or simulation flag.'),
        OperationType.CREATE,
        path
      );
    }

    this.profiles.set(targetUid, { ...payload });
  }

  public saveSettings(
    actingUid: string | null,
    targetUid: string,
    thresholds: RiskThresholds
  ): void {
    const path = `users/${targetUid}/settings/default`;
    this.assertOnline(path, OperationType.WRITE);
    this.assertOwnerAndValidId(actingUid, targetUid, 'default', path, OperationType.WRITE);
    this.assertProfileExists(targetUid, path, OperationType.WRITE);

    if (
      thresholds.heartRate.criticalLow >= thresholds.heartRate.lowMin ||
      thresholds.heartRate.moderateHigh >= thresholds.heartRate.highHigh ||
      thresholds.heartRate.highHigh >= thresholds.heartRate.criticalHigh
    ) {
      handleFirestoreError(
        new Error('PERMISSION_DENIED: Invalid heart rate threshold ordering.'),
        OperationType.WRITE,
        path
      );
    }

    this.settings.set(targetUid, {
      userId: targetUid,
      ruleVersion: RULE_ENGINE_VERSION,
      thresholds: structuredClone(thresholds),
    });
  }

  public getSettings(actingUid: string | null, targetUid: string): RiskThresholds {
    const path = `users/${targetUid}/settings/default`;
    this.assertOnline(path, OperationType.GET);
    this.assertOwnerAndValidId(actingUid, targetUid, 'default', path, OperationType.GET);
    const record = this.settings.get(targetUid);
    if (!record) return DEFAULT_THRESHOLDS;
    return record.thresholds as RiskThresholds;
  }

  public saveContact(
    actingUid: string | null,
    targetUid: string,
    contact: EmergencyContact,
    extraShadowFields?: Record<string, unknown>
  ): void {
    const path = `users/${targetUid}/emergencyContacts/${contact.id}`;
    this.assertOnline(path, OperationType.WRITE);
    this.assertOwnerAndValidId(actingUid, targetUid, contact.id, path, OperationType.WRITE);
    this.assertProfileExists(targetUid, path, OperationType.WRITE);

    if (extraShadowFields && Object.keys(extraShadowFields).length > 0) {
      handleFirestoreError(
        new Error('PERMISSION_DENIED: Shadow fields are forbidden by hasOnly() rule.'),
        OperationType.WRITE,
        path
      );
    }

    const userContacts = this.contacts.get(targetUid) ?? new Map<string, EmergencyContact>();
    userContacts.set(contact.id, { ...contact });
    this.contacts.set(targetUid, userContacts);
  }

  public listContacts(actingUid: string | null, targetUid: string): EmergencyContact[] {
    const path = `users/${targetUid}/emergencyContacts`;
    this.assertOnline(path, OperationType.LIST);
    this.assertOwnerAndValidId(actingUid, targetUid, 'list', path, OperationType.LIST);
    const userContacts = this.contacts.get(targetUid);
    return userContacts ? Array.from(userContacts.values()) : [];
  }

  public recordObservationAndAssessment(
    actingUid: string | null,
    targetUid: string,
    vitals: VitalReadings,
    environment: EnvironmentReadings,
    assessment: RiskAssessment,
    isSimulated: boolean = true
  ): void {
    const path = `users/${targetUid}/observations/obs-1`;
    this.assertOnline(path, OperationType.CREATE);
    this.assertOwnerAndValidId(actingUid, targetUid, 'obs-1', path, OperationType.CREATE);
    this.assertProfileExists(targetUid, path, OperationType.CREATE);

    if (!isSimulated) {
      handleFirestoreError(
        new Error('PERMISSION_DENIED: Simulated observations must set isSimulated == true.'),
        OperationType.CREATE,
        path
      );
    }

    const obsList = this.observations.get(targetUid) ?? [];
    obsList.push({
      userId: targetUid,
      isSimulated: true,
      vitals: { ...vitals },
      environment: { ...environment },
      createdAt: new Date().toISOString(),
    });
    this.observations.set(targetUid, obsList);

    const riskList = this.assessments.get(targetUid) ?? [];
    riskList.push({
      userId: targetUid,
      isSimulated: true,
      ruleVersion: assessment.ruleVersion || RULE_ENGINE_VERSION,
      riskLevel: assessment.riskLevel,
      overallScore: assessment.overallScore,
      createdAt: new Date().toISOString(),
    });
    this.assessments.set(targetUid, riskList);
  }

  public createAlert(
    actingUid: string | null,
    targetUid: string,
    alert: SafetyAlert
  ): SafetyAlert {
    const path = `users/${targetUid}/alerts/${alert.id}`;
    this.assertOnline(path, OperationType.CREATE);
    this.assertOwnerAndValidId(actingUid, targetUid, alert.id, path, OperationType.CREATE);
    this.assertProfileExists(targetUid, path, OperationType.CREATE);

    const stored: SafetyAlert = {
      ...alert,
      status: 'ACTIVE',
      acknowledged: false,
      ruleVersion: alert.ruleVersion || RULE_ENGINE_VERSION,
    };

    const userAlerts = this.alerts.get(targetUid) ?? new Map<string, SafetyAlert>();
    userAlerts.set(alert.id, stored);
    this.alerts.set(targetUid, userAlerts);

    const events = this.auditEvents.get(targetUid) ?? [];
    events.unshift({
      id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: stored.createdAt,
      type: 'alert_triggered',
      riskLevel: stored.riskLevel,
      title: `Alert Created: ${stored.title}`,
      detail: stored.summary,
      alertId: stored.id,
    });
    this.auditEvents.set(targetUid, events);

    return stored;
  }

  public acknowledgeAlert(
    actingUid: string | null,
    targetUid: string,
    alertId: string,
    note: string = 'Confirmed safe via dashboard check-in.',
    nowIso: string = new Date().toISOString()
  ): { alert: SafetyAlert; alreadyAcknowledged: boolean } {
    const path = `users/${targetUid}/alerts/${alertId}`;
    this.assertOnline(path, OperationType.UPDATE);
    this.assertOwnerAndValidId(actingUid, targetUid, alertId, path, OperationType.UPDATE);
    this.assertProfileExists(targetUid, path, OperationType.UPDATE);

    const userAlerts = this.alerts.get(targetUid);
    const existing = userAlerts?.get(alertId);
    if (!existing) {
      handleFirestoreError(new Error('Alert not found.'), OperationType.UPDATE, path);
    }

    const { updatedAlert, timelineEvent, alreadyAcknowledged } =
      acknowledgeAlertIdempotent(existing, note, nowIso);

    if (!alreadyAcknowledged && timelineEvent) {
      userAlerts!.set(alertId, updatedAlert);
      const events = this.auditEvents.get(targetUid) ?? [];
      events.unshift(timelineEvent);
      this.auditEvents.set(targetUid, events);
    }

    return { alert: updatedAlert, alreadyAcknowledged };
  }

  public escalateAlertTick(
    actingUid: string | null,
    targetUid: string,
    alertId: string,
    elapsedSeconds: number
  ): { escalated: boolean; alert: SafetyAlert } {
    const path = `users/${targetUid}/alerts/${alertId}`;
    this.assertOnline(path, OperationType.UPDATE);
    this.assertOwnerAndValidId(actingUid, targetUid, alertId, path, OperationType.UPDATE);

    const userAlerts = this.alerts.get(targetUid);
    const existing = userAlerts?.get(alertId);
    if (!existing) {
      handleFirestoreError(new Error('Alert not found.'), OperationType.UPDATE, path);
    }

    // Stale escalation timer guard
    if (!canEscalateAlert(existing)) {
      return { escalated: false, alert: existing };
    }

    const nextStage = computeEscalationStage(existing, elapsedSeconds);
    const updated: SafetyAlert = {
      ...existing,
      secondsSinceTriggered: elapsedSeconds,
      escalationStage: nextStage,
    };
    userAlerts!.set(alertId, updated);
    return { escalated: nextStage !== existing.escalationStage, alert: updated };
  }

  public resolveAlert(
    actingUid: string | null,
    targetUid: string,
    alertId: string,
    nowIso: string = new Date().toISOString()
  ): SafetyAlert {
    const path = `users/${targetUid}/alerts/${alertId}`;
    this.assertOnline(path, OperationType.UPDATE);
    this.assertOwnerAndValidId(actingUid, targetUid, alertId, path, OperationType.UPDATE);

    const userAlerts = this.alerts.get(targetUid);
    const existing = userAlerts?.get(alertId);
    if (!existing) {
      handleFirestoreError(new Error('Alert not found.'), OperationType.UPDATE, path);
    }

    const resolved = resolveAlert(existing, nowIso);
    userAlerts!.set(alertId, resolved);
    return resolved;
  }

  public attemptDeleteAuditEvent(
    actingUid: string | null,
    targetUid: string,
    eventId: string
  ): never {
    const path = `users/${targetUid}/auditEvents/${eventId}`;
    handleFirestoreError(
      new Error('PERMISSION_DENIED: Audit events are immutable and cannot be deleted.'),
      OperationType.DELETE,
      path
    );
  }

  public getAuditEvents(actingUid: string | null, targetUid: string): SafetyEvent[] {
    const path = `users/${targetUid}/auditEvents`;
    this.assertOnline(path, OperationType.LIST);
    this.assertOwnerAndValidId(actingUid, targetUid, 'list', path, OperationType.LIST);
    return [...(this.auditEvents.get(targetUid) ?? [])];
  }

  public saveAIExplanation(
    actingUid: string | null,
    targetUid: string,
    explanation: PersistedAIExplanation,
    extraShadowFields?: Record<string, unknown>
  ): void {
    const path = `users/${targetUid}/aiExplanations/${explanation.explanationId}`;
    this.assertOnline(path, OperationType.CREATE);
    this.assertOwnerAndValidId(
      actingUid,
      targetUid,
      explanation.explanationId,
      path,
      OperationType.CREATE
    );
    this.assertProfileExists(targetUid, path, OperationType.CREATE);

    if (extraShadowFields && Object.keys(extraShadowFields).length > 0) {
      handleFirestoreError(
        new Error('PERMISSION_DENIED: Shadow fields are forbidden on AIExplanationRecord.'),
        OperationType.CREATE,
        path
      );
    }

    if (explanation.userId !== targetUid || !explanation.assessmentId) {
      handleFirestoreError(
        new Error('PERMISSION_DENIED: Invalid userId or missing assessmentId on AIExplanationRecord.'),
        OperationType.CREATE,
        path
      );
    }

    const userExps =
      this.aiExplanations.get(targetUid) ?? new Map<string, PersistedAIExplanation>();
    userExps.set(explanation.explanationId, structuredClone(explanation));
    this.aiExplanations.set(targetUid, userExps);
  }

  public getAIExplanation(
    actingUid: string | null,
    targetUid: string,
    explanationId: string
  ): PersistedAIExplanation | null {
    const path = `users/${targetUid}/aiExplanations/${explanationId}`;
    this.assertOnline(path, OperationType.GET);
    this.assertOwnerAndValidId(actingUid, targetUid, explanationId, path, OperationType.GET);
    const userExps = this.aiExplanations.get(targetUid);
    const found = userExps?.get(explanationId);
    return found ? structuredClone(found) : null;
  }

  public saveEscalationTask(
    actingUid: string | null,
    targetUid: string,
    task: EscalationTaskRecord
  ): void {
    const path = `users/${targetUid}/escalationTasks/${task.taskId}`;
    this.assertOnline(path, OperationType.WRITE);
    this.assertOwnerAndValidId(actingUid, targetUid, task.taskId, path, OperationType.WRITE);
    this.assertProfileExists(targetUid, path, OperationType.WRITE);

    if (
      task.userId !== targetUid ||
      task.timeoutSeconds < 15 ||
      task.timeoutSeconds > 900
    ) {
      handleFirestoreError(
        new Error('PERMISSION_DENIED: Invalid escalationTask ownership or timeout bounds.'),
        OperationType.WRITE,
        path
      );
    }

    const userTasks =
      this.escalationTasks.get(targetUid) ?? new Map<string, EscalationTaskRecord>();
    userTasks.set(task.taskId, structuredClone(task));
    this.escalationTasks.set(targetUid, userTasks);
  }

  public getEscalationTasks(
    actingUid: string | null,
    targetUid: string
  ): EscalationTaskRecord[] {
    const path = `users/${targetUid}/escalationTasks`;
    this.assertOnline(path, OperationType.LIST);
    this.assertOwnerAndValidId(actingUid, targetUid, 'list', path, OperationType.LIST);
    const userTasks = this.escalationTasks.get(targetUid);
    if (!userTasks) return [];
    return Array.from(userTasks.values()).map((t) => structuredClone(t));
  }

  public recordNotificationAttemptFromClient(
    actingUid: string | null,
    targetUid: string,
    attempt: NotificationAttemptRecord
  ): void {
    const path = `users/${targetUid}/notificationAttempts/${attempt.attemptId}`;
    this.assertOnline(path, OperationType.CREATE);
    this.assertOwnerAndValidId(
      actingUid,
      targetUid,
      attempt.attemptId,
      path,
      OperationType.CREATE
    );
    this.assertProfileExists(targetUid, path, OperationType.CREATE);

    if (attempt.deliveryStatus === 'DELIVERED') {
      handleFirestoreError(
        new Error(
          'PERMISSION_DENIED: Clients are forbidden from writing fake DELIVERED notification statuses.'
        ),
        OperationType.CREATE,
        path
      );
    }

    const list = this.notificationAttempts.get(targetUid) ?? [];
    list.unshift(structuredClone(attempt));
    this.notificationAttempts.set(targetUid, list);
  }

  public getNotificationAttempts(
    actingUid: string | null,
    targetUid: string
  ): NotificationAttemptRecord[] {
    const path = `users/${targetUid}/notificationAttempts`;
    this.assertOnline(path, OperationType.LIST);
    this.assertOwnerAndValidId(actingUid, targetUid, 'list', path, OperationType.LIST);
    return structuredClone(this.notificationAttempts.get(targetUid) ?? []);
  }

  public saveNormalizedObservationFromClient(
    actingUid: string | null,
    targetUid: string,
    obs: NormalizedObservation
  ): void {
    const path = `users/${targetUid}/normalizedObservations/${obs.observationId}`;
    this.assertOnline(path, OperationType.CREATE);
    this.assertOwnerAndValidId(
      actingUid,
      targetUid,
      obs.observationId,
      path,
      OperationType.CREATE
    );
    this.assertProfileExists(targetUid, path, OperationType.CREATE);

    if (obs.authenticatedOwnerId !== targetUid) {
      handleFirestoreError(
        new Error('PERMISSION_DENIED: Observation authenticatedOwnerId mismatch.'),
        OperationType.CREATE,
        path
      );
    }

    if (obs.dataMode === 'REAL') {
      handleFirestoreError(
        new Error(
          'PERMISSION_DENIED: Direct client writes cannot persist observations as REAL.'
        ),
        OperationType.CREATE,
        path
      );
    }

    const list = this.normalizedObservations.get(targetUid) ?? [];
    list.unshift(structuredClone(obs));
    this.normalizedObservations.set(targetUid, list.slice(0, 200));
  }

  public saveNormalizedObservationFromServer(
    targetUid: string,
    obs: NormalizedObservation
  ): void {
    const path = `users/${targetUid}/normalizedObservations/${obs.observationId}`;
    this.assertProfileExists(targetUid, path, OperationType.CREATE);
    if (
      obs.dataMode === 'REAL' &&
      obs.sourceProvider === 'vitaguard-simulation-sandbox'
    ) {
      throw new Error(
        'INVARIANT_VIOLATION: Simulation provider observations can never be stored as REAL.'
      );
    }
    const list = this.normalizedObservations.get(targetUid) ?? [];
    list.unshift(structuredClone(obs));
    this.normalizedObservations.set(targetUid, list.slice(0, 200));
  }

  public resetDemoDataOnly(
    actingUid: string | null,
    targetUid: string
  ): { preservedRealCount: number; purgedSimulatedCount: number } {
    const path = `users/${targetUid}/normalizedObservations`;
    this.assertOnline(path, OperationType.WRITE);
    this.assertOwnerAndValidId(actingUid, targetUid, 'reset', path, OperationType.WRITE);
    this.assertProfileExists(targetUid, path, OperationType.WRITE);

    const existingObs = this.normalizedObservations.get(targetUid) ?? [];
    const realOnly = existingObs.filter((o) => o.dataMode === 'REAL');
    const purgedSimulatedCount = existingObs.filter((o) => o.dataMode === 'SIMULATED').length;

    this.normalizedObservations.set(targetUid, realOnly);
    this.observations.set(targetUid, []);
    this.assessments.set(targetUid, []);
    this.alerts.set(targetUid, new Map());
    this.escalationTasks.set(targetUid, new Map());
    this.notificationAttempts.set(targetUid, []);

    return {
      preservedRealCount: realOnly.length,
      purgedSimulatedCount,
    };
  }

  public getNormalizedObservations(
    actingUid: string | null,
    targetUid: string
  ): NormalizedObservation[] {
    const path = `users/${targetUid}/normalizedObservations`;
    this.assertOnline(path, OperationType.LIST);
    this.assertOwnerAndValidId(actingUid, targetUid, 'list', path, OperationType.LIST);
    return structuredClone(this.normalizedObservations.get(targetUid) ?? []);
  }
}
