import React from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bell,
  Bot,
  CheckCircle2,
  Cpu,
  Radio,
  Shield,
  ShieldAlert,
  Sliders,
  Sparkles,
  Users,
} from 'lucide-react';
import {
  DataQualityState,
  EnvironmentReadings,
  RiskAssessment,
  RiskLevel,
  RiskThresholds,
  SafetyAlert,
  TelemetryPoint,
  VitalReadings,
} from '../types/safety';
import { useSafetyWorkspace } from '../context/SafetyWorkspaceContext';
import { VitalCards } from '../components/VitalCards';
import { EnvironmentCards } from '../components/EnvironmentCards';
import { HackathonDemoBar } from '../components/HackathonDemoBar';

interface OverviewPageProps {
  vitals?: VitalReadings;
  environment?: EnvironmentReadings;
  thresholds?: RiskThresholds;
  telemetryHistory?: TelemetryPoint[];
  assessment?: RiskAssessment;
  activeAlert?: SafetyAlert | null;
  dataQualityByMetric?: Record<string, DataQualityState>;
  overallDataQuality?: DataQualityState;
  sourceProvider?: string;
  envSourceProvider?: string;
  envObservedAtIso?: string;
  envDataMode?: 'REAL' | 'SIMULATED';
  onNavigateToTab?: (tab: any) => void;
  onAcknowledgeSafe?: (note: string) => void;
}

export const OverviewPage: React.FC<OverviewPageProps> = (props) => {
  const workspace = useSafetyWorkspace();

  const vitals = props.vitals ?? workspace.vitals;
  const environment = props.environment ?? workspace.environment;
  const thresholds = props.thresholds ?? workspace.thresholds;
  const telemetryHistory = props.telemetryHistory ?? workspace.telemetryHistory;
  const assessment = props.assessment ?? workspace.assessment;
  const activeAlert = props.activeAlert !== undefined ? props.activeAlert : workspace.activeAlert;
  const dataQualityByMetric = props.dataQualityByMetric ?? workspace.dataQualityByMetric;
  const overallDataQuality = props.overallDataQuality ?? workspace.overallDataQuality;
  const sourceProvider = props.sourceProvider ?? workspace.simDataProviderRef.current.providerId;
  const envSourceProvider =
    props.envSourceProvider ??
    (workspace.envProviderRef.current.getConnectionStatus() === 'CONNECTED' &&
    workspace.envProviderRef.current.getDiagnostics().lastSuccessfulSyncAt
      ? workspace.envProviderRef.current.providerId
      : workspace.simDataProviderRef.current.providerId);
  const envObservedAtIso =
    props.envObservedAtIso ??
    (workspace.envProviderRef.current.getDiagnostics().lastSuccessfulSyncAt ||
      workspace.simDataProviderRef.current.getDiagnostics().lastSuccessfulSyncAt ||
      new Date().toISOString());
  const envDataMode =
    props.envDataMode ??
    (workspace.envProviderRef.current.getConnectionStatus() === 'CONNECTED' &&
    workspace.envProviderRef.current.getDiagnostics().lastSuccessfulSyncAt
      ? 'REAL'
      : 'SIMULATED');

  const onAcknowledgeSafe = props.onAcknowledgeSafe ?? workspace.handleAcknowledgeSafe;

  const hasUnacknowledgedAlert = Boolean(
    activeAlert && !activeAlert.acknowledged && activeAlert.status !== 'RESOLVED'
  );

  return (
    <div className="space-y-8" data-testid="page-overview">
      {/* 1. Page Header & Risk Status Hero Cockpit */}
      <div className="bg-white border border-[#DCE4EE] rounded-xl p-5 sm:p-6 shadow-[0_1px_3px_rgba(12,25,44,0.04)]">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold font-mono tracking-wider uppercase bg-[#EFF5FF] text-[#155EEF] border border-[#C2D8FF]">
                TELEMETRY COCKPIT
              </span>
              <span className="text-xs font-mono text-[#64748B]">Continuous Biometric Stream</span>
            </div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[#0F172A]">
              System Overview & Real-Time Telemetry
            </h1>
            <p className="text-xs sm:text-sm text-[#475569] max-w-3xl">
              Live vitals telemetry, environmental heat strain assessment, and deterministic safety classification.
            </p>
          </div>

          {/* Real-time Composite Risk Score Card */}
          <div className="flex items-center gap-3 shrink-0">
            <div
              className={`p-3.5 rounded-xl border flex items-center gap-3.5 shadow-xs ${
                assessment.riskLevel === RiskLevel.CRITICAL
                  ? 'bg-[#FEF2F2] border-[#FECACA] text-[#991B1B]'
                  : assessment.riskLevel === RiskLevel.HIGH
                  ? 'bg-[#FFF7ED] border-[#FDBA74] text-[#9A3412]'
                  : assessment.riskLevel === RiskLevel.MODERATE
                  ? 'bg-[#FFFBEB] border-[#FDE68A] text-[#92400E]'
                  : 'bg-[#ECFDF5] border-[#A7F3D0] text-[#065F46]'
              }`}
            >
              <div className="text-center">
                <div className="text-[10px] font-bold font-mono uppercase tracking-wider">
                  Risk Score
                </div>
                <div className="text-2xl font-black font-mono leading-none mt-0.5">
                  {assessment.overallScore}
                  <span className="text-xs font-normal opacity-70">/100</span>
                </div>
              </div>
              <div className="h-8 w-px bg-current opacity-20" />
              <div>
                <div className="text-xs font-black uppercase tracking-wider">
                  {assessment.riskLevel} RISK
                </div>
                <div className="text-[11px] opacity-80">
                  {assessment.triggeredRules.length} rules triggered
                </div>
              </div>
            </div>

            {hasUnacknowledgedAlert ? (
              <button
                type="button"
                onClick={() => onAcknowledgeSafe('Confirmed safe via Overview quick banner')}
                className="vg-btn-safe px-4 py-3 text-xs font-bold inline-flex items-center gap-1.5 shadow-xs"
              >
                <Shield className="w-4 h-4" />
                <span>I am safe</span>
              </button>
            ) : (
              <Link
                to="/simulator"
                className="vg-btn-primary px-4 py-3 text-xs font-semibold inline-flex items-center gap-1.5 shadow-xs"
              >
                <Sliders className="w-4 h-4" />
                <span>Adjust Simulator</span>
              </Link>
            )}
          </div>
        </div>

        {/* Quick Navigation Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-6 pt-5 border-t border-[#E2E8F0]">
          <Link
            to="/simulator"
            className="flex items-center justify-between p-3.5 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0] hover:border-[#CBD5E1] hover:bg-[#F1F5F9] transition-colors group"
          >
            <div className="flex items-center gap-2.5">
              <div className="p-1.5 rounded-md bg-[#EFF5FF] text-[#155EEF]">
                <Sliders className="w-4 h-4" />
              </div>
              <div>
                <div className="text-xs font-bold text-[#0F172A]">Simulator</div>
                <div className="text-[11px] text-[#64748B]">Presets & MCP Server</div>
              </div>
            </div>
            <ArrowRight className="w-3.5 h-3.5 text-[#94A3B8] group-hover:text-[#155EEF] transition-colors" />
          </Link>

          <Link
            to="/alerts"
            className="flex items-center justify-between p-3.5 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0] hover:border-[#CBD5E1] hover:bg-[#F1F5F9] transition-colors group"
          >
            <div className="flex items-center gap-2.5">
              <div className="p-1.5 rounded-md bg-[#FEF2F2] text-[#DC2626]">
                <Bell className="w-4 h-4" />
              </div>
              <div>
                <div className="text-xs font-bold text-[#0F172A]">Alerts & AI</div>
                <div className="text-[11px] text-[#64748B]">Escalation & Gemini</div>
              </div>
            </div>
            <ArrowRight className="w-3.5 h-3.5 text-[#94A3B8] group-hover:text-[#DC2626] transition-colors" />
          </Link>

          <Link
            to="/risk-rules"
            className="flex items-center justify-between p-3.5 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0] hover:border-[#CBD5E1] hover:bg-[#F1F5F9] transition-colors group"
          >
            <div className="flex items-center gap-2.5">
              <div className="p-1.5 rounded-md bg-[#FFFBEB] text-[#D97706]">
                <AlertTriangle className="w-4 h-4" />
              </div>
              <div>
                <div className="text-xs font-bold text-[#0F172A]">Risk Rules</div>
                <div className="text-[11px] text-[#64748B]">Configure thresholds</div>
              </div>
            </div>
            <ArrowRight className="w-3.5 h-3.5 text-[#94A3B8] group-hover:text-[#D97706] transition-colors" />
          </Link>

          <Link
            to="/contacts"
            className="flex items-center justify-between p-3.5 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0] hover:border-[#CBD5E1] hover:bg-[#F1F5F9] transition-colors group"
          >
            <div className="flex items-center gap-2.5">
              <div className="p-1.5 rounded-md bg-[#ECFDF5] text-[#059669]">
                <Users className="w-4 h-4" />
              </div>
              <div>
                <div className="text-xs font-bold text-[#0F172A]">Contacts</div>
                <div className="text-[11px] text-[#64748B]">Emergency network</div>
              </div>
            </div>
            <ArrowRight className="w-3.5 h-3.5 text-[#94A3B8] group-hover:text-[#059669] transition-colors" />
          </Link>
        </div>
      </div>

      {/* Reproducible Hackathon Demo & Verification Runner (Overview Page only) */}
      <HackathonDemoBar
        currentRisk={assessment.riskLevel}
        activeAlert={activeAlert}
        hasAIExplanation={Boolean(workspace.aiExplanation)}
        notificationAttemptCount={workspace.notificationAttempts.length}
        realObservationCount={workspace.realObservationCount}
        simulatedObservationCount={workspace.simulatedObservationCount}
        lastDemoActionNote={workspace.lastDemoActionNote}
        onRunStep1Baseline={workspace.handleDemoStep1Baseline}
        onRunStep2HighRiskIngest={workspace.handleDemoStep2HighRiskIngest}
        onRunStep3GenerateAIExplanation={workspace.handleDemoStep3GenerateAIExplanation}
        onRunStep4AcknowledgeAndCancel={workspace.handleDemoStep4AcknowledgeAndCancel}
        onRunStep5SimulateUnacknowledgedEscalation={
          workspace.handleDemoStep5SimulateUnacknowledgedEscalation
        }
        onRunSafeDemoReset={workspace.handleSafeDemoReset}
      />

      {/* 2. Active Alert Summary Callout (if active) */}
      {activeAlert && (
        <div
          role="alert"
          className={`p-4 sm:p-5 rounded-xl border space-y-3 ${
            activeAlert.riskLevel === RiskLevel.CRITICAL
              ? 'bg-[#FEF2F2] border-[#FECACA] text-[#991B1B]'
              : 'bg-[#FFF7ED] border-[#FDBA74] text-[#9A3412]'
          }`}
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <ShieldAlert className="w-5 h-5 shrink-0 mt-0.5" />
              <div>
                <div className="text-xs font-mono uppercase tracking-wider font-bold">
                  ACTIVE ALERT · {activeAlert.riskLevel.toUpperCase()} LEVEL
                </div>
                <div className="text-sm font-bold mt-0.5">{activeAlert.title}</div>
                <div className="text-xs opacity-80 mt-0.5">
                  Triggered at {new Date(activeAlert.createdAt).toLocaleTimeString()} · Status: {activeAlert.status}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 self-start sm:self-center">
              {!activeAlert.acknowledged && (
                <button
                  type="button"
                  onClick={() => onAcknowledgeSafe('Confirmed "I am safe" on Overview alert banner.')}
                  className="vg-btn-safe px-3.5 py-1.5 text-xs font-bold inline-flex items-center gap-1.5"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>I am safe</span>
                </button>
              )}
              <Link
                to="/alerts"
                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-white/80 hover:bg-white text-current border border-current/20 inline-flex items-center gap-1"
              >
                <span>View Full Alert Timeline</span>
                <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* 3. Primary Telemetry Cards */}
      <VitalCards
        vitals={vitals}
        thresholds={thresholds}
        history={telemetryHistory}
        freshnessStatus={dataQualityByMetric.heart_rate || overallDataQuality}
        sourceProvider={sourceProvider}
      />

      {/* 4. Environmental Strain Cards */}
      <EnvironmentCards
        environment={environment}
        heatIndexCelsius={assessment.heatIndexCelsius}
        environmentalRisk={assessment.environmentalRisk}
        thresholds={thresholds}
        sourceProvider={envSourceProvider}
        observedAtIso={envObservedAtIso}
        dataMode={envDataMode}
        freshnessStatus={
          dataQualityByMetric.ambient_temperature || overallDataQuality
        }
      />

      {/* 5. AI Clinical Explanation Preview & MCP Server Status Preview */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
        {/* AI Explanation Preview Card */}
        <div className="vg-card p-5 sm:p-6 flex flex-col justify-between space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-[#155EEF]" />
                <span className="text-xs font-mono font-bold uppercase tracking-wider text-[#0F172A]">
                  AI Clinical Reasoning Preview
                </span>
              </div>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#F1F5F9] text-[#64748B]">
                Gemini 2.5 Flash
              </span>
            </div>
            <p className="text-xs text-[#475569] leading-relaxed">
              {workspace.aiExplanation
                ? workspace.aiExplanation.summary
                : workspace.explanation.executiveSummary}
            </p>
          </div>

          <div className="pt-2 border-t border-[#E2E8F0] flex items-center justify-between">
            <span className="text-[11px] text-[#64748B]">
              Hallucination Guardrails: Active
            </span>
            <Link
              to="/alerts"
              className="text-xs font-semibold text-[#155EEF] hover:underline inline-flex items-center gap-1"
            >
              <span>Inspect Full AI Assessment</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>

        {/* MCP Server Integration Preview Card */}
        <div className="vg-card p-5 sm:p-6 flex flex-col justify-between space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Cpu className="w-4 h-4 text-[#155EEF]" />
                <span className="text-xs font-mono font-bold uppercase tracking-wider text-[#0F172A]">
                  Model Context Protocol (MCP) Server
                </span>
              </div>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#ECFDF5] text-[#065F46] border border-[#A7F3D0]">
                ACTIVE
              </span>
            </div>
            <p className="text-xs text-[#475569] leading-relaxed">
              Exposes authenticated JSON-RPC tools (<code className="font-mono text-[#0F172A]">vitaguard_get_risk_status</code>, <code className="font-mono text-[#0F172A]">vitaguard_acknowledge_alert</code>) for AI agents with step-up confirmation tokens.
            </p>
          </div>

          <div className="pt-2 border-t border-[#E2E8F0] flex items-center justify-between">
            <span className="text-[11px] font-mono text-[#64748B]">
              Protocol Version: 2024-11-05
            </span>
            <Link
              to="/simulator"
              className="text-xs font-semibold text-[#155EEF] hover:underline inline-flex items-center gap-1"
            >
              <span>Open MCP Inspector</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};
