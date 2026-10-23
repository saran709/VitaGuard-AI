import { describe, expect, it, vi } from 'vitest';
import { createAlertFromAssessment } from '../../engine/alertManager';
import { DEFAULT_THRESHOLDS, evaluateRisk, SIMULATION_PRESETS } from '../../engine/riskEngine';
import { SecureSafetyRepositorySimulator } from '../../repositories/safetyRepository';
import {
  buildPrivacySafeNotificationMessage,
  DEFAULT_ESCALATION_POLICY,
  DurableEscalationCoordinator,
  SimulationNotificationProvider,
  validateEscalationPolicy,
  VerifiedSmsGatewayAdapter,
} from '../notificationEngine';
import { EmergencyContact, RiskLevel, SafetyAlert } from '../../types/safety';

function createSampleHighAlert(nowIso: string = '2026-05-01T12:00:00.000Z'): SafetyAlert {
  const preset = SIMULATION_PRESETS.find((p) => p.expectedRisk === RiskLevel.CRITICAL)!;
  const assessment = evaluateRisk(preset.vitals, preset.environment, DEFAULT_THRESHOLDS);
  const alert = createAlertFromAssessment(assessment, null, nowIso);
  if (!alert) {
    throw new Error('Expected HIGH or CRITICAL alert to be created');
  }
  return alert;
}

const VERIFIED_PRIMARY_CONTACT: EmergencyContact = {
  id: 'contact-verified-1',
  name: 'Elena Vance',
  relationship: 'Primary Partner',
  phoneDisplay: '+1 (555) 014-8921',
  email: 'elena.vance@example.org',
  isPrimary: true,
  notifyOnLevel: RiskLevel.HIGH,
  verificationStatus: 'VERIFIED',
  consentGranted: true,
  verifiedAtIso: '2026-01-01T00:00:00.000Z',
};

const UNVERIFIED_SECONDARY_CONTACT: EmergencyContact = {
  id: 'contact-unverified-2',
  name: 'Marcus Chen',
  relationship: 'Coordinator',
  phoneDisplay: '+1 (555) 018-4410',
  email: 'm.chen@example.org',
  isPrimary: false,
  notifyOnLevel: RiskLevel.HIGH,
  verificationStatus: 'PENDING_CODE',
  consentGranted: false,
};

describe('VitaGuard AI — Reliable Emergency Notifications & Escalation', () => {
  it('1. Alert creation schedules and persists a durable escalation deadline that survives coordinator restart', () => {
    const provider = new SimulationNotificationProvider();
    const coordinatorA = new DurableEscalationCoordinator({ provider });
    const createdIso = '2026-05-01T12:00:00.000Z';
    const createdMs = Date.parse(createdIso);
    const rawAlert = {
      ...createSampleHighAlert(createdIso),
      escalationDeadlineIso: undefined,
    };

    const { alert, task } = coordinatorA.scheduleAlertEscalation({
      actingUid: 'user-alpha',
      targetUid: 'user-alpha',
      alert: rawAlert,
      contacts: [VERIFIED_PRIMARY_CONTACT],
      policy: {
        ...DEFAULT_ESCALATION_POLICY,
        criticalTimeoutSeconds: 45,
      },
      nowMs: createdMs,
    });

    expect(alert.escalationTaskId).toBe(`task-esc-${rawAlert.id}`);
    expect(alert.escalationTaskStatus).toBe('SCHEDULED');
    expect(alert.escalationTimeoutSeconds).toBe(45);
    expect(alert.escalationDeadlineIso).toBe('2026-05-01T12:00:45.000Z');
    expect(task.status).toBe('SCHEDULED');

    // Simulate browser refresh & worker restart by exporting snapshot and restoring into a fresh instance
    const snapshot = coordinatorA.exportSnapshot();
    const coordinatorB = new DurableEscalationCoordinator({
      provider,
      initialSnapshot: snapshot,
    });

    const restoredTask = coordinatorB.getTaskForAlert(
      'user-alpha',
      'user-alpha',
      rawAlert.id
    );
    expect(restoredTask).not.toBeNull();
    expect(restoredTask?.deadlineIso).toBe('2026-05-01T12:00:45.000Z');
    expect(restoredTask?.status).toBe('SCHEDULED');
  });

  it('2. User acknowledgement ("I am safe") cancels pending escalation task', () => {
    const provider = new SimulationNotificationProvider();
    const coordinator = new DurableEscalationCoordinator({ provider });
    const createdMs = Date.parse('2026-05-01T12:00:00.000Z');
    const rawAlert = createSampleHighAlert('2026-05-01T12:00:00.000Z');

    coordinator.scheduleAlertEscalation({
      actingUid: 'user-alpha',
      targetUid: 'user-alpha',
      alert: rawAlert,
      contacts: [VERIFIED_PRIMARY_CONTACT],
      policy: DEFAULT_ESCALATION_POLICY,
      nowMs: createdMs,
    });

    const ackResult = coordinator.acknowledgeAlertAndCancelEscalation({
      actingUid: 'user-alpha',
      targetUid: 'user-alpha',
      alertId: rawAlert.id,
      note: 'Resting indoors with water.',
      nowMs: createdMs + 10_000,
    });

    expect(ackResult.alreadyAcknowledged).toBe(false);
    expect(ackResult.alert.status).toBe('ACKNOWLEDGED');
    expect(ackResult.alert.acknowledged).toBe(true);
    expect(ackResult.alert.escalationTaskStatus).toBe('CANCELLED');
    expect(ackResult.task?.status).toBe('CANCELLED');
    expect(ackResult.task?.lastOutcomeNote).toContain('Escalation cancelled');
  });

  it('3. Repeated acknowledgement is idempotent and does not emit duplicate cancellation events', () => {
    const provider = new SimulationNotificationProvider();
    const coordinator = new DurableEscalationCoordinator({ provider });
    const createdMs = Date.parse('2026-05-01T12:00:00.000Z');
    const rawAlert = createSampleHighAlert('2026-05-01T12:00:00.000Z');

    coordinator.scheduleAlertEscalation({
      actingUid: 'user-alpha',
      targetUid: 'user-alpha',
      alert: rawAlert,
      contacts: [VERIFIED_PRIMARY_CONTACT],
      policy: DEFAULT_ESCALATION_POLICY,
      nowMs: createdMs,
    });

    const firstAck = coordinator.acknowledgeAlertAndCancelEscalation({
      actingUid: 'user-alpha',
      targetUid: 'user-alpha',
      alertId: rawAlert.id,
      note: 'First safe check-in.',
      nowMs: createdMs + 10_000,
    });

    const eventsCountAfterFirst = coordinator.getAuditEventsForUser(
      'user-alpha',
      'user-alpha'
    ).length;

    const secondAck = coordinator.acknowledgeAlertAndCancelEscalation({
      actingUid: 'user-alpha',
      targetUid: 'user-alpha',
      alertId: rawAlert.id,
      note: 'Second click on I am safe.',
      nowMs: createdMs + 12_000,
    });

    const eventsCountAfterSecond = coordinator.getAuditEventsForUser(
      'user-alpha',
      'user-alpha'
    ).length;

    expect(firstAck.alreadyAcknowledged).toBe(false);
    expect(secondAck.alreadyAcknowledged).toBe(true);
    expect(eventsCountAfterSecond).toBe(eventsCountAfterFirst);
    expect(secondAck.alert.acknowledgedAt).toBe('2026-05-01T12:00:10.000Z');
  });

  it('4. Expired active alert triggers contact notification according to policy', async () => {
    const provider = new SimulationNotificationProvider();
    const coordinator = new DurableEscalationCoordinator({ provider });
    const createdMs = Date.parse('2026-05-01T12:00:00.000Z');
    const rawAlert = createSampleHighAlert('2026-05-01T12:00:00.000Z');

    coordinator.scheduleAlertEscalation({
      actingUid: 'user-alpha',
      targetUid: 'user-alpha',
      alert: rawAlert,
      contacts: [VERIFIED_PRIMARY_CONTACT],
      policy: DEFAULT_ESCALATION_POLICY,
      nowMs: createdMs,
    });

    // Advance past 30s critical deadline
    const summary = await coordinator.processDueEscalations(createdMs + 35_000);

    expect(summary.completedTaskIds).toHaveLength(1);
    const contactAttempts = coordinator
      .getNotificationAttemptsForUser('user-alpha', 'user-alpha')
      .filter((a) => a.recipientRole === 'EMERGENCY_CONTACT');

    expect(contactAttempts).toHaveLength(1);
    // Honest status distinction: Simulation default returns SUBMITTED (not DELIVERED) unless delivery receipt is confirmed
    expect(contactAttempts[0].deliveryStatus).toBe('SUBMITTED');
    expect(contactAttempts[0].responseClassification).toBe('UNSUPPORTED_RECEIPT');
  });

  it('5. Expired acknowledged alert does not notify contacts when deadline arrives', async () => {
    const provider = new SimulationNotificationProvider();
    const coordinator = new DurableEscalationCoordinator({ provider });
    const createdMs = Date.parse('2026-05-01T12:00:00.000Z');
    const rawAlert = createSampleHighAlert('2026-05-01T12:00:00.000Z');

    coordinator.scheduleAlertEscalation({
      actingUid: 'user-alpha',
      targetUid: 'user-alpha',
      alert: rawAlert,
      contacts: [VERIFIED_PRIMARY_CONTACT],
      policy: DEFAULT_ESCALATION_POLICY,
      nowMs: createdMs,
    });

    coordinator.acknowledgeAlertAndCancelEscalation({
      actingUid: 'user-alpha',
      targetUid: 'user-alpha',
      alertId: rawAlert.id,
      note: 'I am safe.',
      nowMs: createdMs + 10_000,
    });

    const summary = await coordinator.processDueEscalations(createdMs + 60_000);

    expect(summary.completedTaskIds).toHaveLength(0);
    expect(provider.getSendCallCount()).toBe(0);
  });

  it('6. Expired resolved alert does not notify contacts when deadline arrives', async () => {
    const provider = new SimulationNotificationProvider();
    const coordinator = new DurableEscalationCoordinator({ provider });
    const createdMs = Date.parse('2026-05-01T12:00:00.000Z');
    const rawAlert = createSampleHighAlert('2026-05-01T12:00:00.000Z');

    coordinator.scheduleAlertEscalation({
      actingUid: 'user-alpha',
      targetUid: 'user-alpha',
      alert: rawAlert,
      contacts: [VERIFIED_PRIMARY_CONTACT],
      policy: DEFAULT_ESCALATION_POLICY,
      nowMs: createdMs,
    });

    coordinator.resolveAlertAndCancelEscalation({
      actingUid: 'user-alpha',
      targetUid: 'user-alpha',
      alertId: rawAlert.id,
      nowMs: createdMs + 15_000,
    });

    const summary = await coordinator.processDueEscalations(createdMs + 60_000);

    expect(summary.completedTaskIds).toHaveLength(0);
    expect(provider.getSendCallCount()).toBe(0);
  });

  it('7. Duplicate scheduler/task execution is idempotent and does not send duplicate notifications', async () => {
    const provider = new SimulationNotificationProvider();
    const coordinator = new DurableEscalationCoordinator({ provider });
    const createdMs = Date.parse('2026-05-01T12:00:00.000Z');
    const rawAlert = createSampleHighAlert('2026-05-01T12:00:00.000Z');

    const { task } = coordinator.scheduleAlertEscalation({
      actingUid: 'user-alpha',
      targetUid: 'user-alpha',
      alert: rawAlert,
      contacts: [VERIFIED_PRIMARY_CONTACT],
      policy: DEFAULT_ESCALATION_POLICY,
      nowMs: createdMs,
    });

    const firstRun = await coordinator.executeEscalationTask(
      task.taskId,
      createdMs + 40_000
    );
    const secondRun = await coordinator.executeEscalationTask(
      task.taskId,
      createdMs + 41_000
    );

    expect(firstRun.duplicateSkipped).toBe(false);
    expect(firstRun.task.status).toBe('COMPLETED');
    expect(secondRun.duplicateSkipped).toBe(true);
    expect(provider.getSendCallCount()).toBe(1);
  });

  it('8. Concurrent acknowledgement and escalation race safely without notifying contacts after acknowledgement', async () => {
    const provider = new SimulationNotificationProvider();
    const coordinator = new DurableEscalationCoordinator({ provider });
    const createdMs = Date.parse('2026-05-01T12:00:00.000Z');
    const rawAlert = createSampleHighAlert('2026-05-01T12:00:00.000Z');

    const { task } = coordinator.scheduleAlertEscalation({
      actingUid: 'user-alpha',
      targetUid: 'user-alpha',
      alert: rawAlert,
      contacts: [VERIFIED_PRIMARY_CONTACT],
      policy: DEFAULT_ESCALATION_POLICY,
      nowMs: createdMs,
    });

    // User acknowledges right at the deadline while two workers race
    coordinator.acknowledgeAlertAndCancelEscalation({
      actingUid: 'user-alpha',
      targetUid: 'user-alpha',
      alertId: rawAlert.id,
      note: 'Just acknowledged right at deadline.',
      nowMs: createdMs + 30_000,
    });

    const [workerA, workerB] = await Promise.all([
      coordinator.executeEscalationTask(task.taskId, createdMs + 30_000),
      coordinator.executeEscalationTask(task.taskId, createdMs + 30_000),
    ]);

    expect(workerA.task.status).toBe('CANCELLED');
    expect(workerB.task.status).toBe('CANCELLED');
    expect(provider.getSendCallCount()).toBe(0);
  });

  it('9. Unverified or unconsented contacts are blocked from receiving notifications', async () => {
    const provider = new SimulationNotificationProvider();
    const coordinator = new DurableEscalationCoordinator({ provider });
    const createdMs = Date.parse('2026-05-01T12:00:00.000Z');
    const rawAlert = createSampleHighAlert('2026-05-01T12:00:00.000Z');

    const { task } = coordinator.scheduleAlertEscalation({
      actingUid: 'user-alpha',
      targetUid: 'user-alpha',
      alert: rawAlert,
      contacts: [UNVERIFIED_SECONDARY_CONTACT],
      policy: DEFAULT_ESCALATION_POLICY,
      nowMs: createdMs,
    });

    const result = await coordinator.executeEscalationTask(
      task.taskId,
      createdMs + 40_000
    );

    expect(result.task.status).toBe('FAILED');
    expect(result.attemptsRecorded).toHaveLength(1);
    expect(result.attemptsRecorded[0].deliveryStatus).toBe('FAILED');
    expect(result.attemptsRecorded[0].sanitizedError).toContain('Contacts must be VERIFIED');
    expect(provider.getSendCallCount()).toBe(0);
  });

  it('10. Provider transient failure is recorded and schedules bounded exponential backoff retry', async () => {
    const provider = new SimulationNotificationProvider('transient_failure');
    const coordinator = new DurableEscalationCoordinator({
      provider,
      maxRetries: 3,
      baseBackoffMs: 10_000,
    });
    const createdMs = Date.parse('2026-05-01T12:00:00.000Z');
    const rawAlert = createSampleHighAlert('2026-05-01T12:00:00.000Z');

    const { task } = coordinator.scheduleAlertEscalation({
      actingUid: 'user-alpha',
      targetUid: 'user-alpha',
      alert: rawAlert,
      contacts: [VERIFIED_PRIMARY_CONTACT],
      policy: DEFAULT_ESCALATION_POLICY,
      nowMs: createdMs,
    });

    const result = await coordinator.executeEscalationTask(
      task.taskId,
      createdMs + 40_000
    );

    expect(result.task.status).toBe('ATTEMPTED');
    expect(result.task.nextRetryDeadlineIso).toBeDefined();
    expect(result.attemptsRecorded).toHaveLength(1);
    expect(result.attemptsRecorded[0].deliveryStatus).toBe('FAILED');
    expect(result.attemptsRecorded[0].responseClassification).toBe('TRANSIENT');
    expect(result.attemptsRecorded[0].retryEligible).toBe(true);
  });

  it('11. Provider permanent failure (invalid recipient) is classified as PERMANENT and does not loop infinitely', async () => {
    const provider = new SimulationNotificationProvider('permanent_failure');
    const coordinator = new DurableEscalationCoordinator({ provider });
    const createdMs = Date.parse('2026-05-01T12:00:00.000Z');
    const rawAlert = createSampleHighAlert('2026-05-01T12:00:00.000Z');

    coordinator.scheduleAlertEscalation({
      actingUid: 'user-alpha',
      targetUid: 'user-alpha',
      alert: rawAlert,
      contacts: [VERIFIED_PRIMARY_CONTACT],
      policy: DEFAULT_ESCALATION_POLICY,
      nowMs: createdMs,
    });

    const first = await coordinator.processDueEscalations(createdMs + 40_000);
    // Subsequent poll does not re-execute terminal failed task
    const second = await coordinator.processDueEscalations(createdMs + 50_000);

    expect(first.failedTaskIds).toHaveLength(1);
    expect(second.processedTaskIds).toHaveLength(0);
    expect(provider.getSendCallCount()).toBe(1);
  });

  it('12. Provider timeout/unknown response records UNKNOWN status and never falsely marks delivery as DELIVERED', async () => {
    const provider = new SimulationNotificationProvider('timeout_unknown');
    const coordinator = new DurableEscalationCoordinator({ provider });
    const createdMs = Date.parse('2026-05-01T12:00:00.000Z');
    const rawAlert = createSampleHighAlert('2026-05-01T12:00:00.000Z');

    const { task } = coordinator.scheduleAlertEscalation({
      actingUid: 'user-alpha',
      targetUid: 'user-alpha',
      alert: rawAlert,
      contacts: [VERIFIED_PRIMARY_CONTACT],
      policy: DEFAULT_ESCALATION_POLICY,
      nowMs: createdMs,
    });

    const result = await coordinator.executeEscalationTask(
      task.taskId,
      createdMs + 40_000
    );

    expect(result.attemptsRecorded).toHaveLength(1);
    expect(result.attemptsRecorded[0].deliveryStatus).toBe('UNKNOWN');
    expect(result.attemptsRecorded[0].deliveryStatus).not.toBe('DELIVERED');
    expect(result.attemptsRecorded[0].responseClassification).toBe('TIMEOUT');
  });

  it('13. Notification content is privacy-safe and excludes physiological readings (BPM, SpO2, temp) and AI speculation', () => {
    const message = buildPrivacySafeNotificationMessage({
      recipientRole: 'EMERGENCY_CONTACT',
      triggeredAtIso: '2026-05-01T12:00:00.000Z',
      alertId: 'alert-secret-doc-999',
      baseAppUrl: 'https://vitaguard.safety.local',
      customGuidance: 'Check on Alex (HR 168 BPM, SpO2 87%, 39.6°C, users/user-alpha/alerts/123)',
    });

    expect(message).toContain('VitaGuard Safety Check-In Request');
    expect(message).toContain('https://vitaguard.safety.local/?checkin_ref=');
    // Must not leak raw physiological units, raw alert ID, or Firestore collection paths
    expect(message.toLowerCase()).not.toContain('168 bpm');
    expect(message.toLowerCase()).not.toContain('87%');
    expect(message.toLowerCase()).not.toContain('39.6°c');
    expect(message.toLowerCase()).not.toContain('users/user-alpha');
    expect(message).not.toContain('alert-secret-doc-999');
  });

  it('14. User A cannot view or modify User B’s escalation tasks, notification attempts, or alerts', () => {
    const provider = new SimulationNotificationProvider();
    const coordinator = new DurableEscalationCoordinator({ provider });
    const rawAlert = createSampleHighAlert('2026-05-01T12:00:00.000Z');

    coordinator.scheduleAlertEscalation({
      actingUid: 'user-beta',
      targetUid: 'user-beta',
      alert: rawAlert,
      contacts: [VERIFIED_PRIMARY_CONTACT],
      policy: DEFAULT_ESCALATION_POLICY,
    });

    // User Alpha attempts to acknowledge User Beta's alert
    expect(() =>
      coordinator.acknowledgeAlertAndCancelEscalation({
        actingUid: 'user-alpha',
        targetUid: 'user-beta',
        alertId: rawAlert.id,
        note: 'Malicious cross-user ack attempt',
      })
    ).toThrow(/cannot access or modify escalation records/);

    // Also verify repository-level cross-user isolation for escalationTasks and notificationAttempts
    const repo = new SecureSafetyRepositorySimulator();
    repo.createProfile('user-beta', 'user-beta', {
      uid: 'user-beta',
      email: 'beta@example.com',
      displayName: 'Beta',
      simulationNoticeAccepted: true,
      createdAt: '2026-05-01T12:00:00.000Z',
      updatedAt: '2026-05-01T12:00:00.000Z',
    });

    expect(() => repo.getEscalationTasks('user-alpha', 'user-beta')).toThrow(
      /PERMISSION_DENIED/
    );
    expect(() => repo.getNotificationAttempts('user-alpha', 'user-beta')).toThrow(
      /PERMISSION_DENIED/
    );
  });

  it('15. Client cannot directly mark a notification attempt as DELIVERED', () => {
    const coordinator = new DurableEscalationCoordinator();
    expect(() =>
      coordinator.clientAttemptMarkDelivered('user-alpha', 'att-spoof-1')
    ).toThrow(/PERMISSION_DENIED/);

    const repo = new SecureSafetyRepositorySimulator();
    repo.createProfile('user-alpha', 'user-alpha', {
      uid: 'user-alpha',
      email: 'alpha@example.com',
      displayName: 'Alpha',
      simulationNoticeAccepted: true,
      createdAt: '2026-05-01T12:00:00.000Z',
      updatedAt: '2026-05-01T12:00:00.000Z',
    });

    expect(() =>
      repo.recordNotificationAttemptFromClient('user-alpha', 'user-alpha', {
        attemptId: 'att-spoof-1',
        userId: 'user-alpha',
        alertId: 'alert-1',
        recipientRef: 'contact:1 (***-8921)',
        recipientRole: 'EMERGENCY_CONTACT',
        providerId: 'client-spoof',
        deliveryMode: 'SIMULATION',
        attemptNumber: 1,
        idempotencyKey: 'idem-alert-1-contact-1',
        attemptedAtIso: '2026-05-01T12:00:40.000Z',
        responseClassification: 'NONE',
        deliveryStatus: 'DELIVERED',
        retryEligible: false,
        messagePreview: 'Spoofed delivered status',
      })
    ).toThrow(/Clients are forbidden from writing fake DELIVERED notification statuses/);
  });

  it('16. Simulation mode never calls real external notification endpoints, and timeout/consent bounds are strictly enforced', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const simProvider = new SimulationNotificationProvider();
    const coordinator = new DurableEscalationCoordinator({ provider: simProvider });
    const createdMs = Date.parse('2026-05-01T12:00:00.000Z');
    const rawAlert = createSampleHighAlert('2026-05-01T12:00:00.000Z');

    // Out-of-bounds timeouts (<15s critical or >900s high) are rejected
    expect(() =>
      validateEscalationPolicy({
        criticalTimeoutSeconds: 2,
        highTimeoutSeconds: 60,
      })
    ).toThrow(/within validated bounds/);

    // Enabling LIVE mode without explicitLiveConsentGranted and liveReviewCompleted is rejected
    expect(() =>
      validateEscalationPolicy({
        deliveryMode: 'LIVE',
        explicitLiveConsentGranted: true,
        liveReviewCompleted: false,
      })
    ).toThrow(/Explicit user consent and pre-live review confirmation are required/);

    coordinator.scheduleAlertEscalation({
      actingUid: 'user-alpha',
      targetUid: 'user-alpha',
      alert: rawAlert,
      contacts: [VERIFIED_PRIMARY_CONTACT],
      policy: DEFAULT_ESCALATION_POLICY,
      nowMs: createdMs,
    });

    await coordinator.processDueEscalations(createdMs + 35_000);
    expect(fetchSpy).not.toHaveBeenCalled();

    // Also verify VerifiedSmsGatewayAdapter refuses to dispatch when unconfigured or targeting synthetic 555-01xx demo numbers
    const unconfiguredGateway = new VerifiedSmsGatewayAdapter({});
    const gatewayResponse = await unconfiguredGateway.sendEmergencyContactNotification({
      idempotencyKey: 'idem-test-1',
      recipientRef: 'contact:1 (***-8921)',
      recipientAddress: VERIFIED_PRIMARY_CONTACT.phoneDisplay,
      recipientRole: 'EMERGENCY_CONTACT',
      messageBody: 'Privacy-safe test body',
      deliveryMode: 'LIVE',
    });

    expect(gatewayResponse.deliveryStatus).toBe('FAILED');
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
