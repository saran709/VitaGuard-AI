import React from 'react';
import { Bot, Database, Sliders } from 'lucide-react';
import {
  DataQualityState,
  EmergencyContact,
  EnvironmentReadings,
  IngestionBatchResult,
  NormalizedObservation,
  ProviderHealthDiagnostics,
  RiskThresholds,
  SafetyAlert,
  SimulationPreset,
  VitalReadings,
} from '../types/safety';
import { useSafetyWorkspace } from '../context/SafetyWorkspaceContext';
import { SimulationPanel } from '../components/SimulationPanel';
import { DataSourcesPanel } from '../components/DataSourcesPanel';
import { McpServerPanel } from '../components/McpServerPanel';

interface SimulatorPageProps {
  vitals?: VitalReadings;
  environment?: EnvironmentReadings;
  activePresetId?: string | null;
  autoDriftEnabled?: boolean;
  providerDiagnostics?: ProviderHealthDiagnostics[];
  ingestedObservations?: NormalizedObservation[];
  dataQualityByMetric?: Record<string, DataQualityState>;
  overallDataQuality?: DataQualityState;
  lastBatchResult?: IngestionBatchResult | null;
  coarseLocationConsent?: boolean;
  wearableConsent?: boolean;
  coarseCityLabel?: string;
  isSyncingProviderId?: string | null;
  thresholds?: RiskThresholds;
  contacts?: EmergencyContact[];
  activeAlert?: SafetyAlert | null;
  activeUid?: string;
  onUpdateVitals?: (v: VitalReadings) => void;
  onUpdateEnvironment?: (e: EnvironmentReadings) => void;
  onApplyPreset?: (preset: SimulationPreset) => void;
  onToggleAutoDrift?: () => void;
  onResetNominal?: () => void;
  onToggleCoarseLocationConsent?: (c: boolean) => void;
  onToggleWearableConsent?: (c: boolean) => void;
  onChangeCoarseCity?: (label: string, lat: number, lon: number) => void;
  onConnectProvider?: (id: string) => Promise<void>;
  onSyncProvider?: (id: string) => Promise<void>;
  onDisconnectProvider?: (id: string) => Promise<void>;
  onRevokeProvider?: (id: string) => Promise<void>;
  onInjectUnitConversionSample?: () => void | Promise<void>;
  onAcknowledgeAlertFromMcp?: (note: string) => void;
  onResetDemoFromMcp?: () => void;
}

export const SimulatorPage: React.FC<SimulatorPageProps> = (props) => {
  const workspace = useSafetyWorkspace();

  const vitals = props.vitals ?? workspace.vitals;
  const environment = props.environment ?? workspace.environment;
  const activePresetId = props.activePresetId !== undefined ? props.activePresetId : workspace.activePresetId;
  const autoDriftEnabled = props.autoDriftEnabled ?? workspace.autoDriftEnabled;
  const providerDiagnostics = props.providerDiagnostics ?? workspace.providerDiagnostics;
  const ingestedObservations = props.ingestedObservations ?? workspace.ingestedObservations;
  const dataQualityByMetric = props.dataQualityByMetric ?? workspace.dataQualityByMetric;
  const overallDataQuality = props.overallDataQuality ?? workspace.overallDataQuality;
  const lastBatchResult = props.lastBatchResult !== undefined ? props.lastBatchResult : workspace.lastBatchResult;
  const coarseLocationConsent = props.coarseLocationConsent ?? workspace.coarseLocationConsent;
  const wearableConsent = props.wearableConsent ?? workspace.wearableConsent;
  const coarseCityLabel = props.coarseCityLabel ?? workspace.coarseCityLabel;
  const isSyncingProviderId = props.isSyncingProviderId !== undefined ? props.isSyncingProviderId : workspace.isSyncingProviderId;
  const thresholds = props.thresholds ?? workspace.thresholds;
  const contacts = props.contacts ?? workspace.contacts;
  const activeAlert = props.activeAlert !== undefined ? props.activeAlert : workspace.activeAlert;
  const activeUid = props.activeUid ?? workspace.activeUid;

  const onUpdateVitals = props.onUpdateVitals ?? workspace.handleUpdateVitals;
  const onUpdateEnvironment = props.onUpdateEnvironment ?? workspace.handleUpdateEnvironment;
  const onApplyPreset = props.onApplyPreset ?? workspace.handleApplyPreset;
  const onToggleAutoDrift = props.onToggleAutoDrift ?? workspace.handleToggleAutoDrift;
  const onResetNominal = props.onResetNominal ?? workspace.handleResetNominal;
  const onToggleCoarseLocationConsent = props.onToggleCoarseLocationConsent ?? workspace.setCoarseLocationConsent;
  const onToggleWearableConsent = props.onToggleWearableConsent ?? workspace.setWearableConsent;
  const onChangeCoarseCity = props.onChangeCoarseCity ?? ((label, lat, lon) => {
    workspace.setCoarseCityLabel(label);
    workspace.setCoarseCoords({ lat, lon });
  });
  const onConnectProvider = props.onConnectProvider ?? workspace.handleConnectProvider;
  const onSyncProvider = props.onSyncProvider ?? workspace.handleSyncProvider;
  const onDisconnectProvider = props.onDisconnectProvider ?? workspace.handleDisconnectProvider;
  const onRevokeProvider = props.onRevokeProvider ?? workspace.handleRevokeProvider;
  const onInjectUnitConversionSample = props.onInjectUnitConversionSample ?? workspace.handleInjectUnitConversionSample;
  const onAcknowledgeAlertFromMcp = props.onAcknowledgeAlertFromMcp ?? ((note) => workspace.handleAcknowledgeSafe(note));
  const onResetDemoFromMcp = props.onResetDemoFromMcp ?? (() => void workspace.handleSafeDemoReset());

  return (
    <div className="space-y-8" data-testid="page-simulator">
      {/* Page Header */}
      <div className="bg-white border border-[#DCE4EE] rounded-xl p-5 sm:p-6 shadow-[0_1px_3px_rgba(12,25,44,0.04)]">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold font-mono tracking-wider uppercase bg-[#EFF5FF] text-[#155EEF] border border-[#C2D8FF]">
              SIMULATION & INTEGRATIONS
            </span>
            <span className="text-xs font-mono text-[#64748B]">Synthetic & Connected Ingestion</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[#0F172A]">
            Physiological Simulator & External Data Sources
          </h1>
          <p className="text-xs sm:text-sm text-[#475569] max-w-3xl">
            Simulate biometric presets, inject calibrated environmental heat stress vectors, manage wearable and weather data provenance, and execute AI agent tool calling via the Model Context Protocol (MCP).
          </p>
        </div>
      </div>

      {/* 1. Simulation Controls & Presets */}
      <SimulationPanel
        vitals={vitals}
        environment={environment}
        activePresetId={activePresetId}
        autoDriftEnabled={autoDriftEnabled}
        onUpdateVitals={onUpdateVitals}
        onUpdateEnvironment={onUpdateEnvironment}
        onApplyPreset={onApplyPreset}
        onToggleAutoDrift={onToggleAutoDrift}
        onResetNominal={onResetNominal}
      />

      {/* 2. Wearable & Environmental Data Ingestion */}
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
        onToggleCoarseLocationConsent={onToggleCoarseLocationConsent}
        onToggleWearableConsent={onToggleWearableConsent}
        onChangeCoarseCity={onChangeCoarseCity}
        onConnectProvider={onConnectProvider}
        onSyncProvider={onSyncProvider}
        onDisconnectProvider={onDisconnectProvider}
        onRevokeProvider={onRevokeProvider}
        onResetSimulationProvider={onResetNominal}
        onInjectUnitConversionSample={onInjectUnitConversionSample}
        vitals={vitals}
        environment={environment}
      />

      {/* 3. VitaGuard MCP Server Console */}
      <McpServerPanel
        actingUid={activeUid}
        vitals={vitals}
        environment={environment}
        thresholds={thresholds}
        contacts={contacts}
        activeAlert={activeAlert}
        onAcknowledgeAlertFromMcp={onAcknowledgeAlertFromMcp}
        onResetDemoFromMcp={onResetDemoFromMcp}
      />
    </div>
  );
};
