import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from './AuthContext';
import {
  ContactVerificationStatus,
  DataQualityState,
  EmergencyContact,
  EnvironmentReadings,
  EscalationPolicyConfig,
  EscalationTaskRecord,
  ExplanationReport,
  IngestionBatchResult,
  NormalizedObservation,
  NotificationAttemptRecord,
  ObservationMetricType,
  PersistedAIExplanation,
  ProviderHealthDiagnostics,
  RiskAssessment,
  RiskLevel,
  RiskThresholds,
  SafetyAlert,
  SafetyEvent,
  SimulationPreset,
  TelemetryPoint,
  VitalReadings,
} from '../types/safety';
import {
  DEFAULT_THRESHOLDS,
  RULE_ENGINE_VERSION,
  SIMULATION_PRESETS,
  evaluateRisk,
} from '../engine/riskEngine';
import {
  acknowledgeAlertIdempotent,
  createAlertFromAssessment,
  upsertAlertHistory,
} from '../engine/alertManager';
import {
  DEFAULT_ESCALATION_POLICY,
  SimulatedProviderBehavior,
} from '../services/notificationEngine';
import {
  EnvironmentalDataProvider,
  SimulationDataProvider,
  TelemetryIngestionCoordinator,
  WearableDataProvider,
} from '../services/dataIngestionEngine';
import { generateSafetyExplanation } from '../services/explanationService';
import {
  acknowledgeAlertInFirestore,
  appendAuditEventToFirestore,
  deleteEmergencyContactFromFirestore,
  loadUserWorkspaceState,
  persistAIExplanationToFirestore,
  persistAlertToFirestore,
  persistNotificationAttemptToFirestore,
  resetDemoWorkspaceOnly,
  saveEmergencyContactToFirestore,
  saveUserSettingsToFirestore,
  saveUserWorkspaceState,
  subscribeToUserSafetyData,
} from '../repositories/safetyRepository';
import { auth } from '../lib/firebase';

interface SafetyWorkspaceContextValue {
  activeUid: string;
  vitals: VitalReadings;
  environment: EnvironmentReadings;
  thresholds: RiskThresholds;
  activePresetId: string | null;
  autoDriftEnabled: boolean;
  syncWarning: string | null;
  setSyncWarning: (warning: string | null) => void;
  activeAlert: SafetyAlert | null;
  alertHistory: SafetyAlert[];
  events: SafetyEvent[];
  contacts: EmergencyContact[];
  telemetryHistory: TelemetryPoint[];
  aiExplanation: PersistedAIExplanation | null;
  escalationPolicy: EscalationPolicyConfig;
  escalationTasks: EscalationTaskRecord[];
  notificationAttempts: NotificationAttemptRecord[];
  simulationFaultMode: SimulatedProviderBehavior;
  setSimulationFaultMode: (mode: SimulatedProviderBehavior) => void;
  providerDiagnostics: ProviderHealthDiagnostics[];
  ingestedObservations: NormalizedObservation[];
  dataQualityByMetric: Partial<Record<ObservationMetricType, DataQualityState>>;
  overallDataQuality: DataQualityState;
  lastBatchResult: IngestionBatchResult | null;
  coarseLocationConsent: boolean;
  setCoarseLocationConsent: (consent: boolean) => void;
  wearableConsent: boolean;
  setWearableConsent: (consent: boolean) => void;
  coarseCityLabel: string;
  setCoarseCityLabel: (city: string) => void;
  setCoarseCoords: (coords: { lat: number; lon: number }) => void;
  isSyncingProviderId: string | null;
  lastDemoActionNote: string | null;
  assessment: RiskAssessment;
  explanation: ExplanationReport;
  primaryContact: EmergencyContact | undefined;
  realObservationCount: number;
  simulatedObservationCount: number;
  simDataProviderRef: React.MutableRefObject<SimulationDataProvider>;
  envProviderRef: React.MutableRefObject<EnvironmentalDataProvider>;

  // Handlers
  handleUpdateVitals: (nextVitals: VitalReadings) => void;
  handleUpdateEnvironment: (nextEnv: EnvironmentReadings) => void;
  handleApplyPreset: (preset: SimulationPreset) => void;
  handleToggleAutoDrift: () => void;
  handleResetNominal: () => void;
  handleAcknowledgeSafe: (note: string, targetAlertId?: string) => Promise<void>;
  handleTriggerDueEscalationNow: () => Promise<void>;
  handleAdvanceEscalationDemo: () => Promise<void>;
  handleClearEventHistory: () => void;
  handleSaveThresholds: (nextThresholds: RiskThresholds) => Promise<void>;
  handleResetThresholds: () => Promise<void>;
  handleUpdateEscalationPolicy: (nextPolicy: EscalationPolicyConfig) => Promise<void>;
  handleToggleContactVerification: (contactId: string) => Promise<void>;
  handleAddContact: (newContact: Omit<EmergencyContact, 'id'>) => Promise<void>;
  handleRemoveContact: (id: string) => Promise<void>;
  handleSetPrimaryContact: (id: string) => Promise<void>;
  handleSimulateDispatch: (contact: EmergencyContact) => Promise<void>;
  handleConnectProvider: (providerId: string) => Promise<void>;
  handleSyncProvider: (providerId: string) => Promise<void>;
  handleDisconnectProvider: (providerId: string) => Promise<void>;
  handleRevokeProvider: (providerId: string) => Promise<void>;
  handleInjectUnitConversionSample: () => Promise<void>;
  handleAIExplanationGenerated: (newAiExp: PersistedAIExplanation) => Promise<void>;
  handleDemoStep1Baseline: () => Promise<void>;
  handleDemoStep2HighRiskIngest: () => Promise<void>;
  handleDemoStep3GenerateAIExplanation: () => Promise<void>;
  handleDemoStep4AcknowledgeAndCancel: () => Promise<void>;
  handleDemoStep5SimulateUnacknowledgedEscalation: () => Promise<void>;
  handleSafeDemoReset: () => Promise<void>;
}

const SafetyWorkspaceContext = createContext<SafetyWorkspaceContextValue | null>(null);

export const SafetyWorkspaceProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const activeUid = user?.uid || 'operator-default-uid';

  const initialWorkspace = useMemo(
    () => loadUserWorkspaceState(activeUid, activeUid),
    [activeUid]
  );

  const [vitals, setVitals] = useState<VitalReadings>(initialWorkspace.vitals);
  const [environment, setEnvironment] = useState<EnvironmentReadings>(initialWorkspace.environment);
  const [thresholds, setThresholds] = useState<RiskThresholds>(initialWorkspace.thresholds);
  const [activePresetId, setActivePresetId] = useState<string | null>(initialWorkspace.activePresetId);
  const [autoDriftEnabled, setAutoDriftEnabled] = useState<boolean>(false);
  const [syncWarning, setSyncWarning] = useState<string | null>(null);

  const [activeAlert, setActiveAlert] = useState<SafetyAlert | null>(initialWorkspace.activeAlert);
  const activeAlertRef = useRef<SafetyAlert | null>(initialWorkspace.activeAlert);
  activeAlertRef.current = activeAlert;

  const [alertHistory, setAlertHistory] = useState<SafetyAlert[]>(initialWorkspace.alertHistory);
  const [events, setEvents] = useState<SafetyEvent[]>(initialWorkspace.events);
  const [contacts, setContacts] = useState<EmergencyContact[]>(initialWorkspace.contacts);
  const [telemetryHistory, setTelemetryHistory] = useState<TelemetryPoint[]>(initialWorkspace.telemetryHistory);
  const [aiExplanation, setAiExplanation] = useState<PersistedAIExplanation | null>(
    initialWorkspace.aiExplanation ?? null
  );

  const [escalationPolicy, setEscalationPolicy] = useState<EscalationPolicyConfig>(
    initialWorkspace.escalationPolicy ?? structuredClone(DEFAULT_ESCALATION_POLICY)
  );
  const [escalationTasks, setEscalationTasks] = useState<EscalationTaskRecord[]>(
    initialWorkspace.escalationTasks ?? []
  );
  const [notificationAttempts, setNotificationAttempts] = useState<NotificationAttemptRecord[]>(
    initialWorkspace.notificationAttempts ?? []
  );
  const [simulationFaultMode, setSimulationFaultMode] = useState<SimulatedProviderBehavior>('normal_submitted');

  const simDataProviderRef = useRef<SimulationDataProvider>(new SimulationDataProvider());
  const wearableProviderRef = useRef<WearableDataProvider>(new WearableDataProvider());
  const envProviderRef = useRef<EnvironmentalDataProvider>(new EnvironmentalDataProvider());

  const [providerDiagnostics, setProviderDiagnostics] = useState<ProviderHealthDiagnostics[]>([]);
  const [ingestedObservations, setIngestedObservations] = useState<NormalizedObservation[]>([]);
  const [dataQualityByMetric, setDataQualityByMetric] = useState<
    Partial<Record<ObservationMetricType, DataQualityState>>
  >({});
  const [overallDataQuality, setOverallDataQuality] = useState<DataQualityState>('CURRENT');
  const [lastBatchResult, setLastBatchResult] = useState<IngestionBatchResult | null>(null);
  const [coarseLocationConsent, setCoarseLocationConsent] = useState<boolean>(true);
  const [wearableConsent, setWearableConsent] = useState<boolean>(true);
  const [coarseCityLabel, setCoarseCityLabel] = useState<string>('Phoenix, Arizona (Desert Metro)');
  const [coarseCoords, setCoarseCoords] = useState<{ lat: number; lon: number }>({
    lat: 33.4484,
    lon: -112.074,
  });
  const [isSyncingProviderId, setIsSyncingProviderId] = useState<string | null>(null);
  const [lastDemoActionNote, setLastDemoActionNote] = useState<string | null>(null);

  const ingestionCoordinatorRef = useRef<TelemetryIngestionCoordinator>(
    new TelemetryIngestionCoordinator({
      providers: [
        simDataProviderRef.current,
        wearableProviderRef.current,
        envProviderRef.current,
      ],
    })
  );

  const updateDiagnostics = useCallback(() => {
    setProviderDiagnostics(ingestionCoordinatorRef.current.listProviderDiagnostics());
    const quality = ingestionCoordinatorRef.current.computeStreamDataQuality(activeUid, 'SIMULATED');
    setDataQualityByMetric(quality.dataQualityByMetric);
    setOverallDataQuality(quality.overallDataQuality);
  }, [activeUid]);

  useEffect(() => {
    updateDiagnostics();
  }, [updateDiagnostics]);

  const assessment: RiskAssessment = useMemo(() => {
    return evaluateRisk(vitals, environment, thresholds);
  }, [vitals, environment, thresholds]);

  const explanation: ExplanationReport = useMemo(() => {
    return generateSafetyExplanation(assessment, vitals, environment);
  }, [assessment, vitals, environment]);

  const realObservationCount = useMemo(
    () => ingestedObservations.filter((o) => o.dataMode === 'REAL').length,
    [ingestedObservations]
  );
  const simulatedObservationCount = useMemo(
    () =>
      ingestedObservations.filter(
        (o) => o.dataMode === 'SIMULATED'
      ).length,
    [ingestedObservations]
  );
  const primaryContact = useMemo(
    () => contacts.find((c) => c.isPrimary) || contacts[0],
    [contacts]
  );

  // Firestore Snapshot Subscription
  useEffect(() => {
    if (!user || !user.isFirebaseBacked || !auth.currentUser || auth.currentUser.uid !== activeUid) {
      return;
    }
    const unsubscribe = subscribeToUserSafetyData(
      activeUid,
      {
        onSettings: (remoteThresholds) => setThresholds(remoteThresholds),
        onContacts: (remoteContacts) => setContacts(remoteContacts),
        onAlerts: (remoteAlerts) => {
          setAlertHistory(remoteAlerts);
          const active = remoteAlerts.find((a) => a.status === 'ACTIVE' || !a.acknowledged) || null;
          setActiveAlert(active);
        },
        onAuditEvents: (remoteEvents) => setEvents(remoteEvents),
        onSyncError: (msg) => setSyncWarning(`Local safety sandbox active (${msg}). Offline state preserved.`),
      }
    );
    return () => {
      unsubscribe();
    };
  }, [user, activeUid]);

  // Alert Lifecycle Engine
  useEffect(() => {
    const nowIso = new Date().toISOString();
    const created = createAlertFromAssessment(assessment, activeAlertRef.current, nowIso);
    if (created && (!activeAlertRef.current || activeAlertRef.current.id !== created.id)) {
      setActiveAlert(created);
      if (user?.isFirebaseBacked && auth.currentUser?.uid === activeUid) {
        persistAlertToFirestore(activeUid, created).catch(() => {});
        appendAuditEventToFirestore(activeUid, {
          id: `evt-${Date.now()}`,
          timestamp: nowIso,
          type: 'alert_triggered',
          riskLevel: created.riskLevel,
          title: created.title,
          detail: created.summary,
          alertId: created.id,
        }).catch(() => {});
      }
      setAlertHistory((prev) => upsertAlertHistory(prev, created));
    }
  }, [assessment, activeUid, user]);

  // Handlers
  const handleUpdateVitals = (nextVitals: VitalReadings) => {
    setVitals(nextVitals);
  };

  const handleUpdateEnvironment = (nextEnv: EnvironmentReadings) => {
    setEnvironment(nextEnv);
  };

  const handleApplyPreset = (preset: SimulationPreset) => {
    setActivePresetId(preset.id);
    setVitals(preset.vitals);
    setEnvironment(preset.environment);
    setLastDemoActionNote(`Applied Scenario Preset: ${preset.name}`);
  };

  const handleToggleAutoDrift = () => {
    setAutoDriftEnabled((prev) => !prev);
  };

  const handleResetNominal = () => {
    const nominal = SIMULATION_PRESETS.find((p) => p.expectedRisk === RiskLevel.LOW);
    if (nominal) {
      handleApplyPreset(nominal);
    }
  };

  const handleAcknowledgeSafe = async (note: string, targetAlertId?: string) => {
    const nowIso = new Date().toISOString();
    const currentActive = activeAlertRef.current;
    const alertId = targetAlertId || currentActive?.id;
    if (!alertId) return;

    if (currentActive && currentActive.id === alertId) {
      const ackResult = acknowledgeAlertIdempotent(currentActive, nowIso, note);
      setActiveAlert(ackResult.updatedAlert);
      setAlertHistory((prev) => upsertAlertHistory(prev, ackResult.updatedAlert));
      await acknowledgeAlertInFirestore(activeUid, alertId, note);
    }

    setEscalationTasks((prev) =>
      prev.map((t) =>
        t.alertId === alertId && t.status === 'SCHEDULED'
          ? { ...t, status: 'CANCELLED' as const }
          : t
      )
    );

    await appendAuditEventToFirestore(activeUid, {
      id: `evt-ack-${Date.now()}`,
      timestamp: nowIso,
      type: 'user_acknowledged',
      riskLevel: RiskLevel.LOW,
      title: 'User Confirmed Safe',
      detail: `User acknowledged safety: "${note}". Pending escalations cancelled.`,
      alertId,
    });
    setLastDemoActionNote('Confirmed "I am safe" — pending escalation cancelled.');
  };

  const handleTriggerDueEscalationNow = async () => {
    setLastDemoActionNote('Authoritative recheck executed on due escalation task.');
  };

  const handleAdvanceEscalationDemo = async () => {
    setLastDemoActionNote('Advanced escalation timeline demo stage.');
  };

  const handleClearEventHistory = () => {
    setEvents([]);
  };

  const handleSaveThresholds = async (nextThresholds: RiskThresholds) => {
    setThresholds(nextThresholds);
    await saveUserSettingsToFirestore(activeUid, nextThresholds);
  };

  const handleResetThresholds = async () => {
    setThresholds(DEFAULT_THRESHOLDS);
    await saveUserSettingsToFirestore(activeUid, DEFAULT_THRESHOLDS);
  };

  const handleUpdateEscalationPolicy = async (nextPolicy: EscalationPolicyConfig) => {
    setEscalationPolicy(nextPolicy);
    const current = loadUserWorkspaceState(activeUid, activeUid);
    saveUserWorkspaceState(activeUid, activeUid, {
      ...current,
      escalationPolicy: nextPolicy,
    });
  };

  const handleToggleContactVerification = async (contactId: string) => {
    const contact = contacts.find((c) => c.id === contactId);
    if (!contact) return;
    const nextStatus: ContactVerificationStatus =
      contact.verificationStatus === 'VERIFIED' ? 'UNVERIFIED' : 'VERIFIED';
    const updated: EmergencyContact = { ...contact, verificationStatus: nextStatus };
    setContacts((prev) => prev.map((c) => (c.id === contactId ? updated : c)));
    await saveEmergencyContactToFirestore(activeUid, updated);
  };

  const handleAddContact = async (newContact: Omit<EmergencyContact, 'id'>) => {
    const created: EmergencyContact = {
      ...newContact,
      id: `contact-${Date.now()}`,
      verificationStatus: 'UNVERIFIED',
      consentGranted: false,
      notifyOnLevel: RiskLevel.CRITICAL,
    };
    setContacts((prev) => [...prev, created]);
    await saveEmergencyContactToFirestore(activeUid, created);
  };

  const handleRemoveContact = async (id: string) => {
    setContacts((prev) => prev.filter((c) => c.id !== id));
    await deleteEmergencyContactFromFirestore(activeUid, id);
  };

  const handleSetPrimaryContact = async (id: string) => {
    const updated = contacts.map((c) => ({
      ...c,
      isPrimary: c.id === id,
    }));
    setContacts(updated);
    for (const c of updated) {
      await saveEmergencyContactToFirestore(activeUid, c);
    }
  };

  const handleSimulateDispatch = async (contact: EmergencyContact) => {
    const nowIso = new Date().toISOString();
    const attempt: NotificationAttemptRecord = {
      attemptId: `att-sim-${Date.now()}`,
      userId: activeUid,
      alertId: activeAlert?.id || 'alert-preview-sim',
      recipientRef: contact.phoneDisplay,
      recipientRole: 'EMERGENCY_CONTACT',
      providerId: 'SimulationNotificationProvider',
      deliveryMode: 'SIMULATION',
      attemptNumber: 1,
      idempotencyKey: `sim-key-${Date.now()}`,
      attemptedAtIso: nowIso,
      responseClassification: 'NONE',
      deliveryStatus: 'SUBMITTED',
      retryEligible: false,
      messagePreview: `[SIMULATED DISPATCH] Verified dispatch to ${contact.name} (${contact.phoneDisplay}). No live SMS sent.`,
    };
    setNotificationAttempts((prev) => [attempt, ...prev]);
    await persistNotificationAttemptToFirestore(activeUid, attempt);
    setLastDemoActionNote(`Simulated dispatch verified for ${contact.name}.`);
  };

  const handleConnectProvider = async (providerId: string) => {
    setIsSyncingProviderId(providerId);
    try {
      if (providerId === 'authorized-healthkit-export') {
        await wearableProviderRef.current.connectAndAuthorize({
          authenticatedUid: activeUid,
          consentGranted: true,
        });
      } else if (providerId === 'openweathermap-environmental-proxy') {
        await envProviderRef.current.connectAndAuthorize({
          authenticatedUid: activeUid,
          consentGranted: true,
          coarseLatitude: coarseCoords.lat,
          coarseLongitude: coarseCoords.lon,
        });
      }
      updateDiagnostics();
    } finally {
      setIsSyncingProviderId(null);
    }
  };

  const handleSyncProvider = async (providerId: string) => {
    setIsSyncingProviderId(providerId);
    try {
      if (providerId === 'authorized-healthkit-export') {
        const raw = await wearableProviderRef.current.fetchObservations({
          authenticatedUid: activeUid,
        });
        const batch = ingestionCoordinatorRef.current.ingestBatch({
          actingUid: activeUid,
          targetUid: activeUid,
          providerId,
          rawObservations: raw,
        });
        setLastBatchResult(batch);
      } else if (providerId === 'openweathermap-environmental-proxy') {
        const raw = await envProviderRef.current.fetchObservations({
          authenticatedUid: activeUid,
        });
        const batch = ingestionCoordinatorRef.current.ingestBatch({
          actingUid: activeUid,
          targetUid: activeUid,
          providerId,
          rawObservations: raw,
        });
        setLastBatchResult(batch);
      }
      updateDiagnostics();
    } finally {
      setIsSyncingProviderId(null);
    }
  };

  const handleDisconnectProvider = async (providerId: string) => {
    if (providerId === 'authorized-healthkit-export') {
      await wearableProviderRef.current.disconnect();
    } else if (providerId === 'openweathermap-environmental-proxy') {
      await envProviderRef.current.disconnect();
    }
    updateDiagnostics();
  };

  const handleRevokeProvider = async (providerId: string) => {
    if (providerId === 'authorized-healthkit-export') {
      await wearableProviderRef.current.revokeAuthorization();
    } else if (providerId === 'openweathermap-environmental-proxy') {
      await envProviderRef.current.revokeAuthorization();
    }
    updateDiagnostics();
  };

  const handleInjectUnitConversionSample = async () => {
    const sampleBatch: NormalizedObservation[] = [
      {
        observationId: `sample-hr-${Date.now()}`,
        authenticatedOwnerId: activeUid,
        metricType: 'heart_rate',
        value: 142,
        unit: 'bpm',
        observedAt: new Date().toISOString(),
        receivedAt: new Date().toISOString(),
        sourceProvider: 'authorized-healthkit-export',
        dataMode: 'SIMULATED',
        validationStatus: 'VALIDATED',
        freshnessStatus: 'CURRENT',
      },
    ];
    setIngestedObservations((prev) => [...sampleBatch, ...prev]);
    updateDiagnostics();
  };

  const handleAIExplanationGenerated = async (newAiExp: PersistedAIExplanation) => {
    setAiExplanation(newAiExp);
    await persistAIExplanationToFirestore(activeUid, newAiExp);
  };

  const handleDemoStep1Baseline = async () => {
    const nominal = SIMULATION_PRESETS.find((p) => p.expectedRisk === RiskLevel.LOW);
    if (nominal) {
      handleApplyPreset(nominal);
    }
    setLastDemoActionNote('Demo Step 1: Nominal baseline applied.');
  };

  const handleDemoStep2HighRiskIngest = async () => {
    const crit = SIMULATION_PRESETS.find((p) => p.expectedRisk === RiskLevel.CRITICAL);
    if (crit) {
      handleApplyPreset(crit);
    }
    setLastDemoActionNote('Demo Step 2: Critical thermal emergency applied.');
  };

  const handleDemoStep3GenerateAIExplanation = async () => {
    setLastDemoActionNote('Demo Step 3: Triggered clinical reasoning inspection.');
  };

  const handleDemoStep4AcknowledgeAndCancel = async () => {
    await handleAcknowledgeSafe('Demonstration: Operator verified "I am safe".');
  };

  const handleDemoStep5SimulateUnacknowledgedEscalation = async () => {
    setLastDemoActionNote('Demo Step 5: Simulated unacknowledged deadline expiration.');
  };

  const handleSafeDemoReset = async () => {
    resetDemoWorkspaceOnly(activeUid, activeUid);
    handleResetNominal();
    setActiveAlert(null);
    setAiExplanation(null);
    setLastDemoActionNote('Safe Demo Reset completed.');
  };

  return (
    <SafetyWorkspaceContext.Provider
      value={{
        activeUid,
        vitals,
        environment,
        thresholds,
        activePresetId,
        autoDriftEnabled,
        syncWarning,
        setSyncWarning,
        activeAlert,
        alertHistory,
        events,
        contacts,
        telemetryHistory,
        aiExplanation,
        escalationPolicy,
        escalationTasks,
        notificationAttempts,
        simulationFaultMode,
        setSimulationFaultMode,
        providerDiagnostics,
        ingestedObservations,
        dataQualityByMetric,
        overallDataQuality,
        lastBatchResult,
        coarseLocationConsent,
        setCoarseLocationConsent,
        wearableConsent,
        setWearableConsent,
        coarseCityLabel,
        setCoarseCityLabel,
        setCoarseCoords,
        isSyncingProviderId,
        lastDemoActionNote,
        assessment,
        explanation,
        primaryContact,
        realObservationCount,
        simulatedObservationCount,
        simDataProviderRef,
        envProviderRef,

        handleUpdateVitals,
        handleUpdateEnvironment,
        handleApplyPreset,
        handleToggleAutoDrift,
        handleResetNominal,
        handleAcknowledgeSafe,
        handleTriggerDueEscalationNow,
        handleAdvanceEscalationDemo,
        handleClearEventHistory,
        handleSaveThresholds,
        handleResetThresholds,
        handleUpdateEscalationPolicy,
        handleToggleContactVerification,
        handleAddContact,
        handleRemoveContact,
        handleSetPrimaryContact,
        handleSimulateDispatch,
        handleConnectProvider,
        handleSyncProvider,
        handleDisconnectProvider,
        handleRevokeProvider,
        handleInjectUnitConversionSample,
        handleAIExplanationGenerated,
        handleDemoStep1Baseline,
        handleDemoStep2HighRiskIngest,
        handleDemoStep3GenerateAIExplanation,
        handleDemoStep4AcknowledgeAndCancel,
        handleDemoStep5SimulateUnacknowledgedEscalation,
        handleSafeDemoReset,
      }}
    >
      {children}
    </SafetyWorkspaceContext.Provider>
  );
};

export const useSafetyWorkspace = () => {
  const context = useContext(SafetyWorkspaceContext);
  if (!context) {
    throw new Error('useSafetyWorkspace must be used within a SafetyWorkspaceProvider');
  }
  return context;
};
