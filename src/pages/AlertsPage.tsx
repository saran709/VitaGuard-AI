import React from 'react';
import {
  EmergencyContact,
  EnvironmentReadings,
  EscalationPolicyConfig,
  EscalationTaskRecord,
  ExplanationReport,
  NotificationAttemptRecord,
  PersistedAIExplanation,
  RiskAssessment,
  SafetyAlert,
  SafetyEvent,
  VitalReadings,
} from '../types/safety';
import { SimulatedProviderBehavior } from '../services/notificationEngine';
import { useSafetyWorkspace } from '../context/SafetyWorkspaceContext';
import { AlertPanel } from '../components/AlertPanel';
import { AIExplanationPanel } from '../components/AIExplanationPanel';

interface AlertsPageProps {
  activeAlert?: SafetyAlert | null;
  alertHistory?: SafetyAlert[];
  events?: SafetyEvent[];
  primaryContact?: EmergencyContact | undefined;
  escalationPolicy?: EscalationPolicyConfig;
  escalationTasks?: EscalationTaskRecord[];
  notificationAttempts?: NotificationAttemptRecord[];
  simulationFaultMode?: SimulatedProviderBehavior;
  onChangeFaultMode?: (mode: SimulatedProviderBehavior) => void;
  onTriggerDueEscalationNow?: () => void;
  onAcknowledgeSafe?: (note: string, targetAlertId?: string) => void;
  onAdvanceEscalationDemo?: () => void;
  onClearEventHistory?: () => void;
  assessment?: RiskAssessment;
  explanation?: ExplanationReport;
  vitals?: VitalReadings;
  environment?: EnvironmentReadings;
  activeUid?: string;
  persistedAIExplanation?: PersistedAIExplanation | null;
  onAIExplanationGenerated?: (explanation: PersistedAIExplanation) => void;
}

export const AlertsPage: React.FC<AlertsPageProps> = (props) => {
  const workspace = useSafetyWorkspace();

  const activeAlert = props.activeAlert !== undefined ? props.activeAlert : workspace.activeAlert;
  const alertHistory = props.alertHistory ?? workspace.alertHistory;
  const events = props.events ?? workspace.events;
  const primaryContact = props.primaryContact !== undefined ? props.primaryContact : workspace.primaryContact;
  const escalationPolicy = props.escalationPolicy ?? workspace.escalationPolicy;
  const escalationTasks = props.escalationTasks ?? workspace.escalationTasks;
  const notificationAttempts = props.notificationAttempts ?? workspace.notificationAttempts;
  const simulationFaultMode = props.simulationFaultMode ?? workspace.simulationFaultMode;
  const onChangeFaultMode = props.onChangeFaultMode ?? workspace.setSimulationFaultMode;
  const onTriggerDueEscalationNow = props.onTriggerDueEscalationNow ?? workspace.handleTriggerDueEscalationNow;
  const onAcknowledgeSafe = props.onAcknowledgeSafe ?? workspace.handleAcknowledgeSafe;
  const onAdvanceEscalationDemo = props.onAdvanceEscalationDemo ?? workspace.handleAdvanceEscalationDemo;
  const onClearEventHistory = props.onClearEventHistory ?? workspace.handleClearEventHistory;
  const assessment = props.assessment ?? workspace.assessment;
  const explanation = props.explanation ?? workspace.explanation;
  const vitals = props.vitals ?? workspace.vitals;
  const environment = props.environment ?? workspace.environment;
  const activeUid = props.activeUid ?? workspace.activeUid;
  const persistedAIExplanation = props.persistedAIExplanation !== undefined ? props.persistedAIExplanation : workspace.aiExplanation;
  const onAIExplanationGenerated = props.onAIExplanationGenerated ?? workspace.handleAIExplanationGenerated;

  return (
    <div className="space-y-8" data-testid="page-alerts">
      {/* Page Header */}
      <div className="bg-white border border-[#DCE4EE] rounded-xl p-5 sm:p-6 shadow-[0_1px_3px_rgba(12,25,44,0.04)]">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold font-mono tracking-wider uppercase bg-[#EFF5FF] text-[#155EEF] border border-[#C2D8FF]">
              EMERGENCY WORKFLOW
            </span>
            <span className="text-xs font-mono text-[#64748B]">Deterministic Escalation & AI Explanations</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[#0F172A]">
            Safety Alerts, Escalation & AI Reasoning
          </h1>
          <p className="text-xs sm:text-sm text-[#475569] max-w-3xl">
            Monitor real-time risk alerts, acknowledge safety check-ins to cancel pending escalation, audit dispatch attempts, and inspect Gemini clinical reasoning generated with strict hallucination guardrails.
          </p>
        </div>
      </div>

      {/* Two Column Layout: Emergency Alert Management & AI Reasoning Engine */}
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
          onChangeFaultMode={onChangeFaultMode}
          onTriggerDueEscalationNow={onTriggerDueEscalationNow}
          onAcknowledgeSafe={onAcknowledgeSafe}
          onAdvanceEscalationDemo={onAdvanceEscalationDemo}
          onClearEventHistory={onClearEventHistory}
        />

        <AIExplanationPanel
          assessment={assessment}
          explanation={explanation}
          vitals={vitals}
          environment={environment}
          activeUid={activeUid}
          sourceDataMode="SIMULATED"
          persistedAIExplanation={persistedAIExplanation}
          onAIExplanationGenerated={onAIExplanationGenerated}
        />
      </div>
    </div>
  );
};
