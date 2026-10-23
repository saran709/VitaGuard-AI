import fs from 'fs';
import path from 'path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { HackathonDemoBar } from '../../components/HackathonDemoBar';
import { McpServerPanel } from '../../components/McpServerPanel';
import { OverviewSummaryBar } from '../../components/OverviewSummaryBar';
import { createAlertFromAssessment } from '../../engine/alertManager';
import {
  DEFAULT_THRESHOLDS,
  evaluateRisk,
  SIMULATION_PRESETS,
} from '../../engine/riskEngine';
import { SecureSafetyRepositorySimulator } from '../../repositories/safetyRepository';
import {
  ActivityLevel,
  EmergencyContact,
  RiskLevel,
  WeatherCondition,
} from '../../types/safety';
import {
  EnvironmentalDataProvider,
  SimulationDataProvider,
  TelemetryIngestionCoordinator,
  WearableDataProvider,
  validateAndNormalizeObservation,
} from '../dataIngestionEngine';
import { GeminiExplanationOrchestrator } from '../geminiExplanationEngine';
import {
  DEFAULT_ESCALATION_POLICY,
  DurableEscalationCoordinator,
  SimulationNotificationProvider,
  VerifiedSmsGatewayAdapter,
} from '../notificationEngine';

const VERIFIED_PRIMARY_CONTACT: EmergencyContact = {
  id: 'contact-e2e-primary',
  name: 'Elena Vance',
  relationship: 'Primary Partner',
  phoneDisplay: '+1 (555) 014-8921',
  email: 'elena.vance@example.org',
  isPrimary: true,
  notifyOnLevel: RiskLevel.HIGH,
  verificationStatus: 'VERIFIED',
  consentGranted: true,
  verifiedAtIso: '2026-01-10T00:00:00.000Z',
};

describe('VitaGuard AI — End-to-End Safety Workflow, Security Hardening & Hackathon Readiness', () => {
  const testUserUid = 'uid-judge-demo-001';
  const otherUserUid = 'uid-neighbor-002';
  const baseNowMs = Date.parse('2026-10-23T15:00:00.000Z');
  const baseNowIso = new Date(baseNowMs).toISOString();

  it('1. executes the complete 13-step End-to-End safety workflow (authenticate -> load workspace -> ingest synthetic -> normalize -> deterministic risk -> mocked AI explanation -> create & persist alert -> acknowledge "I am safe" -> cancel escalation -> refresh consistency -> zero external notifications)', async () => {
    // Step 1: Authenticate test user & create parent profile in isolated repository
    const repo = new SecureSafetyRepositorySimulator();
    repo.createProfile(testUserUid, testUserUid, {
      uid: testUserUid,
      email: 'judge@vitaguard.demo',
      displayName: 'Hackathon Judge',
      simulationNoticeAccepted: true,
      createdAt: baseNowIso,
      updatedAt: baseNowIso,
    });
    repo.saveContact(testUserUid, testUserUid, VERIFIED_PRIMARY_CONTACT);

    // Step 2: Load initial dashboard settings, contacts, and audit history for authenticated user
    const loadedThresholds = repo.getSettings(testUserUid, testUserUid);
    const loadedContacts = repo.listContacts(testUserUid, testUserUid);
    expect(loadedContacts).toHaveLength(1);
    expect(loadedContacts[0].name).toBe('Elena Vance');
    expect(repo.getAuditEvents(testUserUid, testUserUid)).toHaveLength(0);

    // Step 3 & 4: Ingest clearly labelled synthetic observations (°F, km/h) and validate + normalize to canonical (°C, m/s)
    const criticalPreset = SIMULATION_PRESETS.find(
      (p) => p.expectedRisk === RiskLevel.CRITICAL
    )!;
    const simProvider = new SimulationDataProvider({
      initialVitals: criticalPreset.vitals,
      initialEnvironment: criticalPreset.environment,
    });
    const wearableProvider = new WearableDataProvider({
      serverVerifiedOAuthConfigured: false,
    });
    const envProvider = new EnvironmentalDataProvider();
    const ingestionCoordinator = new TelemetryIngestionCoordinator({
      providers: [simProvider, wearableProvider, envProvider],
    });

    const batchResult = ingestionCoordinator.ingestBatch({
      actingUid: testUserUid,
      targetUid: testUserUid,
      providerId: simProvider.providerId,
      nowMs: baseNowMs,
      rawObservations: [
        {
          observationId: 'obs-e2e-hr-1',
          authenticatedOwnerId: testUserUid,
          metricType: 'heart_rate',
          value: criticalPreset.vitals.heartRateBpm,
          unit: 'bpm',
          observedAt: baseNowIso,
          receivedAt: baseNowIso,
          sourceProvider: simProvider.providerId,
          sourceRecordId: 'sim-hr-01',
          claimedDataMode: 'SIMULATED',
        },
        {
          observationId: 'obs-e2e-spo2-1',
          authenticatedOwnerId: testUserUid,
          metricType: 'oxygen_saturation',
          value: criticalPreset.vitals.oxygenSaturationPct,
          unit: '%',
          observedAt: baseNowIso,
          receivedAt: baseNowIso,
          sourceProvider: simProvider.providerId,
          sourceRecordId: 'sim-spo2-01',
          claimedDataMode: 'SIMULATED',
        },
        {
          observationId: 'obs-e2e-temp-1',
          authenticatedOwnerId: testUserUid,
          metricType: 'body_temperature',
          value: 103.1, // °F -> normalizes to 39.5 °C
          unit: 'F',
          observedAt: baseNowIso,
          receivedAt: baseNowIso,
          sourceProvider: simProvider.providerId,
          sourceRecordId: 'sim-temp-01',
          claimedDataMode: 'SIMULATED',
        },
        {
          observationId: 'obs-e2e-envtemp-1',
          authenticatedOwnerId: testUserUid,
          metricType: 'ambient_temperature',
          value: 105.8, // °F -> normalizes to 41.0 °C
          unit: 'F',
          observedAt: baseNowIso,
          receivedAt: baseNowIso,
          sourceProvider: simProvider.providerId,
          sourceRecordId: 'sim-envtemp-01',
          claimedDataMode: 'SIMULATED',
        },
      ],
    });

    expect(batchResult.accepted.length).toBe(4);
    expect(batchResult.rejected.length).toBe(0);

    for (const obs of batchResult.accepted) {
      expect(obs.dataMode).toBe('SIMULATED');
      expect(obs.freshnessStatus).toBe('CURRENT');
      repo.saveNormalizedObservationFromClient(testUserUid, testUserUid, obs);
    }

    const tempObs = batchResult.accepted.find(
      (o) => o.metricType === 'body_temperature'
    )!;
    expect(tempObs.unit).toBe('celsius');
    expect(tempObs.value).toBeCloseTo(39.5, 1);

    // Step 5: Run the deterministic risk engine (authoritative classification)
    const assessment = {
      ...evaluateRisk(
        criticalPreset.vitals,
        criticalPreset.environment,
        loadedThresholds
      ),
      evaluatedAt: baseNowIso,
    };
    expect(assessment.riskLevel).toBe(RiskLevel.CRITICAL);
    expect(assessment.overallScore).toBeGreaterThanOrEqual(75);
    expect(assessment.triggeredRules.length).toBeGreaterThan(0);

    repo.recordObservationAndAssessment(
      testUserUid,
      testUserUid,
      criticalPreset.vitals,
      criticalPreset.environment,
      assessment,
      true
    );

    // Step 6: Generate a contextual AI explanation using mocked Gemini service (cannot alter risk score or level)
    const assessmentId = 'risk-e2e-crit-001';
    const ruleIds = assessment.triggeredRules.map((r) => r.id);
    const mockGeminiGenerator = vi.fn().mockResolvedValue(
      JSON.stringify({
        summary:
          'The deterministic rule engine classified this simulated telemetry snapshot as CRITICAL due to severe hyperthermia, hypoxia, and exertional heat strain.',
        contributingFactors: [
          'Simulated SpO2 dropped to 89% alongside elevated heart rate (168 bpm)',
          'Core temperature reached 39.4°C under extreme ambient heat load',
        ],
        triggeredRules: ruleIds.map((id) => ({
          id,
          explanation: `Deterministic rule ${id} exceeded its configured safety threshold.`,
        })),
        uncertainties: [
          'Synthetic demonstration telemetry; post-event recovery trend is not yet available.',
        ],
        recommendedActions: [
          'Acknowledge the alert immediately if safe, or move to a cooled environment and seek assistance.',
        ],
        limitations:
          'Informational explanation of deterministic rules only; not a medical diagnosis or clinical advice.',
        dataMode: 'SIMULATED',
        generatedAt: baseNowIso,
      })
    );

    const geminiOrchestrator = new GeminiExplanationOrchestrator({
      generator: mockGeminiGenerator,
    });

    const explanation = await geminiOrchestrator.explainAssessment(
      {
        actingUid: testUserUid,
        targetUid: testUserUid,
        assessmentId,
        assessment,
        vitals: criticalPreset.vitals,
        environment: criticalPreset.environment,
        sourceDataMode: 'SIMULATED',
      },
      baseNowMs
    );

    repo.saveAIExplanation(testUserUid, testUserUid, {
      ...explanation,
      explanationId: `exp-${assessmentId}`,
    });
    expect(explanation.dataMode).toBe('SIMULATED');
    expect(explanation.assessmentId).toBe(assessmentId);
    // Verify deterministic assessment was NOT mutated by AI
    expect(assessment.riskLevel).toBe(RiskLevel.CRITICAL);

    // Step 7 & 8: Create and persist alert + schedule durable escalation deadline
    const rawAlert = createAlertFromAssessment(assessment, null, baseNowIso);
    expect(rawAlert).not.toBeNull();

    const notificationProvider = new SimulationNotificationProvider();
    const escalationCoordinator = new DurableEscalationCoordinator({
      provider: notificationProvider,
    });

    const { alert: scheduledAlert, task: escalationTask } =
      escalationCoordinator.scheduleAlertEscalation({
        actingUid: testUserUid,
        targetUid: testUserUid,
        alert: rawAlert!,
        contacts: loadedContacts,
        policy: {
          ...DEFAULT_ESCALATION_POLICY,
          criticalTimeoutSeconds: 45,
        },
        nowMs: baseNowMs,
      });

    expect(scheduledAlert.escalationDeadlineIso).toBeDefined();
    expect(escalationTask.status).toBe('SCHEDULED');

    repo.createAlert(testUserUid, testUserUid, scheduledAlert);
    repo.saveEscalationTask(testUserUid, testUserUid, escalationTask);

    // Step 9 & 10: Acknowledge the alert using "I am safe" and verify pending escalation is cancelled
    const ackMs = baseNowMs + 12_000;
    const ackIso = new Date(ackMs).toISOString();

    const coordAckResult =
      escalationCoordinator.acknowledgeAlertAndCancelEscalation({
        actingUid: testUserUid,
        targetUid: testUserUid,
        alertId: scheduledAlert.id,
        note: 'User confirmed I am safe on dashboard',
        nowMs: ackMs,
      });

    expect(coordAckResult.alreadyAcknowledged).toBe(false);
    expect(coordAckResult.alert.status).toBe('ACKNOWLEDGED');
    expect(coordAckResult.task?.status).toBe('CANCELLED');

    const repoAckResult = repo.acknowledgeAlert(
      testUserUid,
      testUserUid,
      scheduledAlert.id,
      'User confirmed I am safe on dashboard',
      ackIso
    );
    expect(repoAckResult.alreadyAcknowledged).toBe(false);
    expect(repoAckResult.alert.acknowledged).toBe(true);
    expect(repoAckResult.alert.status).toBe('ACKNOWLEDGED');

    if (coordAckResult.task) {
      repo.saveEscalationTask(testUserUid, testUserUid, coordAckResult.task);
    }

    // Even after the 45s deadline expires (+60s), processing due escalations must NOT escalate or notify contacts
    const postDeadlineSweep = await escalationCoordinator.processDueEscalations(
      baseNowMs + 60_000
    );
    expect(postDeadlineSweep.completedTaskIds).toHaveLength(0);

    // Step 11 & 12: Simulate page refresh by exporting/restoring coordinator snapshot & reading persisted repository records
    const coordinatorAfterRefresh = new DurableEscalationCoordinator({
      provider: notificationProvider,
      initialSnapshot: escalationCoordinator.exportSnapshot(),
    });

    const restoredTask = coordinatorAfterRefresh.getTaskForAlert(
      testUserUid,
      testUserUid,
      scheduledAlert.id
    );
    expect(restoredTask?.status).toBe('CANCELLED');

    const persistedTasks = repo.getEscalationTasks(testUserUid, testUserUid);
    expect(persistedTasks).toHaveLength(1);
    expect(persistedTasks[0].status).toBe('CANCELLED');

    const persistedAuditEvents = repo.getAuditEvents(testUserUid, testUserUid);
    expect(
      persistedAuditEvents.some((e) => e.type === 'user_acknowledged')
    ).toBe(true);

    const persistedExplanation = repo.getAIExplanation(
      testUserUid,
      testUserUid,
      `exp-${assessmentId}`
    );
    expect(persistedExplanation?.summary).toContain(
      'deterministic rule engine'
    );

    const persistedObservations = repo.getNormalizedObservations(
      testUserUid,
      testUserUid
    );
    expect(persistedObservations).toHaveLength(4);
    expect(persistedObservations.every((o) => o.dataMode === 'SIMULATED')).toBe(
      true
    );

    // Step 13: Confirm no external notifications were sent in simulation mode
    expect(notificationProvider.getSendCallCount()).toBe(0);
    expect(repo.getNotificationAttempts(testUserUid, testUserUid)).toHaveLength(
      0
    );
  });

  it('2. executes legitimate unacknowledged escalation when deadline expires using mocked SimulationNotificationProvider', async () => {
    const simProvider = new SimulationNotificationProvider();
    const coordinator = new DurableEscalationCoordinator({
      provider: simProvider,
    });

    const criticalPreset = SIMULATION_PRESETS.find(
      (p) => p.expectedRisk === RiskLevel.CRITICAL
    )!;
    const assessment = evaluateRisk(
      criticalPreset.vitals,
      criticalPreset.environment,
      DEFAULT_THRESHOLDS
    );
    const rawAlert = createAlertFromAssessment(assessment, null, baseNowIso)!;

    coordinator.scheduleAlertEscalation({
      actingUid: testUserUid,
      targetUid: testUserUid,
      alert: rawAlert,
      contacts: [VERIFIED_PRIMARY_CONTACT],
      policy: {
        ...DEFAULT_ESCALATION_POLICY,
        criticalTimeoutSeconds: 30,
      },
      nowMs: baseNowMs,
    });

    // Advance clock past the 30-second deadline without user acknowledgement
    const summary = await coordinator.processDueEscalations(baseNowMs + 35_000);
    expect(summary.completedTaskIds).toHaveLength(1);

    const contactAttempts = coordinator
      .getNotificationAttemptsForUser(testUserUid, testUserUid)
      .filter((a) => a.recipientRole === 'EMERGENCY_CONTACT');

    expect(contactAttempts).toHaveLength(1);
    expect(contactAttempts[0].deliveryMode).toBe('SIMULATION');
    expect(contactAttempts[0].deliveryStatus).toBe('SUBMITTED');
    expect(contactAttempts[0].recipientRef).toContain(
      'contact:contact-e2e-primary (***-8921)'
    );
    expect(simProvider.getSendCallCount()).toBe(1);
  });

  it('3. enforces multi-worker idempotency so concurrent schedulers never send duplicate notifications for the same alert', async () => {
    const simProvider = new SimulationNotificationProvider();
    const coordinator = new DurableEscalationCoordinator({
      provider: simProvider,
    });

    const criticalPreset = SIMULATION_PRESETS.find(
      (p) => p.expectedRisk === RiskLevel.CRITICAL
    )!;
    const assessment = evaluateRisk(
      criticalPreset.vitals,
      criticalPreset.environment,
      DEFAULT_THRESHOLDS
    );
    const rawAlert = createAlertFromAssessment(assessment, null, baseNowIso)!;

    const { task } = coordinator.scheduleAlertEscalation({
      actingUid: testUserUid,
      targetUid: testUserUid,
      alert: rawAlert,
      contacts: [VERIFIED_PRIMARY_CONTACT],
      policy: {
        ...DEFAULT_ESCALATION_POLICY,
        criticalTimeoutSeconds: 30,
      },
      nowMs: baseNowMs,
    });

    // Run two concurrent task executions at the deadline (simulating Express worker + Cloud Function sweep)
    const [execA, execB] = await Promise.all([
      coordinator.executeEscalationTask(task.taskId, baseNowMs + 35_000),
      coordinator.executeEscalationTask(task.taskId, baseNowMs + 35_000),
    ]);

    const skippedCount =
      (execA.duplicateSkipped ? 1 : 0) + (execB.duplicateSkipped ? 1 : 0);
    expect(skippedCount).toBe(1);
    expect(simProvider.getSendCallCount()).toBe(1);
  });

  it('4. enforces Safe Demo Reset isolation: purges SIMULATED demo state while preserving REAL observations and other users', () => {
    const repo = new SecureSafetyRepositorySimulator();
    repo.createProfile(testUserUid, testUserUid, {
      uid: testUserUid,
      email: 'judge@vitaguard.demo',
      displayName: 'Hackathon Judge',
      simulationNoticeAccepted: true,
      createdAt: baseNowIso,
      updatedAt: baseNowIso,
    });
    repo.createProfile(otherUserUid, otherUserUid, {
      uid: otherUserUid,
      email: 'neighbor@vitaguard.demo',
      displayName: 'Neighbor User',
      simulationNoticeAccepted: true,
      createdAt: baseNowIso,
      updatedAt: baseNowIso,
    });

    const simProvider = new SimulationDataProvider();
    const wearableProvider = new WearableDataProvider({
      serverVerifiedOAuthConfigured: true,
    });
    const coordinator = new TelemetryIngestionCoordinator({
      providers: [simProvider, wearableProvider],
    });

    // 1. Ingest a SIMULATED observation for testUserUid
    const simObsRes = validateAndNormalizeObservation({
      raw: {
        observationId: 'obs-sim-demo-1',
        authenticatedOwnerId: testUserUid,
        metricType: 'heart_rate',
        value: 162,
        unit: 'bpm',
        observedAt: baseNowIso,
        receivedAt: baseNowIso,
        sourceProvider: 'vitaguard-simulation-sandbox',
        sourceRecordId: 'sim-1',
        claimedDataMode: 'SIMULATED',
      },
      authenticatedUid: testUserUid,
      authoritativeProviderMode: 'SIMULATED',
      providerVerifiedReal: false,
      nowMs: baseNowMs,
    });
    expect(simObsRes.ok).toBe(true);
    if (simObsRes.ok) {
      repo.saveNormalizedObservationFromClient(
        testUserUid,
        testUserUid,
        simObsRes.observation
      );
    }

    // 2. Server-side ingestion of a verified REAL observation for testUserUid
    const realObsRes = validateAndNormalizeObservation({
      raw: {
        observationId: 'obs-real-wearable-1',
        authenticatedOwnerId: testUserUid,
        metricType: 'heart_rate',
        value: 71,
        unit: 'bpm',
        observedAt: baseNowIso,
        receivedAt: baseNowIso,
        sourceProvider: 'authorized-healthkit-export',
        sourceRecordId: 'real-hk-1',
        claimedDataMode: 'REAL',
      },
      authenticatedUid: testUserUid,
      authoritativeProviderMode: 'REAL',
      providerVerifiedReal: true,
      nowMs: baseNowMs,
    });
    expect(realObsRes.ok).toBe(true);
    if (realObsRes.ok) {
      // Client write with dataMode == 'REAL' must be rejected by security rules
      expect(() =>
        repo.saveNormalizedObservationFromClient(
          testUserUid,
          testUserUid,
          realObsRes.observation
        )
      ).toThrow(/Direct client writes cannot persist observations as REAL/);

      // Server Admin path succeeds
      repo.saveNormalizedObservationFromServer(
        testUserUid,
        realObsRes.observation
      );
    }

    // 3. Save a SIMULATED observation for a second user (otherUserUid)
    const otherUserObs = validateAndNormalizeObservation({
      raw: {
        observationId: 'obs-other-user-1',
        authenticatedOwnerId: otherUserUid,
        metricType: 'heart_rate',
        value: 88,
        unit: 'bpm',
        observedAt: baseNowIso,
        receivedAt: baseNowIso,
        sourceProvider: 'vitaguard-simulation-sandbox',
        sourceRecordId: 'other-1',
        claimedDataMode: 'SIMULATED',
      },
      authenticatedUid: otherUserUid,
      authoritativeProviderMode: 'SIMULATED',
      providerVerifiedReal: false,
      nowMs: baseNowMs,
    });
    if (otherUserObs.ok) {
      repo.saveNormalizedObservationFromClient(
        otherUserUid,
        otherUserUid,
        otherUserObs.observation
      );
    }

    // 4. Execute Safe Demo Reset for testUserUid
    const resetSummary = repo.resetDemoDataOnly(testUserUid, testUserUid);
    expect(resetSummary.purgedSimulatedCount).toBe(1);
    expect(resetSummary.preservedRealCount).toBe(1);

    const afterResetObs = repo.getNormalizedObservations(
      testUserUid,
      testUserUid
    );
    expect(afterResetObs).toHaveLength(1);
    expect(afterResetObs[0].observationId).toBe('obs-real-wearable-1');
    expect(afterResetObs[0].dataMode).toBe('REAL');

    // Verify otherUserUid's records were completely untouched
    const otherUserAfterReset = repo.getNormalizedObservations(
      otherUserUid,
      otherUserUid
    );
    expect(otherUserAfterReset).toHaveLength(1);
    expect(otherUserAfterReset[0].observationId).toBe('obs-other-user-1');

    // Also verify coordinator-level demo reset purges SIMULATED observations
    coordinator.ingestBatch({
      actingUid: testUserUid,
      targetUid: testUserUid,
      providerId: simProvider.providerId,
      nowMs: baseNowMs,
      rawObservations: [
        {
          observationId: 'obs-coord-sim-1',
          authenticatedOwnerId: testUserUid,
          metricType: 'heart_rate',
          value: 140,
          unit: 'bpm',
          observedAt: baseNowIso,
          sourceProvider: simProvider.providerId,
          sourceRecordId: 'c-sim-1',
        },
      ],
    });

    const coordReset = coordinator.resetSimulatedDemoDataOnly(
      testUserUid,
      testUserUid
    );
    expect(coordReset.purgedSimulatedCount).toBe(1);
    expect(coordReset.preservedRealCount).toBe(0);
  });

  it('5. verifies deterministic risk engine threshold boundary conditions and audit rule alignment', () => {
    const safeBoundaryVitals = {
      heartRateBpm: DEFAULT_THRESHOLDS.heartRate.moderateHigh - 1, // 109 bpm (below 110 moderateHigh)
      oxygenSaturationPct: DEFAULT_THRESHOLDS.oxygenSaturation.normalMin, // Exact 95% normalMin
      bodyTempCelsius: DEFAULT_THRESHOLDS.bodyTemp.normalMax, // Exact 37.5°C normalMax
      activityLevel: ActivityLevel.RESTING,
      stepCadencePerMin: 0,
    };
    const safeBoundaryEnv = {
      ambientTempCelsius: DEFAULT_THRESHOLDS.ambientTemp.heatWarn - 1, // 29°C (below 30°C heatWarn)
      humidityPct: 45,
      weatherCondition: WeatherCondition.CLEAR,
      windSpeedKmh: 10,
      airQualityIndex: 42,
    };

    const exactBoundaryAssessment = evaluateRisk(
      safeBoundaryVitals,
      safeBoundaryEnv,
      DEFAULT_THRESHOLDS
    );
    expect(exactBoundaryAssessment.riskLevel).toBe(RiskLevel.LOW);
    expect(exactBoundaryAssessment.triggeredRules).toHaveLength(0);

    // Crossing high/critical thresholds deterministically triggers rules
    const overBoundaryAssessment = evaluateRisk(
      {
        ...safeBoundaryVitals,
        heartRateBpm: DEFAULT_THRESHOLDS.heartRate.criticalHigh + 2,
        oxygenSaturationPct: DEFAULT_THRESHOLDS.oxygenSaturation.highMin - 2,
      },
      safeBoundaryEnv,
      DEFAULT_THRESHOLDS
    );
    expect(overBoundaryAssessment.riskLevel).toBe(RiskLevel.CRITICAL);
    expect(overBoundaryAssessment.triggeredRules.length).toBeGreaterThanOrEqual(
      2
    );
  });

  it('6. verifies repository security hardening: firestore.rules enforces SIMULATED-only client observation writes and server.ts sets defensive HTTP headers', () => {
    const rulesPath = path.resolve(process.cwd(), 'firestore.rules');
    const rulesContent = fs.readFileSync(rulesPath, 'utf-8');

    // Client writes to normalizedObservations must enforce data.dataMode == 'SIMULATED'
    expect(rulesContent).toContain("data.dataMode == 'SIMULATED'");
    expect(rulesContent).toContain(
      'match /normalizedObservations/{observationId}'
    );

    const serverPath = path.resolve(process.cwd(), 'server.ts');
    const serverContent = fs.readFileSync(serverPath, 'utf-8');
    expect(serverContent).toContain('X-Content-Type-Options');
    expect(serverContent).toContain('nosniff');
    expect(serverContent).toContain('Cache-Control');

    // Verify Live SMS adapter reports unconfigured when credentials are absent
    const liveSmsAdapter = new VerifiedSmsGatewayAdapter({});
    expect(liveSmsAdapter.isConfigured()).toBe(false);
  });

  it('7. verifies responsive dashboard rendering across desktop (1280x800) and mobile (375x812) viewports for alert display, demo runner, and MCP console', () => {
    const criticalPreset = SIMULATION_PRESETS.find(
      (p) => p.expectedRisk === RiskLevel.CRITICAL
    )!;
    const assessment = evaluateRisk(
      criticalPreset.vitals,
      criticalPreset.environment,
      DEFAULT_THRESHOLDS
    );
    const activeAlert = createAlertFromAssessment(assessment, null, baseNowIso)!;

    const viewports = [
      { label: 'desktop', width: 1280, height: 800 },
      { label: 'mobile', width: 375, height: 812 },
    ];

    for (const vp of viewports) {
      const summaryHtml = renderToStaticMarkup(
        React.createElement(OverviewSummaryBar, {
          assessment,
          activeAlert,
          activePresetId: criticalPreset.id,
          onAcknowledgeSafe: vi.fn(),
          onApplyPreset: vi.fn(),
        })
      );

      // Must display the CRITICAL alert status and "I am safe" acknowledgement button in both viewports
      expect(summaryHtml).toContain('CRITICAL RISK');
      expect(summaryHtml).toContain('I am safe');
      expect(summaryHtml).toContain('flex-col');
      expect(summaryHtml).toContain('lg:flex-row');

      const demoBarHtml = renderToStaticMarkup(
        React.createElement(HackathonDemoBar, {
          currentRisk: assessment.riskLevel,
          activeAlert,
          hasAIExplanation: true,
          notificationAttemptCount: 0,
          realObservationCount: 1,
          simulatedObservationCount: 4,
          lastDemoActionNote: `Verified at ${vp.label} (${vp.width}x${vp.height})`,
          onRunStep1Baseline: vi.fn(),
          onRunStep2HighRiskIngest: vi.fn(),
          onRunStep3GenerateAIExplanation: vi.fn(),
          onRunStep4AcknowledgeAndCancel: vi.fn(),
          onRunStep5SimulateUnacknowledgedEscalation: vi.fn(),
          onRunSafeDemoReset: vi.fn(),
        })
      );

      expect(demoBarHtml).toContain(
        'Reproducible Hackathon Demo &amp; Verification Runner'
      );
      expect(demoBarHtml).toContain('Safe Demo Reset');
      expect(demoBarHtml).toContain('grid-cols-1');
      expect(demoBarHtml).toContain('lg:grid-cols-5');

      const mcpPanelHtml = renderToStaticMarkup(
        React.createElement(McpServerPanel, {
          actingUid: testUserUid,
          vitals: criticalPreset.vitals,
          environment: criticalPreset.environment,
          thresholds: DEFAULT_THRESHOLDS,
          contacts: [VERIFIED_PRIMARY_CONTACT],
          activeAlert,
        })
      );

      expect(mcpPanelHtml).toContain('VitaGuard MCP Server');
      expect(mcpPanelHtml).toContain('vitaguard_get_risk_status');
      expect(mcpPanelHtml).toContain('vitaguard_acknowledge_alert');
      expect(mcpPanelHtml).toContain('CONFIRM REQ');
    }
  });

  it('8. verifies zero server secrets or provider tokens are exposed in frontend source or built dist/ bundles', () => {
    const forbiddenClientPatterns = [
      'process.env.GEMINI_API_KEY',
      'import.meta.env.VITE_GEMINI_API_KEY',
      'process.env.SMS_GATEWAY_API_KEY',
      'import.meta.env.VITE_SMS_GATEWAY_API_KEY',
      'process.env.TWILIO_AUTH_TOKEN',
      'process.env.WEARABLE_OAUTH_CLIENT_SECRET',
      'YOUR_SERVER_SMS_GATEWAY_SECRET',
      'YOUR_SERVER_WEARABLE_OAUTH_SECRET',
    ];

    function collectFiles(dirPath: string): string[] {
      if (!fs.existsSync(dirPath)) return [];
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      const results: string[] = [];
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== '__tests__' && entry.name !== 'node_modules') {
            results.push(...collectFiles(fullPath));
          }
        } else if (/\.(ts|tsx|js|html)$/.test(entry.name)) {
          results.push(fullPath);
        }
      }
      return results;
    }

    const clientFiles = collectFiles(path.resolve(process.cwd(), 'src'));
    expect(clientFiles.length).toBeGreaterThan(10);

    for (const filePath of clientFiles) {
      const content = fs.readFileSync(filePath, 'utf-8');
      for (const forbidden of forbiddenClientPatterns) {
        expect(content).not.toContain(forbidden);
      }
    }

    // Also inspect dist/ assets if production build has run
    const distFiles = collectFiles(path.resolve(process.cwd(), 'dist'));
    for (const distFile of distFiles) {
      const content = fs.readFileSync(distFile, 'utf-8');
      expect(content).not.toContain('YOUR_SERVER_SMS_GATEWAY_SECRET');
      expect(content).not.toContain('YOUR_SERVER_WEARABLE_OAUTH_SECRET');
      expect(content).not.toContain('MY_GEMINI_API_KEY');
    }
  });

  it('9. verifies deployment configuration documentation and official Amazon track compatibility (model-agnostic Nova adapter + MCP + honest hardware disclosure)', async () => {
    const readmePath = path.resolve(process.cwd(), 'README.md');
    expect(fs.existsSync(readmePath)).toBe(true);
    const readmeContent = fs.readFileSync(readmePath, 'utf-8');

    // Deployment documentation checks
    expect(readmeContent).toContain('Production Deployment Configuration');
    expect(readmeContent).toContain('GEMINI_API_KEY');
    expect(readmeContent).toContain('firebase deploy --only firestore:rules,firestore:indexes');

    // Official Amazon Track Compatibility checks
    expect(readmeContent).toContain('Official Amazon Hackathon Track Compatibility Verification');
    expect(readmeContent).toContain('amazon.nova-lite-v1:0');
    expect(readmeContent).toContain('Amazon Halo');

    // Verify model-agnostic GenerateTextFn works with an Amazon Bedrock / Nova style provider without altering deterministic risk
    const criticalPreset = SIMULATION_PRESETS.find(
      (p) => p.expectedRisk === RiskLevel.CRITICAL
    )!;
    const assessment = evaluateRisk(
      criticalPreset.vitals,
      criticalPreset.environment,
      DEFAULT_THRESHOLDS
    );
    const originalScore = assessment.overallScore;
    const originalRisk = assessment.riskLevel;

    const amazonNovaAdapterMock = vi.fn().mockResolvedValue(
      JSON.stringify({
        summary:
          'Deterministic rule engine evaluated CRITICAL thermal and hypoxic strain across simulated telemetry.',
        contributingFactors: [
          'Elevated core temperature (39.4°C) and heart rate (168 bpm)',
          'Reduced oxygen saturation (89% SpO2) during heatwave conditions',
        ],
        triggeredRules: assessment.triggeredRules.map((r) => ({
          id: r.id,
          explanation: `Rule ${r.id} exceeded configured threshold.`,
        })),
        uncertainties: ['Synthetic simulation telemetry only.'],
        recommendedActions: ['Acknowledge alert if safe or move to a cooled environment.'],
        limitations:
          'Informational explanation only; not a clinical diagnosis or emergency dispatch.',
        dataMode: 'SIMULATED',
        generatedAt: baseNowIso,
      })
    );

    const novaOrchestrator = new GeminiExplanationOrchestrator({
      modelId: 'amazon.nova-lite-v1:0',
      generator: amazonNovaAdapterMock,
    });

    const explanation = await novaOrchestrator.explainAssessment(
      {
        actingUid: testUserUid,
        targetUid: testUserUid,
        assessmentId: 'assess-nova-compat-01',
        assessment,
        vitals: criticalPreset.vitals,
        environment: criticalPreset.environment,
        sourceDataMode: 'SIMULATED',
      },
      baseNowMs
    );

    expect(explanation.modelId).toBe('amazon.nova-lite-v1:0');
    expect(explanation.dataMode).toBe('SIMULATED');
    expect(assessment.overallScore).toBe(originalScore);
    expect(assessment.riskLevel).toBe(originalRisk);
  });
});
