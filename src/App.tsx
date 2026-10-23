/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AIExplanationPanel } from './components/AIExplanationPanel';
import { AlertPanel } from './components/AlertPanel';
import { DataSourcesPanel } from './components/DataSourcesPanel';
import { EmergencyContactsPanel } from './components/EmergencyContactsPanel';
import { EnvironmentCards } from './components/EnvironmentCards';
import { HackathonDemoBar } from './components/HackathonDemoBar';
import { McpServerPanel } from './components/McpServerPanel';
import { Navbar, NavTab } from './components/Navbar';
import { OverviewSummaryBar } from './components/OverviewSummaryBar';
import { RuleConfigPanel } from './components/RuleConfigPanel';
import { SimulationPanel } from './components/SimulationPanel';
import { VitalCards } from './components/VitalCards';
import { useAuth } from './context/AuthContext';
import {
  acknowledgeAlertIdempotent,
  canEscalateAlert,
  computeEscalationStage,
  createAlertFromAssessment,
  resolveAlert,
  upsertAlertHistory,
} from './engine/alertManager';
import {
  DEFAULT_THRESHOLDS,
  evaluateRisk,
  RULE_ENGINE_VERSION,
  SIMULATION_PRESETS,
} from './engine/riskEngine';
import {
  acknowledgeAlertInFirestore,
  appendAuditEventToFirestore,
  deleteEmergencyContactFromFirestore,
  escalateAlertInFirestoreSafely,
  loadUserWorkspaceState,
  persistAIExplanationToFirestore,
  persistAlertToFirestore,
  persistEscalationTaskToFirestore,
  persistNormalizedObservationToFirestore,
  persistNotificationAttemptToFirestore,
  recordSimulatedObservationAndAssessment,
  resetDemoWorkspaceOnly,
  resolveAlertInFirestore,
  saveEmergencyContactToFirestore,
  saveUserSettingsToFirestore,
  saveUserWorkspaceState,
  subscribeToUserSafetyData,
} from './repositories/safetyRepository';
import {
  EnvironmentalDataProvider,
  SimulationDataProvider,
  TelemetryIngestionCoordinator,
  WearableDataProvider,
  mapWmoCodeToWeatherCondition,
} from './services/dataIngestionEngine';
import { generateSafetyExplanation } from './services/explanationService';
import {
  AI_PROMPT_VERSION,
  AI_SCHEMA_VERSION,
  computeAssessmentFingerprint,
  detectDataUncertainties,
  GEMINI_EXPLANATION_MODEL,
} from './services/geminiExplanationEngine';
import {
  DEFAULT_ESCALATION_POLICY,
  DurableEscalationCoordinator,
  SimulatedProviderBehavior,
  SimulationNotificationProvider,
  validateEscalationPolicy,
} from './services/notificationEngine';
import {
  DataQualityState,
  EmergencyContact,
  EnvironmentReadings,
  EscalationPolicyConfig,
  EscalationStage,
  EscalationTaskRecord,
  IngestionBatchResult,
  NormalizedObservation,
  NotificationAttemptRecord,
  ObservationMetricType,
  PersistedAIExplanation,
  ProviderHealthDiagnostics,
  RiskLevel,
  RiskThresholds,
  SafetyAlert,
  SafetyEvent,
  SimulationPreset,
  TelemetryPoint,
  VitalReadings,
  WeatherCondition,
} from './types/safety';

export default function App() {
  const { user, logout } = useAuth();
  const activeUid = user?.uid || 'operator-default-uid';

  // Load the signed-in user's isolated persisted workspace
  const initialWorkspace = useMemo(
    () => loadUserWorkspaceState(activeUid, activeUid),
    [activeUid]
  );

  const [activeTab, setActiveTab] = useState<NavTab>('overview');
  const [vitals, setVitals] = useState<VitalReadings>(initialWorkspace.vitals);
  const [environment, setEnvironment] = useState<EnvironmentReadings>(
    initialWorkspace.environment
  );
  const [thresholds, setThresholds] = useState<RiskThresholds>(
    initialWorkspace.thresholds
  );
  const [activePresetId, setActivePresetId] = useState<string | null>(
    initialWorkspace.activePresetId
  );
  const [autoDriftEnabled, setAutoDriftEnabled] = useState<boolean>(false);
  const [syncWarning, setSyncWarning] = useState<string | null>(null);

  const [activeAlert, setActiveAlert] = useState<SafetyAlert | null>(
    initialWorkspace.activeAlert
  );
  const activeAlertRef = useRef<SafetyAlert | null>(initialWorkspace.activeAlert);
  activeAlertRef.current = activeAlert;

  const [alertHistory, setAlertHistory] = useState<SafetyAlert[]>(
    initialWorkspace.alertHistory
  );
  const [events, setEvents] = useState<SafetyEvent[]>(initialWorkspace.events);
  const [contacts, setContacts] = useState<EmergencyContact[]>(
    initialWorkspace.contacts
  );
  const [telemetryHistory, setTelemetryHistory] = useState<TelemetryPoint[]>(
    initialWorkspace.telemetryHistory
  );
  const [aiExplanation, setAiExplanation] =
    useState<PersistedAIExplanation | null>(
      initialWorkspace.aiExplanation ?? null
    );

  // Escalation Policy, Durable Tasks, Notification Attempts, and Fault Injection
  const [escalationPolicy, setEscalationPolicy] = useState<EscalationPolicyConfig>(
    initialWorkspace.escalationPolicy ?? structuredClone(DEFAULT_ESCALATION_POLICY)
  );
  const [escalationTasks, setEscalationTasks] = useState<EscalationTaskRecord[]>(
    initialWorkspace.escalationTasks ?? []
  );
  const [notificationAttempts, setNotificationAttempts] = useState<
    NotificationAttemptRecord[]
  >(initialWorkspace.notificationAttempts ?? []);
  const [simulationFaultMode, setSimulationFaultMode] =
    useState<SimulatedProviderBehavior>('normal_submitted');

  const simProviderRef = useRef(new SimulationNotificationProvider());
  const coordinatorRef = useRef(
    new DurableEscalationCoordinator({ provider: simProviderRef.current })
  );

  // When the authenticated user (activeUid) changes, immediately load that user's isolated state
  useEffect(() => {
    const loaded = loadUserWorkspaceState(activeUid, activeUid);
    setVitals(loaded.vitals);
    setEnvironment(loaded.environment);
    setThresholds(loaded.thresholds);
    setActivePresetId(loaded.activePresetId);
    setActiveAlert(loaded.activeAlert);
    activeAlertRef.current = loaded.activeAlert;
    setAlertHistory(loaded.alertHistory);
    setEvents(loaded.events);
    setContacts(loaded.contacts);
    setTelemetryHistory(loaded.telemetryHistory);
    setAiExplanation(loaded.aiExplanation ?? null);
    setEscalationPolicy(
      loaded.escalationPolicy ?? structuredClone(DEFAULT_ESCALATION_POLICY)
    );
    setEscalationTasks(loaded.escalationTasks ?? []);
    setNotificationAttempts(loaded.notificationAttempts ?? []);
    setAutoDriftEnabled(false);

    // Restore durable coordinator state so deadlines survive browser refreshes
    const alertsRecord: Record<string, SafetyAlert> = {};
    const allAlerts = loaded.activeAlert
      ? [loaded.activeAlert, ...loaded.alertHistory]
      : loaded.alertHistory;
    for (const a of allAlerts) {
      alertsRecord[a.id] = a;
    }
    const tasksRecord: Record<string, EscalationTaskRecord> = {};
    for (const t of loaded.escalationTasks ?? []) {
      tasksRecord[t.taskId] = t;
    }
    coordinatorRef.current.hydrateFromSnapshot({
      alerts: alertsRecord,
      tasks: tasksRecord,
      attempts: loaded.notificationAttempts ?? [],
      policies: {
        [activeUid]:
          loaded.escalationPolicy ?? structuredClone(DEFAULT_ESCALATION_POLICY),
      },
      contactsByUser: {
        [activeUid]: loaded.contacts,
      },
      auditEventsByUser: {
        [activeUid]: loaded.events,
      },
    });
  }, [activeUid]);

  // Evaluate current risk deterministically
  const assessment = useMemo(
    () => evaluateRisk(vitals, environment, thresholds),
    [vitals, environment, thresholds]
  );

  // Generate deterministic AI explanation
  const explanation = useMemo(
    () => generateSafetyExplanation(assessment, vitals, environment),
    [assessment, vitals, environment]
  );

  // Persist the current user's workspace state across page refreshes whenever state updates
  useEffect(() => {
    saveUserWorkspaceState(activeUid, activeUid, {
      uid: activeUid,
      ruleVersion: RULE_ENGINE_VERSION,
      vitals,
      environment,
      activePresetId,
      thresholds,
      contacts,
      activeAlert,
      alertHistory,
      events,
      telemetryHistory,
      lastAssessment: assessment,
      aiExplanation,
      escalationPolicy,
      escalationTasks,
      notificationAttempts,
      updatedAtIso: new Date().toISOString(),
    });
  }, [
    activeUid,
    vitals,
    environment,
    activePresetId,
    thresholds,
    contacts,
    activeAlert,
    alertHistory,
    events,
    telemetryHistory,
    assessment,
    aiExplanation,
    escalationPolicy,
    escalationTasks,
    notificationAttempts,
  ]);

  // Attach real-time Firestore listeners when an authenticated Firebase user is active,
  // and unsubscribe automatically on unmount or user change.
  useEffect(() => {
    if (!user || !user.isFirebaseBacked) return;

    const unsubscribe = subscribeToUserSafetyData(user.uid, {
      onSettings: (remoteThresholds) => {
        setThresholds(remoteThresholds);
      },
      onContacts: (remoteContacts) => {
        setContacts(remoteContacts);
      },
      onAlerts: (remoteAlerts) => {
        setAlertHistory((prev) => {
          let merged = [...prev];
          for (const a of remoteAlerts) {
            merged = upsertAlertHistory(merged, a);
          }
          return merged;
        });
      },
      onAuditEvents: (remoteEvents) => {
        setEvents(remoteEvents);
      },
      onSyncError: (msg) => {
        setSyncWarning(
          `Firestore sync notice: ${msg}. Continuing with isolated user storage.`
        );
      },
    });

    return () => {
      unsubscribe();
    };
  }, [user]);

  const appendEvent = useCallback(
    (
      type: SafetyEvent['type'],
      riskLevel: RiskLevel,
      title: string,
      detail: string,
      alertId?: string
    ) => {
      const evt: SafetyEvent = {
        id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp: new Date().toISOString(),
        type,
        riskLevel,
        title,
        detail,
        alertId,
      };
      setEvents((prev) => [evt, ...prev.slice(0, 49)]);

      if (user?.isFirebaseBacked) {
        appendAuditEventToFirestore(user.uid, evt).catch(() => {});
      }
    },
    [user]
  );

  // Helper to execute due server/coordinator escalations
  const runDueEscalationCheck = useCallback(
    async (simulatedNowIso?: string) => {
      simProviderRef.current.setBehavior(simulationFaultMode);
      coordinatorRef.current.setContactsForUser(activeUid, activeUid, contacts);
      try {
        coordinatorRef.current.setPolicyForUser(activeUid, activeUid, escalationPolicy);
      } catch {
        // Policy already active
      }
      const nowMs = simulatedNowIso ? Date.parse(simulatedNowIso) : Date.now();
      const summary = await coordinatorRef.current.processDueEscalations(nowMs);

      if (summary.processedTaskIds.length > 0) {
        const updatedTasks = coordinatorRef.current.getTasksForUser(activeUid, activeUid);
        const updatedAttempts =
          coordinatorRef.current.getNotificationAttemptsForUser(activeUid, activeUid);
        const updatedEvents =
          coordinatorRef.current.getAuditEventsForUser(activeUid, activeUid);
        setEscalationTasks(updatedTasks);
        setNotificationAttempts(updatedAttempts);
        if (updatedEvents.length > 0) {
          setEvents((prev) => {
            const existingIds = new Set(prev.map((e) => e.id));
            const newEvts = updatedEvents.filter((e) => !existingIds.has(e.id));
            return [...newEvts, ...prev].slice(0, 50);
          });
        }

        if (user?.isFirebaseBacked) {
          for (const att of updatedAttempts.slice(0, 5)) {
            persistNotificationAttemptToFirestore(user.uid, att).catch(() => {});
          }
        }
      }

      // Sync with server-side durable escalation worker endpoint
      fetch('/api/escalation/process-due', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-vitaguard-uid': activeUid,
        },
        body: JSON.stringify({
          actingUid: activeUid,
          userId: activeUid,
          userDisplayName: user?.displayName || 'VitaGuard Operator',
          policy: escalationPolicy,
          contacts,
          faultMode: simulationFaultMode,
        }),
      }).catch(() => {});
    },
    [activeUid, contacts, escalationPolicy, simulationFaultMode, user]
  );

  // Synchronize telemetry history, active alert, alertHistory, and Firestore whenever assessment updates
  useEffect(() => {
    const now = new Date();
    const point: TelemetryPoint = {
      timestamp: now.toISOString(),
      timeLabel: now.toLocaleTimeString([], {
        minute: '2-digit',
        second: '2-digit',
      }),
      heartRateBpm: vitals.heartRateBpm,
      oxygenSaturationPct: vitals.oxygenSaturationPct,
      bodyTempCelsius: vitals.bodyTempCelsius,
      ambientTempCelsius: environment.ambientTempCelsius,
      riskScore: assessment.overallScore,
      riskLevel: assessment.riskLevel,
    };

    setTelemetryHistory((prev) => {
      const last = prev[prev.length - 1];
      if (
        last &&
        last.heartRateBpm === point.heartRateBpm &&
        last.oxygenSaturationPct === point.oxygenSaturationPct &&
        last.bodyTempCelsius === point.bodyTempCelsius &&
        last.ambientTempCelsius === point.ambientTempCelsius &&
        last.riskScore === point.riskScore
      ) {
        return prev;
      }
      return [...prev.slice(-19), point];
    });

    if (user?.isFirebaseBacked) {
      recordSimulatedObservationAndAssessment(
        user.uid,
        vitals,
        environment,
        assessment
      ).catch(() => {});
    }

    setActiveAlert((prevAlert) => {
      const nextAlert = createAlertFromAssessment(
        assessment,
        prevAlert,
        now.toISOString()
      );

      // If readings returned to LOW risk while an alert was active, transition that alert to RESOLVED
      if (!nextAlert && prevAlert && prevAlert.status !== 'RESOLVED') {
        const resolved = resolveAlert(prevAlert, now.toISOString());
        try {
          coordinatorRef.current.resolveAlertAndCancelEscalation({
            actingUid: activeUid,
            targetUid: activeUid,
            alertId: resolved.id,
            nowMs: now.getTime(),
          });
          setEscalationTasks(coordinatorRef.current.getTasksForUser(activeUid, activeUid));
        } catch {
          // Non-fatal
        }

        fetch('/api/escalation/resolve', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-vitaguard-uid': activeUid,
          },
          body: JSON.stringify({
            actingUid: activeUid,
            userId: activeUid,
            alertId: resolved.id,
          }),
        }).catch(() => {});

        setAlertHistory((prevHistory) => upsertAlertHistory(prevHistory, resolved));
        if (user?.isFirebaseBacked) {
          resolveAlertInFirestore(user.uid, resolved.id).catch(() => {});
        }
      }

      if (nextAlert) {
        // Schedule durable escalation deadline if newly created or escalated
        if (!prevAlert || prevAlert.id !== nextAlert.id) {
          const scheduled = coordinatorRef.current.scheduleAlertEscalation({
            actingUid: activeUid,
            targetUid: activeUid,
            alert: nextAlert,
            contacts,
            policy: escalationPolicy,
            nowMs: now.getTime(),
          });
          setEscalationTasks(coordinatorRef.current.getTasksForUser(activeUid, activeUid));
          setNotificationAttempts(
            coordinatorRef.current.getNotificationAttemptsForUser(activeUid, activeUid)
          );
          if (user?.isFirebaseBacked) {
            persistEscalationTaskToFirestore(user.uid, scheduled.task).catch(
              () => {}
            );
          }

          fetch('/api/escalation/schedule', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-vitaguard-uid': activeUid,
            },
            body: JSON.stringify({
              actingUid: activeUid,
              userId: activeUid,
              userDisplayName: user?.displayName || 'VitaGuard Operator',
              alert: scheduled.alert,
              policy: escalationPolicy,
              contacts,
            }),
          }).catch(() => {});
        }

        setAlertHistory((prevHistory) => upsertAlertHistory(prevHistory, nextAlert));

        if (user?.isFirebaseBacked) {
          persistAlertToFirestore(user.uid, nextAlert).catch(() => {});
        }

        if (
          !prevAlert ||
          prevAlert.id !== nextAlert.id ||
          prevAlert.riskLevel !== nextAlert.riskLevel
        ) {
          appendEvent(
            'alert_triggered',
            nextAlert.riskLevel,
            `Alert Triggered: ${nextAlert.riskLevel.toUpperCase()} Risk`,
            nextAlert.summary,
            nextAlert.id
          );
        }
      }

      return nextAlert;
    });
  }, [
    activeUid,
    assessment,
    contacts,
    environment,
    escalationPolicy,
    vitals,
    appendEvent,
    user,
  ]);

  // Timer for unacknowledged alert escalation progression (guarded by canEscalateAlert)
  useEffect(() => {
    if (!canEscalateAlert(activeAlert)) return;

    const timer = window.setInterval(() => {
      setActiveAlert((prev) => {
        if (!canEscalateAlert(prev)) return prev;

        const nextSeconds = prev!.secondsSinceTriggered + 1;
        const nextStage = computeEscalationStage(prev!, nextSeconds);

        const updated: SafetyAlert = {
          ...prev!,
          secondsSinceTriggered: nextSeconds,
          escalationStage: nextStage,
        };

        setAlertHistory((prevHistory) => upsertAlertHistory(prevHistory, updated));

        if (nextStage !== prev!.escalationStage) {
          appendEvent(
            'escalation_step',
            prev!.riskLevel,
            `Escalation Advanced: ${nextStage.replace(/_/g, ' ').toUpperCase()}`,
            `Alert unacknowledged for ${nextSeconds}s. Stage transitioned to ${nextStage.replace(/_/g, ' ')}.`,
            prev!.id
          );

          if (nextStage === EscalationStage.DEMO_CONTACT_READY) {
            const simulatedFutureIso = new Date(
              Date.now() + (prev!.escalationTimeoutSeconds || 60) * 1000 + 2000
            ).toISOString();
            runDueEscalationCheck(simulatedFutureIso);
          }

          if (user?.isFirebaseBacked) {
            escalateAlertInFirestoreSafely(user.uid, prev!.id, nextSeconds).catch(
              () => {}
            );
          }
        }

        return updated;
      });
    }, 1000);

    return () => window.clearInterval(timer);
  }, [
    activeAlert?.id,
    activeAlert?.acknowledged,
    activeAlert?.status,
    appendEvent,
    runDueEscalationCheck,
    user,
  ]);

  // Optional Sensor Micro-Drift Simulation
  useEffect(() => {
    if (!autoDriftEnabled) return;

    const driftInterval = window.setInterval(() => {
      setVitals((prev) => {
        const deltaHr = Math.floor(Math.random() * 5) - 2;
        const nextHr = Math.max(40, Math.min(195, prev.heartRateBpm + deltaHr));
        const deltaTemp = Number(((Math.random() - 0.48) * 0.1).toFixed(1));
        const nextTemp = Number(
          Math.max(34.5, Math.min(40.5, prev.bodyTempCelsius + deltaTemp)).toFixed(1)
        );
        return {
          ...prev,
          heartRateBpm: nextHr,
          bodyTempCelsius: nextTemp,
        };
      });
    }, 2500);

    return () => window.clearInterval(driftInterval);
  }, [autoDriftEnabled]);

  // Handlers
  const handleUpdateVitals = (next: VitalReadings) => {
    setActivePresetId(null);
    setVitals(next);
  };

  const handleUpdateEnvironment = (next: EnvironmentReadings) => {
    setActivePresetId(null);
    setEnvironment(next);
  };

  const handleApplyPreset = (preset: SimulationPreset) => {
    setActivePresetId(preset.id);
    if (activeAlert?.acknowledged && preset.expectedRisk !== RiskLevel.LOW) {
      setActiveAlert(null);
    }
    setVitals(preset.vitals);
    setEnvironment(preset.environment);
    appendEvent(
      'preset_applied',
      preset.expectedRisk,
      `Applied Scenario Preset: ${preset.name}`,
      preset.subtitle
    );
  };

  const handleResetNominal = () => {
    const nominal = SIMULATION_PRESETS[0];
    setAutoDriftEnabled(false);
    handleApplyPreset(nominal);
  };

  /**
   * Idempotent "I am safe" acknowledgement handler.
   * Immediately locks out pending escalation timers, cancels scheduled escalation tasks,
   * and persists ACKNOWLEDGED state.
   */
  const handleAcknowledgeSafe = (note: string, targetAlertId?: string) => {
    const current = activeAlertRef.current;
    const target =
      targetAlertId && current?.id !== targetAlertId
        ? alertHistory.find((a) => a.id === targetAlertId) || current
        : current;

    if (!target) return;

    const { updatedAlert, timelineEvent, alreadyAcknowledged } =
      acknowledgeAlertIdempotent(target, note);

    if (alreadyAcknowledged) {
      return;
    }

    try {
      const ackResult = coordinatorRef.current.acknowledgeAlertAndCancelEscalation({
        actingUid: activeUid,
        targetUid: activeUid,
        alertId: updatedAlert.id,
        note,
      });
      setEscalationTasks(coordinatorRef.current.getTasksForUser(activeUid, activeUid));
      if (ackResult.task && user?.isFirebaseBacked) {
        persistEscalationTaskToFirestore(user.uid, ackResult.task).catch(() => {});
      }
    } catch {
      // Ensure local acknowledgement still succeeds
    }

    fetch('/api/escalation/acknowledge', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-vitaguard-uid': activeUid,
      },
      body: JSON.stringify({
        actingUid: activeUid,
        userId: activeUid,
        alertId: updatedAlert.id,
        note,
      }),
    }).catch(() => {});

    if (current?.id === updatedAlert.id) {
      activeAlertRef.current = updatedAlert;
      setActiveAlert(updatedAlert);
    }
    setAlertHistory((prevHistory) => upsertAlertHistory(prevHistory, updatedAlert));

    if (timelineEvent) {
      setEvents((prev) => [timelineEvent, ...prev.slice(0, 49)]);
    }

    if (user?.isFirebaseBacked) {
      acknowledgeAlertInFirestore(user.uid, updatedAlert.id, note).catch(() => {});
    }
  };

  const handleAdvanceEscalationDemo = () => {
    const current = activeAlertRef.current;
    if (!canEscalateAlert(current)) return;

    const nextSeconds = current!.secondsSinceTriggered + 15;
    const nextStage = computeEscalationStage(current!, nextSeconds);
    const updated: SafetyAlert = {
      ...current!,
      secondsSinceTriggered: nextSeconds,
      escalationStage: nextStage,
    };
    activeAlertRef.current = updated;
    setActiveAlert(updated);
    setAlertHistory((prevHistory) => upsertAlertHistory(prevHistory, updated));

    appendEvent(
      'escalation_step',
      current!.riskLevel,
      `Simulated +15s Escalation Step (${nextStage.replace(/_/g, ' ').toUpperCase()})`,
      `Unacknowledged duration fast-forwarded to ${nextSeconds}s for escalation testing.`,
      current!.id
    );

    if (nextStage === EscalationStage.DEMO_CONTACT_READY) {
      const simulatedFutureIso = new Date(
        Date.now() + (current!.escalationTimeoutSeconds || 60) * 1000 + 5000
      ).toISOString();
      runDueEscalationCheck(simulatedFutureIso);
    }

    if (user?.isFirebaseBacked) {
      escalateAlertInFirestoreSafely(user.uid, current!.id, nextSeconds).catch(
        () => {}
      );
    }
  };

  const handleTriggerDueEscalationNow = () => {
    const current = activeAlertRef.current;
    if (!current) return;
    const simulatedFutureIso = new Date(
      Date.now() + (current.escalationTimeoutSeconds || 60) * 1000 + 10000
    ).toISOString();
    runDueEscalationCheck(simulatedFutureIso);
  };

  const handleSaveThresholds = (next: RiskThresholds) => {
    setThresholds(next);
    if (user?.isFirebaseBacked) {
      saveUserSettingsToFirestore(user.uid, next).catch(() => {});
    }
    appendEvent(
      'rules_updated',
      assessment.riskLevel,
      'Custom Risk Thresholds Saved',
      `Rule-based risk engine (${RULE_ENGINE_VERSION}) updated with custom physiological and environmental boundaries.`
    );
  };

  const handleResetThresholds = () => {
    setThresholds(DEFAULT_THRESHOLDS);
    if (user?.isFirebaseBacked) {
      saveUserSettingsToFirestore(user.uid, DEFAULT_THRESHOLDS).catch(() => {});
    }
    appendEvent(
      'rules_updated',
      assessment.riskLevel,
      'Default Risk Thresholds Restored',
      'Rule-based risk engine reverted to standard baseline parameters.'
    );
  };

  const handleAddContact = (newContact: Omit<EmergencyContact, 'id'>) => {
    const created: EmergencyContact = {
      ...newContact,
      id: `contact-${Date.now()}`,
      verificationStatus: newContact.verificationStatus || 'PENDING_CODE',
      consentGranted: newContact.consentGranted ?? false,
    };
    setContacts((prev) => [...prev, created]);
    if (user?.isFirebaseBacked) {
      saveEmergencyContactToFirestore(user.uid, created).catch(() => {});
    }
  };

  const handleRemoveContact = (id: string) => {
    setContacts((prev) => {
      const remaining = prev.filter((c) => c.id !== id);
      if (remaining.length > 0 && !remaining.some((c) => c.isPrimary)) {
        remaining[0] = { ...remaining[0], isPrimary: true };
        if (user?.isFirebaseBacked) {
          saveEmergencyContactToFirestore(user.uid, remaining[0]).catch(() => {});
        }
      }
      return remaining;
    });
    if (user?.isFirebaseBacked) {
      deleteEmergencyContactFromFirestore(user.uid, id).catch(() => {});
    }
  };

  const handleSetPrimaryContact = (id: string) => {
    setContacts((prev) =>
      prev.map((c) => {
        const updated = { ...c, isPrimary: c.id === id };
        if (user?.isFirebaseBacked && c.isPrimary !== updated.isPrimary) {
          saveEmergencyContactToFirestore(user.uid, updated).catch(() => {});
        }
        return updated;
      })
    );
  };

  const handleToggleContactVerification = (contactId: string) => {
    const nowIso = new Date().toISOString();
    setContacts((prev) =>
      prev.map((c) => {
        if (c.id !== contactId) return c;
        const nextVerified = c.verificationStatus !== 'VERIFIED';
        return {
          ...c,
          verificationStatus: nextVerified ? 'VERIFIED' : 'PENDING_CODE',
          consentGranted: nextVerified,
          verifiedAtIso: nextVerified ? nowIso : undefined,
        };
      })
    );
  };

  const handleUpdateEscalationPolicy = (nextPolicy: EscalationPolicyConfig) => {
    const validated = validateEscalationPolicy(nextPolicy);
    setEscalationPolicy(validated);
  };

  const handleSimulateDispatch = (contact: EmergencyContact) => {
    const nowIso = new Date().toISOString();
    setContacts((prev) =>
      prev.map((c) =>
        c.id === contact.id ? { ...c, lastSimulatedDispatchAt: nowIso } : c
      )
    );
    appendEvent(
      'contact_simulated',
      assessment.riskLevel,
      `Simulated Contact Notification Logged (${contact.name})`,
      `Demo dispatch recorded locally for ${contact.name} (${contact.phoneDisplay}). No real SMS sent.`
    );
  };

  const handleAIExplanationGenerated = (generated: PersistedAIExplanation) => {
    setAiExplanation(generated);
    if (user?.isFirebaseBacked && !generated.cached) {
      persistAIExplanationToFirestore(user.uid, generated).catch(() => {});
    }
    if (!generated.cached) {
      appendEvent(
        'ai_explanation_generated',
        assessment.riskLevel,
        `AI Contextual Explanation Generated (${generated.modelId})`,
        `Validated explanation ${generated.explanationId} linked to ${generated.assessmentId} (${generated.dataMode} mode).`
      );
    }
  };

  // Provider-independent Data Ingestion Pipeline State & Handlers
  const [coarseLocationConsent, setCoarseLocationConsent] = useState<boolean>(true);
  const [wearableConsent, setWearableConsent] = useState<boolean>(true);
  const [coarseCityLabel, setCoarseCityLabel] = useState<string>(
    'San Francisco, US (37.77, -122.42)'
  );
  const [coarseCoords, setCoarseCoords] = useState<{ lat: number; lon: number }>({
    lat: 37.77,
    lon: -122.42,
  });
  const [isSyncingProviderId, setIsSyncingProviderId] = useState<string | null>(null);
  const [lastBatchResult, setLastBatchResult] =
    useState<IngestionBatchResult | null>(null);
  const [ingestedObservations, setIngestedObservations] = useState<
    NormalizedObservation[]
  >([]);
  const [dataQualityByMetric, setDataQualityByMetric] = useState<
    Partial<Record<ObservationMetricType, DataQualityState>>
  >({
    heart_rate: 'CURRENT',
    oxygen_saturation: 'CURRENT',
    body_temperature: 'CURRENT',
    activity_state: 'CURRENT',
    step_cadence: 'CURRENT',
    ambient_temperature: 'CURRENT',
    relative_humidity: 'CURRENT',
    weather_condition: 'CURRENT',
    wind_speed: 'CURRENT',
    air_quality_index: 'CURRENT',
  });
  const [overallDataQuality, setOverallDataQuality] =
    useState<DataQualityState>('CURRENT');

  const simDataProviderRef = useRef(
    new SimulationDataProvider({
      initialVitals: vitals,
      initialEnvironment: environment,
    })
  );
  const wearableProviderRef = useRef(new WearableDataProvider());
  const envProviderRef = useRef(
    new EnvironmentalDataProvider({
      customWeatherFetcher: async ({ coarseLatitude, coarseLongitude }) => {
        try {
          const resp = await fetch('/api/ingestion/weather', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-vitaguard-uid': activeUid,
            },
            body: JSON.stringify({
              actingUid: activeUid,
              userId: activeUid,
              latitude: coarseLatitude,
              longitude: coarseLongitude,
              consentGranted: true,
            }),
          });
          if (resp.ok) {
            const payload = (await resp.json()) as {
              ambientTempCelsius: number;
              humidityPct: number;
              windSpeedKmh: number;
              weatherCondition: WeatherCondition;
              airQualityIndex?: number;
              observedAtIso: string;
            };
            return payload;
          }
        } catch {
          // Fallback to deterministic regional weather when offline
        }
        return {
          ambientTempCelsius: coarseLatitude < 35 ? 36 : 21,
          humidityPct: coarseLatitude < 30 ? 78 : 48,
          windSpeedKmh: 14,
          weatherCondition: mapWmoCodeToWeatherCondition(
            1,
            coarseLatitude < 35 ? 36 : 21,
            coarseLatitude < 30 ? 78 : 48
          ),
          airQualityIndex: 34,
          observedAtIso: new Date().toISOString(),
        };
      },
    })
  );
  const ingestionCoordinatorRef = useRef(
    new TelemetryIngestionCoordinator({
      providers: [
        simDataProviderRef.current,
        wearableProviderRef.current,
        envProviderRef.current,
      ],
    })
  );
  const [providerDiagnostics, setProviderDiagnostics] = useState<
    ProviderHealthDiagnostics[]
  >(() => ingestionCoordinatorRef.current.listProviderDiagnostics());

  const refreshDiagnosticsAndLedger = useCallback(() => {
    setProviderDiagnostics(
      ingestionCoordinatorRef.current.listProviderDiagnostics()
    );
    try {
      setIngestedObservations(
        ingestionCoordinatorRef.current.getObservationsForUser(
          activeUid,
          activeUid
        )
      );
    } catch {
      // Non-fatal
    }
  }, [activeUid]);

  // Keep simulation data provider synchronized with interactive dashboard sliders
  useEffect(() => {
    simDataProviderRef.current.setScenarioReadings(vitals, environment);
  }, [vitals, environment]);

  const handleConnectProvider = async (providerId: string) => {
    try {
      if (providerId === wearableProviderRef.current.providerId) {
        await wearableProviderRef.current.connectAndAuthorize({
          authenticatedUid: activeUid,
          consentGranted: wearableConsent,
          authTokenOrCode: 'OAUTH_DEMO_GRANT_CODE_VALID',
        });
      } else if (providerId === envProviderRef.current.providerId) {
        await envProviderRef.current.connectAndAuthorize({
          authenticatedUid: activeUid,
          consentGranted: coarseLocationConsent,
          coarseLatitude: coarseCoords.lat,
          coarseLongitude: coarseCoords.lon,
        });
      } else if (providerId === simDataProviderRef.current.providerId) {
        await simDataProviderRef.current.connectAndAuthorize({
          authenticatedUid: activeUid,
          consentGranted: true,
        });
      }
      appendEvent(
        'provider_connected',
        assessment.riskLevel,
        `Data Source Connected: ${providerId}`,
        `Provider adapter authorized for user ${activeUid}.`
      );
    } catch (err) {
      setSyncWarning(
        err instanceof Error ? err.message : 'Failed to connect data provider.'
      );
    } finally {
      refreshDiagnosticsAndLedger();
    }
  };

  const handleSyncProvider = async (providerId: string) => {
    setIsSyncingProviderId(providerId);
    try {
      const batch = await ingestionCoordinatorRef.current.syncFromProvider({
        actingUid: activeUid,
        targetUid: activeUid,
        providerId,
        thresholds,
      });
      setLastBatchResult(batch);
      setDataQualityByMetric(batch.dataQualityByMetric);
      setOverallDataQuality(batch.overallDataQuality);

      if (user?.isFirebaseBacked) {
        for (const obs of batch.accepted.slice(0, 6)) {
          persistNormalizedObservationToFirestore(user.uid, obs).catch(() => {});
        }
      }

      // If environmental weather provider synced real outdoor weather, update outdoor cards when requested
      if (
        providerId === envProviderRef.current.providerId &&
        batch.accepted.length > 0
      ) {
        setEnvironment((prev) => {
          const next = { ...prev };
          for (const obs of batch.accepted) {
            if (obs.metricType === 'ambient_temperature') {
              next.ambientTempCelsius = Number(obs.value);
            } else if (obs.metricType === 'relative_humidity') {
              next.humidityPct = Number(obs.value);
            } else if (obs.metricType === 'wind_speed') {
              next.windSpeedKmh = Number(obs.value);
            } else if (obs.metricType === 'weather_condition') {
              next.weatherCondition = obs.value as WeatherCondition;
            } else if (obs.metricType === 'air_quality_index') {
              next.airQualityIndex = Number(obs.value);
            }
          }
          return next;
        });
      }

      appendEvent(
        'observation_ingested',
        assessment.riskLevel,
        `Synced ${batch.accepted.length} Normalized Observation(s) (${providerId})`,
        `Pipeline Quality: ${batch.overallDataQuality} · Rejected: ${batch.rejected.length}`
      );
    } catch (err) {
      setSyncWarning(
        err instanceof Error ? err.message : 'Provider synchronization failed.'
      );
    } finally {
      setIsSyncingProviderId(null);
      refreshDiagnosticsAndLedger();
    }
  };

  const handleDisconnectProvider = async (providerId: string) => {
    const prov = ingestionCoordinatorRef.current.getProvider(providerId);
    if (!prov) return;
    await prov.disconnect();
    appendEvent(
      'provider_disconnected',
      assessment.riskLevel,
      `Data Source Disconnected: ${providerId}`,
      'Provider disconnected cleanly without triggering emergency alerts.'
    );
    refreshDiagnosticsAndLedger();
  };

  const handleRevokeProvider = async (providerId: string) => {
    const prov = ingestionCoordinatorRef.current.getProvider(providerId);
    if (!prov) return;
    await prov.revokeAuthorization();
    appendEvent(
      'provider_disconnected',
      assessment.riskLevel,
      `Authorization Revoked: ${providerId}`,
      'User consent & provider token revoked; future ingestion blocked until re-authorized.'
    );
    refreshDiagnosticsAndLedger();
  };

  const handleInjectUnitConversionSample = () => {
    const nowIso = new Date().toISOString();
    const batch = ingestionCoordinatorRef.current.ingestBatch({
      actingUid: activeUid,
      targetUid: activeUid,
      providerId: simDataProviderRef.current.providerId,
      thresholds,
      rawObservations: [
        {
          observationId: `sim-f-conv-${Date.now()}`,
          authenticatedOwnerId: activeUid,
          metricType: 'body_temperature',
          value: 100.4, // 100.4 °F -> 38.0 °C
          unit: 'fahrenheit',
          observedAt: nowIso,
          receivedAt: nowIso,
          sourceProvider: simDataProviderRef.current.providerId,
          claimedDataMode: 'SIMULATED',
        },
        {
          observationId: `sim-mph-conv-${Date.now()}`,
          authenticatedOwnerId: activeUid,
          metricType: 'wind_speed',
          value: 20, // 20 mph -> 32.2 km/h
          unit: 'mph',
          observedAt: nowIso,
          receivedAt: nowIso,
          sourceProvider: simDataProviderRef.current.providerId,
          claimedDataMode: 'SIMULATED',
        },
      ],
    });
    setLastBatchResult(batch);
    setDataQualityByMetric(batch.dataQualityByMetric);
    setOverallDataQuality(batch.overallDataQuality);
    refreshDiagnosticsAndLedger();
  };

  // Guided Hackathon Demo Handlers & Safe Demo Reset
  const [lastDemoActionNote, setLastDemoActionNote] = useState<string | null>(
    null
  );

  const handleDemoStep1Baseline = () => {
    const baseline = SIMULATION_PRESETS[0];
    handleApplyPreset(baseline);
    simDataProviderRef.current.setScenarioReadings(
      baseline.vitals,
      baseline.environment
    );
    void handleSyncProvider(simDataProviderRef.current.providerId);
    setLastDemoActionNote(
      'Step 1 Complete: Nominal Baseline loaded and SIMULATED observations synced (LOW risk).'
    );
  };

  const handleDemoStep2HighRiskIngest = () => {
    const criticalPreset = SIMULATION_PRESETS[3];
    handleApplyPreset(criticalPreset);
    simDataProviderRef.current.setScenarioReadings(
      criticalPreset.vitals,
      criticalPreset.environment
    );
    handleInjectUnitConversionSample();
    setLastDemoActionNote(
      'Step 2 Complete: Critical Heat & Exertion scenario applied, °F/mph units normalized, and active alert + deadline scheduled.'
    );
  };

  const handleDemoStep3GenerateAIExplanation = () => {
    const nowIso = new Date().toISOString();
    const assessmentId = `assess-demo-${Date.now()}`;
    const fp = computeAssessmentFingerprint(
      assessment,
      vitals,
      environment,
      'SIMULATED',
      'Guided hackathon demo verification'
    );
    const uncertainties = detectDataUncertainties({
      assessment,
      vitals,
      environment,
      dataMode: 'SIMULATED',
      injectionDetected: false,
    });
    const demoExplanation: PersistedAIExplanation = {
      explanationId: `ai-exp-${assessmentId}-${fp.slice(-8)}`,
      assessmentId,
      assessmentFingerprint: fp,
      userId: activeUid,
      riskLevelSnapshot: assessment.riskLevel,
      overallScoreSnapshot: assessment.overallScore,
      modelId: GEMINI_EXPLANATION_MODEL,
      promptVersion: AI_PROMPT_VERSION,
      schemaVersion: AI_SCHEMA_VERSION,
      summary: explanation.executiveSummary,
      contributingFactors: [
        explanation.physiologicalCorrelation,
        explanation.environmentalContext,
      ],
      triggeredRules: assessment.triggeredRules.map((r) => ({
        id: r.id,
        explanation: `${r.title} (${r.observedValue} vs ${r.thresholdReference}): ${r.rationale}`,
      })),
      uncertainties,
      recommendedActions: explanation.recommendedActions,
      limitations:
        'This explanation is informational only and is not a medical diagnosis. The deterministic rule engine remains the sole authority for risk classification.',
      dataMode: 'SIMULATED',
      generatedAt: nowIso,
      cached: false,
      promptInjectionDetected: false,
    };
    handleAIExplanationGenerated(demoExplanation);
    setLastDemoActionNote(
      `Step 3 Complete: Validated AI explanation (${demoExplanation.explanationId}) linked to assessment without altering risk level.`
    );
  };

  const handleDemoStep4AcknowledgeAndCancel = () => {
    if (!activeAlert) {
      setLastDemoActionNote(
        'Run Step 2 first to create an active alert before acknowledging "I am safe".'
      );
      return;
    }
    handleAcknowledgeSafe(
      'Confirmed "I am safe" during Guided Hackathon Demo.'
    );
    setLastDemoActionNote(
      'Step 4 Complete: Alert acknowledged idempotently and pending server-side escalation task CANCELLED.'
    );
  };

  const handleDemoStep5SimulateUnacknowledgedEscalation = () => {
    const criticalPreset = SIMULATION_PRESETS[3];
    const nowIso = new Date().toISOString();
    const evalCrit = evaluateRisk(
      criticalPreset.vitals,
      criticalPreset.environment,
      thresholds
    );
    const freshAlert = createAlertFromAssessment(evalCrit, null, nowIso);
    if (!freshAlert) return;

    activeAlertRef.current = freshAlert;
    setActiveAlert(freshAlert);
    setAlertHistory((prev) => upsertAlertHistory(prev, freshAlert));

    coordinatorRef.current.scheduleAlertEscalation({
      actingUid: activeUid,
      targetUid: activeUid,
      alert: freshAlert,
      contacts,
      policy: escalationPolicy,
      nowMs: Date.now(),
    });

    const futureIso = new Date(
      Date.now() + (freshAlert.escalationTimeoutSeconds || 60) * 1000 + 10_000
    ).toISOString();
    void runDueEscalationCheck(futureIso);
    setLastDemoActionNote(
      'Step 5 Complete: Unacknowledged deadline expired; simulated notification recorded in audit history (zero real SMS sent).'
    );
  };

  const handleSafeDemoReset = () => {
    const repoReset = resetDemoWorkspaceOnly(activeUid, activeUid);
    const coordReset =
      ingestionCoordinatorRef.current.resetSimulatedDemoDataOnly(
        activeUid,
        activeUid
      );
    setVitals(repoReset.workspace.vitals);
    setEnvironment(repoReset.workspace.environment);
    setActivePresetId(repoReset.workspace.activePresetId);
    setActiveAlert(null);
    activeAlertRef.current = null;
    setAlertHistory([]);
    setEscalationTasks([]);
    setNotificationAttempts([]);
    setAiExplanation(null);
    setEvents(repoReset.workspace.events);
    refreshDiagnosticsAndLedger();

    fetch('/api/demo/reset', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-vitaguard-uid': activeUid,
      },
      body: JSON.stringify({
        actingUid: activeUid,
        targetUid: activeUid,
      }),
    }).catch(() => {});

    setLastDemoActionNote(
      `Safe Demo Reset Complete: Purged ${coordReset.purgedSimulatedCount} SIMULATED observation(s) and preserved ${coordReset.preservedRealCount} REAL observation(s).`
    );
  };

  const realObservationCount = ingestedObservations.filter(
    (o) => o.dataMode === 'REAL'
  ).length;
  const simulatedObservationCount = ingestedObservations.filter(
    (o) => o.dataMode === 'SIMULATED'
  ).length;

  const primaryContact = contacts.find((c) => c.isPrimary) || contacts[0];
  const hasUnacknowledgedAlert = Boolean(
    activeAlert && !activeAlert.acknowledged && activeAlert.status !== 'RESOLVED'
  );

  return (
    <div className="min-h-screen flex flex-col bg-[#F3F6FA] text-[#0F172A]">
      <Navbar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        currentRisk={assessment.riskLevel}
        hasUnacknowledgedAlert={hasUnacknowledgedAlert}
        onQuickAcknowledge={() =>
          handleAcknowledgeSafe('Confirmed "I am safe" via Header Quick Action.')
        }
        user={user}
        onLogout={logout}
      />

      <main className="flex-1 max-w-[1440px] w-full mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-8">
        {syncWarning && (
          <div
            role="status"
            className="p-3.5 rounded-xl bg-[#F8FAFC] border border-[#DCE4EE] text-xs text-[#334155] flex items-center justify-between gap-3"
          >
            <span>{syncWarning}</span>
            <button
              type="button"
              onClick={() => setSyncWarning(null)}
              className="text-xs font-semibold text-[#155EEF] hover:text-[#114AC4] underline shrink-0"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Always show Safety Status & Scenario Switcher at top of workspace */}
        <OverviewSummaryBar
          assessment={assessment}
          activeAlert={activeAlert}
          activePresetId={activePresetId}
          onAcknowledgeSafe={handleAcknowledgeSafe}
          onApplyPreset={handleApplyPreset}
        />

        {/* Reproducible Hackathon Demo & Safe Reset Runner */}
        <HackathonDemoBar
          currentRisk={assessment.riskLevel}
          activeAlert={activeAlert}
          hasAIExplanation={Boolean(aiExplanation)}
          notificationAttemptCount={notificationAttempts.length}
          realObservationCount={realObservationCount}
          simulatedObservationCount={simulatedObservationCount}
          lastDemoActionNote={lastDemoActionNote}
          onRunStep1Baseline={handleDemoStep1Baseline}
          onRunStep2HighRiskIngest={handleDemoStep2HighRiskIngest}
          onRunStep3GenerateAIExplanation={handleDemoStep3GenerateAIExplanation}
          onRunStep4AcknowledgeAndCancel={handleDemoStep4AcknowledgeAndCancel}
          onRunStep5SimulateUnacknowledgedEscalation={
            handleDemoStep5SimulateUnacknowledgedEscalation
          }
          onRunSafeDemoReset={handleSafeDemoReset}
        />

        {activeTab === 'overview' && (
          <div className="space-y-8">
            <VitalCards
              vitals={vitals}
              thresholds={thresholds}
              history={telemetryHistory}
              freshnessStatus={dataQualityByMetric.heart_rate || overallDataQuality}
              sourceProvider={simDataProviderRef.current.providerId}
            />

            <EnvironmentCards
              environment={environment}
              heatIndexCelsius={assessment.heatIndexCelsius}
              environmentalRisk={assessment.environmentalRisk}
              thresholds={thresholds}
              sourceProvider={
                envProviderRef.current.getConnectionStatus() === 'CONNECTED' &&
                envProviderRef.current.getDiagnostics().lastSuccessfulSyncAt
                  ? envProviderRef.current.providerId
                  : simDataProviderRef.current.providerId
              }
              observedAtIso={
                envProviderRef.current.getDiagnostics().lastSuccessfulSyncAt ||
                simDataProviderRef.current.getDiagnostics().lastSuccessfulSyncAt
              }
              dataMode={
                envProviderRef.current.getConnectionStatus() === 'CONNECTED' &&
                envProviderRef.current.getDiagnostics().lastSuccessfulSyncAt
                  ? 'REAL'
                  : 'SIMULATED'
              }
              freshnessStatus={
                dataQualityByMetric.ambient_temperature || overallDataQuality
              }
            />

            <SimulationPanel
              vitals={vitals}
              environment={environment}
              activePresetId={activePresetId}
              autoDriftEnabled={autoDriftEnabled}
              onUpdateVitals={handleUpdateVitals}
              onUpdateEnvironment={handleUpdateEnvironment}
              onApplyPreset={handleApplyPreset}
              onToggleAutoDrift={() => setAutoDriftEnabled((prev) => !prev)}
              onResetNominal={handleResetNominal}
            />

            <DataSourcesPanel
              diagnostics={providerDiagnostics}
              observations={ingestedObservations}
              dataQualityByMetric={dataQualityByMetric}
              overallDataQuality={overallDataQuality}
              lastBatchResult={lastBatchResult}
              coarseLocationConsent={coarseLocationConsent}
              wearableConsent={wearableConsent}
              coarseCityLabel={coarseCityLabel}
              isSyncingProviderId={isSyncingProviderId}
              onToggleCoarseLocationConsent={setCoarseLocationConsent}
              onToggleWearableConsent={setWearableConsent}
              onChangeCoarseCity={(label, lat, lon) => {
                setCoarseCityLabel(label);
                setCoarseCoords({ lat, lon });
              }}
              onConnectProvider={handleConnectProvider}
              onSyncProvider={handleSyncProvider}
              onDisconnectProvider={handleDisconnectProvider}
              onRevokeProvider={handleRevokeProvider}
              onResetSimulationProvider={handleResetNominal}
              onInjectUnitConversionSample={handleInjectUnitConversionSample}
              vitals={vitals}
              environment={environment}
            />

            <McpServerPanel
              actingUid={activeUid}
              vitals={vitals}
              environment={environment}
              thresholds={thresholds}
              contacts={contacts}
              activeAlert={activeAlert}
              onAcknowledgeAlertFromMcp={(note) => handleAcknowledgeSafe(note)}
              onResetDemoFromMcp={() => void handleSafeDemoReset()}
            />

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-8 items-start">
              <AlertPanel
                activeAlert={activeAlert}
                alertHistory={alertHistory}
                events={events}
                primaryContact={primaryContact}
                escalationPolicy={escalationPolicy}
                escalationTasks={escalationTasks}
                notificationAttempts={notificationAttempts}
                simulationFaultMode={simulationFaultMode}
                onChangeFaultMode={setSimulationFaultMode}
                onTriggerDueEscalationNow={handleTriggerDueEscalationNow}
                onAcknowledgeSafe={handleAcknowledgeSafe}
                onAdvanceEscalationDemo={handleAdvanceEscalationDemo}
                onClearEventHistory={() => setEvents([])}
              />

              <AIExplanationPanel
                assessment={assessment}
                explanation={explanation}
                vitals={vitals}
                environment={environment}
                activeUid={activeUid}
                sourceDataMode="SIMULATED"
                persistedAIExplanation={aiExplanation}
                onAIExplanationGenerated={handleAIExplanationGenerated}
              />
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-8 items-start">
              <RuleConfigPanel
                thresholds={thresholds}
                onSaveThresholds={handleSaveThresholds}
                onResetThresholds={handleResetThresholds}
              />

              <EmergencyContactsPanel
                contacts={contacts}
                escalationPolicy={escalationPolicy}
                onUpdateEscalationPolicy={handleUpdateEscalationPolicy}
                onToggleContactVerification={handleToggleContactVerification}
                onAddContact={handleAddContact}
                onRemoveContact={handleRemoveContact}
                onSetPrimary={handleSetPrimaryContact}
                onSimulateDispatch={handleSimulateDispatch}
              />
            </div>
          </div>
        )}

        {activeTab === 'simulation' && (
          <div className="space-y-8">
            <SimulationPanel
              vitals={vitals}
              environment={environment}
              activePresetId={activePresetId}
              autoDriftEnabled={autoDriftEnabled}
              onUpdateVitals={handleUpdateVitals}
              onUpdateEnvironment={handleUpdateEnvironment}
              onApplyPreset={handleApplyPreset}
              onToggleAutoDrift={() => setAutoDriftEnabled((prev) => !prev)}
              onResetNominal={handleResetNominal}
            />
            <DataSourcesPanel
              diagnostics={providerDiagnostics}
              observations={ingestedObservations}
              dataQualityByMetric={dataQualityByMetric}
              overallDataQuality={overallDataQuality}
              lastBatchResult={lastBatchResult}
              coarseLocationConsent={coarseLocationConsent}
              wearableConsent={wearableConsent}
              coarseCityLabel={coarseCityLabel}
              isSyncingProviderId={isSyncingProviderId}
              onToggleCoarseLocationConsent={setCoarseLocationConsent}
              onToggleWearableConsent={setWearableConsent}
              onChangeCoarseCity={(label, lat, lon) => {
                setCoarseCityLabel(label);
                setCoarseCoords({ lat, lon });
              }}
              onConnectProvider={handleConnectProvider}
              onSyncProvider={handleSyncProvider}
              onDisconnectProvider={handleDisconnectProvider}
              onRevokeProvider={handleRevokeProvider}
              onResetSimulationProvider={handleResetNominal}
              onInjectUnitConversionSample={handleInjectUnitConversionSample}
              vitals={vitals}
              environment={environment}
            />
            <VitalCards
              vitals={vitals}
              thresholds={thresholds}
              history={telemetryHistory}
            />
            <EnvironmentCards
              environment={environment}
              heatIndexCelsius={assessment.heatIndexCelsius}
              environmentalRisk={assessment.environmentalRisk}
              thresholds={thresholds}
            />
          </div>
        )}

        {activeTab === 'alerts' && (
          <div className="space-y-8">
            <AlertPanel
              activeAlert={activeAlert}
              alertHistory={alertHistory}
              events={events}
              primaryContact={primaryContact}
              escalationPolicy={escalationPolicy}
              escalationTasks={escalationTasks}
              notificationAttempts={notificationAttempts}
              simulationFaultMode={simulationFaultMode}
              onChangeFaultMode={setSimulationFaultMode}
              onTriggerDueEscalationNow={handleTriggerDueEscalationNow}
              onAcknowledgeSafe={handleAcknowledgeSafe}
              onAdvanceEscalationDemo={handleAdvanceEscalationDemo}
              onClearEventHistory={() => setEvents([])}
            />
            <AIExplanationPanel
              assessment={assessment}
              explanation={explanation}
              vitals={vitals}
              environment={environment}
              activeUid={activeUid}
              sourceDataMode="SIMULATED"
              persistedAIExplanation={aiExplanation}
              onAIExplanationGenerated={handleAIExplanationGenerated}
            />
          </div>
        )}

        {activeTab === 'rules' && (
          <div className="space-y-8">
            <RuleConfigPanel
              thresholds={thresholds}
              onSaveThresholds={handleSaveThresholds}
              onResetThresholds={handleResetThresholds}
            />
            <AIExplanationPanel
              assessment={assessment}
              explanation={explanation}
              vitals={vitals}
              environment={environment}
              activeUid={activeUid}
              sourceDataMode="SIMULATED"
              persistedAIExplanation={aiExplanation}
              onAIExplanationGenerated={handleAIExplanationGenerated}
            />
          </div>
        )}

        {activeTab === 'contacts' && (
          <div className="space-y-8">
            <EmergencyContactsPanel
              contacts={contacts}
              escalationPolicy={escalationPolicy}
              onUpdateEscalationPolicy={handleUpdateEscalationPolicy}
              onToggleContactVerification={handleToggleContactVerification}
              onAddContact={handleAddContact}
              onRemoveContact={handleRemoveContact}
              onSetPrimary={handleSetPrimaryContact}
              onSimulateDispatch={handleSimulateDispatch}
            />
            <AlertPanel
              activeAlert={activeAlert}
              alertHistory={alertHistory}
              events={events}
              primaryContact={primaryContact}
              escalationPolicy={escalationPolicy}
              escalationTasks={escalationTasks}
              notificationAttempts={notificationAttempts}
              simulationFaultMode={simulationFaultMode}
              onChangeFaultMode={setSimulationFaultMode}
              onTriggerDueEscalationNow={handleTriggerDueEscalationNow}
              onAcknowledgeSafe={handleAcknowledgeSafe}
              onAdvanceEscalationDemo={handleAdvanceEscalationDemo}
              onClearEventHistory={() => setEvents([])}
            />
          </div>
        )}
      </main>

      <footer className="border-t border-[#DCE4EE] bg-white mt-12">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-[#64748B]">
          <div className="font-medium text-[#334155]">
            VitaGuard AI — Intelligent Personal Safety and Risk Assistant (Wearable & Environmental Data Integration)
          </div>
          <div className="font-mono text-[11px] text-[#64748B]">
            Provenance-Isolated Telemetry · Rule Engine {RULE_ENGINE_VERSION} · Live SMS Disabled By Default
          </div>
        </div>
      </footer>
    </div>
  );
}

