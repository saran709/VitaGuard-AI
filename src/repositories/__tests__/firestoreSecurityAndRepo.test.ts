import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  evaluateProtectedRouteAccess,
  mapFirebaseAuthError,
  registerInLocalVault,
  signInWithLocalVault,
} from '../../context/AuthContext';
import {
  acknowledgeAlertIdempotent,
  canEscalateAlert,
  createAlertFromAssessment,
  resolveAlert,
  upsertAlertHistory,
} from '../../engine/alertManager';
import {
  DEFAULT_THRESHOLDS,
  evaluateRisk,
  RULE_ENGINE_VERSION,
  SIMULATION_PRESETS,
} from '../../engine/riskEngine';
import {
  clearWriteDeduplicationCache,
  createInitialUserWorkspace,
  loadUserWorkspaceState,
  saveUserWorkspaceState,
  SecureSafetyRepositorySimulator,
  shouldSkipDuplicateWrite,
} from '../safetyRepository';
import {
  EscalationStage,
  FirestoreErrorInfo,
  OperationType,
  RiskLevel,
} from '../../types/safety';

// Polyfill window.localStorage for Node Vitest environment if not present
const memoryStorage = new Map<string, string>();
if (typeof globalThis.window === 'undefined') {
  Object.defineProperty(globalThis, 'window', {
    value: {
      localStorage: {
        getItem: (k: string) => memoryStorage.get(k) ?? null,
        setItem: (k: string, v: string) => memoryStorage.set(k, v),
        removeItem: (k: string) => memoryStorage.delete(k),
        clear: () => memoryStorage.clear(),
      },
    },
    configurable: true,
  });
}

describe('VitaGuard AI — Authentication, Protected Routes & Firestore Security', () => {
  let repo: SecureSafetyRepositorySimulator;
  const userAlpha = 'uid-alpha-101';
  const userBeta = 'uid-beta-202';

  beforeEach(() => {
    memoryStorage.clear();
    repo = new SecureSafetyRepositorySimulator();
    clearWriteDeduplicationCache();

    repo.createProfile(userAlpha, userAlpha, {
      uid: userAlpha,
      email: 'alpha@vitaguard.org',
      displayName: 'Alpha Operator',
      simulationNoticeAccepted: true,
      createdAt: '2026-10-22T10:00:00.000Z',
      updatedAt: '2026-10-22T10:00:00.000Z',
    });

    repo.createProfile(userBeta, userBeta, {
      uid: userBeta,
      email: 'beta@vitaguard.org',
      displayName: 'Beta Operator',
      simulationNoticeAccepted: true,
      createdAt: '2026-10-22T10:00:00.000Z',
      updatedAt: '2026-10-22T10:00:00.000Z',
    });
  });

  it('allows a user to register, log in, and enforces protected routes when logged out', () => {
    // 1. Register new account
    const registered = registerInLocalVault(
      'alice@vitaguard.org',
      'SecurePass123!',
      'Alice Carter'
    );
    expect(registered.email).toBe('alice@vitaguard.org');
    expect(registered.displayName).toBe('Alice Carter');
    expect(registered.uid).toMatch(/^usr-alice/);

    // 2. Duplicate registration with same email is rejected
    expect(() =>
      registerInLocalVault('alice@vitaguard.org', 'AnotherPass123!', 'Alice 2')
    ).toThrowError(/Email already in use/);

    // 3. Sign in with wrong password fails
    expect(() =>
      signInWithLocalVault('alice@vitaguard.org', 'WrongPassword')
    ).toThrowError(/Invalid email or password/);

    // 4. Sign in with valid credentials succeeds
    const signedIn = signInWithLocalVault('alice@vitaguard.org', 'SecurePass123!');
    expect(signedIn.uid).toBe(registered.uid);
    expect(evaluateProtectedRouteAccess(true, signedIn)).toEqual({
      allowed: true,
      reason: 'authenticated',
    });

    // 5. Logged out state blocks protected route
    expect(evaluateProtectedRouteAccess(true, null)).toEqual({
      allowed: false,
      reason: 'unauthenticated',
    });
    expect(evaluateProtectedRouteAccess(false, null)).toEqual({
      allowed: false,
      reason: 'loading',
    });

    expect(mapFirebaseAuthError({ code: 'auth/invalid-credential' })).toContain(
      'Invalid email or password'
    );
  });

  it('loads the signed-in user data and persists risk assessments and alert history across page reloads', () => {
    const alice = registerInLocalVault(
      'alice.reload@vitaguard.org',
      'Secret123!',
      'Alice'
    );

    const workspace = loadUserWorkspaceState(alice.uid, alice.uid);
    expect(workspace.uid).toBe(alice.uid);

    // Apply High Risk scenario and create alert
    const highPreset = SIMULATION_PRESETS.find((p) => p.id === 'high-heat-strain')!;
    const assessment = evaluateRisk(highPreset.vitals, highPreset.environment);
    const alert = createAlertFromAssessment(
      assessment,
      null,
      '2026-10-22T14:00:00.000Z'
    )!;

    const updatedWorkspace = {
      ...workspace,
      vitals: highPreset.vitals,
      environment: highPreset.environment,
      activePresetId: highPreset.id,
      activeAlert: alert,
      alertHistory: upsertAlertHistory(workspace.alertHistory, alert),
      lastAssessment: assessment,
    };

    saveUserWorkspaceState(alice.uid, alice.uid, updatedWorkspace);

    // Simulate page refresh: reload workspace for Alice
    const reloaded = loadUserWorkspaceState(alice.uid, alice.uid);
    expect(reloaded.lastAssessment?.riskLevel).toBe(RiskLevel.HIGH);
    expect(reloaded.activeAlert?.id).toBe(alert.id);
    expect(reloaded.activeAlert?.status).toBe('ACTIVE');
    expect(reloaded.alertHistory).toHaveLength(1);
    expect(reloaded.alertHistory[0].status).toBe('ACTIVE');

    // Acknowledge the alert ("I am safe") and save
    const { updatedAlert } = acknowledgeAlertIdempotent(
      reloaded.activeAlert!,
      'I am safe after reload test.',
      '2026-10-22T14:01:00.000Z'
    );

    saveUserWorkspaceState(alice.uid, alice.uid, {
      ...reloaded,
      activeAlert: updatedAlert,
      alertHistory: upsertAlertHistory(reloaded.alertHistory, updatedAlert),
    });

    // Simulate second page refresh: verify acknowledged status persists
    const reloadedAfterAck = loadUserWorkspaceState(alice.uid, alice.uid);
    expect(reloadedAfterAck.activeAlert?.acknowledged).toBe(true);
    expect(reloadedAfterAck.activeAlert?.status).toBe('ACKNOWLEDGED');
    expect(reloadedAfterAck.alertHistory[0].status).toBe('ACKNOWLEDGED');
    expect(reloadedAfterAck.alertHistory[0].acknowledgementNote).toBe(
      'I am safe after reload test.'
    );
  });

  it('persists Firestore repository operations (settings, contacts, observations, risk assessments)', () => {
    const customThresholds = {
      ...DEFAULT_THRESHOLDS,
      heartRate: {
        ...DEFAULT_THRESHOLDS.heartRate,
        criticalHigh: 160,
      },
    };
    repo.saveSettings(userAlpha, userAlpha, customThresholds);
    const loadedSettings = repo.getSettings(userAlpha, userAlpha);
    expect(loadedSettings.heartRate.criticalHigh).toBe(160);

    repo.saveContact(userAlpha, userAlpha, {
      id: 'contact-alpha-1',
      name: 'Elena Vance',
      relationship: 'Medical Proxy',
      phoneDisplay: '+1 (555) 014-8921',
      email: 'elena@example.org',
      isPrimary: true,
      notifyOnLevel: RiskLevel.HIGH,
    });
    const contacts = repo.listContacts(userAlpha, userAlpha);
    expect(contacts).toHaveLength(1);
    expect(contacts[0].name).toBe('Elena Vance');

    const preset = SIMULATION_PRESETS[2];
    const assessment = evaluateRisk(preset.vitals, preset.environment);
    expect(assessment.ruleVersion).toBe(RULE_ENGINE_VERSION);

    repo.recordObservationAndAssessment(
      userAlpha,
      userAlpha,
      preset.vitals,
      preset.environment,
      assessment,
      true
    );

    expect(shouldSkipDuplicateWrite('obs:uid-alpha-101', 'sig-1')).toBe(false);
    expect(shouldSkipDuplicateWrite('obs:uid-alpha-101', 'sig-1')).toBe(true);
    expect(shouldSkipDuplicateWrite('obs:uid-alpha-101', 'sig-2')).toBe(false);
  });

  it('enforces strict user data isolation and rejects cross-user reads or writes', () => {
    repo.saveContact(userAlpha, userAlpha, {
      id: 'contact-private',
      name: 'Private Contact',
      relationship: 'Spouse',
      phoneDisplay: '+1 (555) 010-9999',
      email: 'private@example.org',
      isPrimary: true,
      notifyOnLevel: RiskLevel.CRITICAL,
    });

    // User Beta attempting to list User Alpha's emergency contacts must fail with PERMISSION_DENIED
    expect(() => repo.listContacts(userBeta, userAlpha)).toThrowError(
      /PERMISSION_DENIED/
    );

    // User Beta attempting to overwrite User Alpha's risk settings must fail
    expect(() =>
      repo.saveSettings(userBeta, userAlpha, DEFAULT_THRESHOLDS)
    ).toThrowError(/PERMISSION_DENIED/);

    // User Beta attempting to load or overwrite User Alpha's persisted workspace must fail
    expect(() => loadUserWorkspaceState(userBeta, userAlpha)).toThrowError(
      /PERMISSION_DENIED/
    );
    expect(() =>
      saveUserWorkspaceState(
        userBeta,
        userAlpha,
        createInitialUserWorkspace(userAlpha)
      )
    ).toThrowError(/PERMISSION_DENIED/);

    // Unauthenticated client attempting to read settings must fail
    expect(() => repo.getSettings(null, userAlpha)).toThrowError(
      /PERMISSION_DENIED: Unauthenticated/
    );
  });

  it('persists alert creation (ACTIVE), acknowledgement (ACKNOWLEDGED), and resolution (RESOLVED)', () => {
    const highPreset = SIMULATION_PRESETS.find((p) => p.id === 'high-heat-strain')!;
    const assessment = evaluateRisk(highPreset.vitals, highPreset.environment);
    const initialAlert = createAlertFromAssessment(
      assessment,
      null,
      '2026-10-22T12:00:00.000Z'
    )!;

    expect(initialAlert.status).toBe('ACTIVE');
    const created = repo.createAlert(userAlpha, userAlpha, initialAlert);
    expect(created.status).toBe('ACTIVE');
    expect(created.acknowledged).toBe(false);

    const { alert: ackedAlert, alreadyAcknowledged } = repo.acknowledgeAlert(
      userAlpha,
      userAlpha,
      created.id,
      'I am safe indoors.',
      '2026-10-22T12:00:25.000Z'
    );

    expect(alreadyAcknowledged).toBe(false);
    expect(ackedAlert.status).toBe('ACKNOWLEDGED');
    expect(ackedAlert.acknowledged).toBe(true);
    expect(ackedAlert.escalationStage).toBe(EscalationStage.ACKNOWLEDGED_SAFE);

    const resolved = repo.resolveAlert(
      userAlpha,
      userAlpha,
      created.id,
      '2026-10-22T12:05:00.000Z'
    );
    expect(resolved.status).toBe('RESOLVED');
  });

  it('handles duplicate acknowledgement requests idempotently without creating duplicate audit events', () => {
    const criticalPreset = SIMULATION_PRESETS.find(
      (p) => p.id === 'critical-hypoxia-heat'
    )!;
    const assessment = evaluateRisk(criticalPreset.vitals, criticalPreset.environment);
    const alert = createAlertFromAssessment(
      assessment,
      null,
      '2026-10-22T12:10:00.000Z'
    )!;

    repo.createAlert(userAlpha, userAlpha, alert);

    const firstAck = repo.acknowledgeAlert(
      userAlpha,
      userAlpha,
      alert.id,
      'Confirmed safe on first click.',
      '2026-10-22T12:10:10.000Z'
    );
    expect(firstAck.alreadyAcknowledged).toBe(false);
    expect(firstAck.alert.status).toBe('ACKNOWLEDGED');

    const auditCountAfterFirst = repo.getAuditEvents(userAlpha, userAlpha).length;

    const secondAck = repo.acknowledgeAlert(
      userAlpha,
      userAlpha,
      alert.id,
      'Duplicate second click.',
      '2026-10-22T12:10:12.000Z'
    );
    expect(secondAck.alreadyAcknowledged).toBe(true);
    expect(secondAck.alert.acknowledgedAt).toBe('2026-10-22T12:10:10.000Z');
    expect(secondAck.alert.acknowledgementNote).toBe('Confirmed safe on first click.');

    const auditCountAfterSecond = repo.getAuditEvents(userAlpha, userAlpha).length;
    expect(auditCountAfterSecond).toBe(auditCountAfterFirst);

    const directDup = acknowledgeAlertIdempotent(firstAck.alert, 'Another click');
    expect(directDup.alreadyAcknowledged).toBe(true);
    expect(directDup.timelineEvent).toBeNull();
  });

  it('rejects unauthorized writes, shadow fields, unflagged non-simulated data, and audit log deletion', () => {
    expect(() =>
      repo.saveContact(
        userAlpha,
        userAlpha,
        {
          id: 'contact-shadow',
          name: 'Test',
          relationship: 'Friend',
          phoneDisplay: '555-0199',
          email: 'test@example.org',
          isPrimary: false,
          notifyOnLevel: RiskLevel.HIGH,
        },
        { role: 'admin', isVerified: true }
      )
    ).toThrowError(/Shadow fields are forbidden/);

    const nominal = SIMULATION_PRESETS[0];
    const assessment = evaluateRisk(nominal.vitals, nominal.environment);
    expect(() =>
      repo.recordObservationAndAssessment(
        userAlpha,
        userAlpha,
        nominal.vitals,
        nominal.environment,
        assessment,
        false
      )
    ).toThrowError(/isSimulated == true/);

    expect(() =>
      repo.saveSettings('uid-orphan-999', 'uid-orphan-999', DEFAULT_THRESHOLDS)
    ).toThrowError(/Master Gate failed/);

    expect(() =>
      repo.attemptDeleteAuditEvent(userAlpha, userAlpha, 'evt-1')
    ).toThrowError(/Audit events are immutable/);
  });

  it('formats offline and permission errors as structured FirestoreErrorInfo JSON', () => {
    repo.setOfflineMode(true);

    let thrownError: Error | null = null;
    try {
      repo.getSettings(userAlpha, userAlpha);
    } catch (err) {
      thrownError = err as Error;
    }

    expect(thrownError).not.toBeNull();
    const parsed = JSON.parse(thrownError!.message) as FirestoreErrorInfo;
    expect(parsed.operationType).toBe(OperationType.GET);
    expect(parsed.path).toBe(`users/${userAlpha}/settings/default`);
    expect(parsed.error).toContain('client is offline');
  });

  it('prevents a stale escalation timer from escalating an alert after it has been acknowledged', () => {
    const criticalPreset = SIMULATION_PRESETS.find(
      (p) => p.id === 'critical-hypoxia-heat'
    )!;
    const assessment = evaluateRisk(criticalPreset.vitals, criticalPreset.environment);
    const alert = createAlertFromAssessment(
      assessment,
      null,
      '2026-10-22T12:20:00.000Z'
    )!;

    repo.createAlert(userAlpha, userAlpha, alert);

    const firstTick = repo.escalateAlertTick(userAlpha, userAlpha, alert.id, 20);
    expect(firstTick.escalated).toBe(true);
    expect(firstTick.alert.escalationStage).toBe(EscalationStage.CHECK_IN_OVERDUE);
    expect(canEscalateAlert(firstTick.alert)).toBe(true);

    const acked = repo.acknowledgeAlert(
      userAlpha,
      userAlpha,
      alert.id,
      'I am safe now.',
      '2026-10-22T12:20:22.000Z'
    );
    expect(acked.alert.status).toBe('ACKNOWLEDGED');
    expect(canEscalateAlert(acked.alert)).toBe(false);

    const staleTick = repo.escalateAlertTick(userAlpha, userAlpha, alert.id, 45);
    expect(staleTick.escalated).toBe(false);
    expect(staleTick.alert.status).toBe('ACKNOWLEDGED');
    expect(staleTick.alert.escalationStage).toBe(EscalationStage.ACKNOWLEDGED_SAFE);

    const resolved = resolveAlert(acked.alert);
    expect(canEscalateAlert(resolved)).toBe(false);
  });

  it('verifies firestore.rules enforces all 7 collection match blocks, default deny, owner isolation, and terminal locks', () => {
    const rulesPath = path.resolve(process.cwd(), 'firestore.rules');
    const rulesContent = fs.readFileSync(rulesPath, 'utf-8');

    // Global default-deny safety net
    expect(rulesContent).toContain('match /{document=**}');
    expect(rulesContent).toContain('allow read, write: if false;');

    // All 7 required collections
    expect(rulesContent).toContain('match /users/{uid}');
    expect(rulesContent).toContain('match /settings/{settingId}');
    expect(rulesContent).toContain('match /emergencyContacts/{contactId}');
    expect(rulesContent).toContain('match /observations/{observationId}');
    expect(rulesContent).toContain('match /riskAssessments/{assessmentId}');
    expect(rulesContent).toContain('match /alerts/{alertId}');
    expect(rulesContent).toContain('match /auditEvents/{eventId}');

    // Strict validation blueprints and terminal locks
    expect(rulesContent).toContain('isValidUserProfile(incoming(), uid)');
    expect(rulesContent).toContain('isValidUserSettings(incoming(), uid)');
    expect(rulesContent).toContain('isValidEmergencyContact(incoming(), uid)');
    expect(rulesContent).toContain('isValidObservation(incoming(), uid)');
    expect(rulesContent).toContain('isValidRiskAssessment(incoming(), uid)');
    expect(rulesContent).toContain('isValidSafetyAlert(incoming(), uid)');
    expect(rulesContent).toContain('isValidAuditEvent(incoming(), uid)');
    expect(rulesContent).toContain("existing().status != 'RESOLVED'");
  });
});
