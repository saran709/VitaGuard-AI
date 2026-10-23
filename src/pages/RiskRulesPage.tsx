import React from 'react';
import { ShieldCheck } from 'lucide-react';
import {
  EnvironmentReadings,
  ExplanationReport,
  PersistedAIExplanation,
  RiskAssessment,
  RiskThresholds,
  VitalReadings,
} from '../types/safety';
import { useSafetyWorkspace } from '../context/SafetyWorkspaceContext';
import { RuleConfigPanel } from '../components/RuleConfigPanel';
import { AIExplanationPanel } from '../components/AIExplanationPanel';

interface RiskRulesPageProps {
  thresholds?: RiskThresholds;
  assessment?: RiskAssessment;
  explanation?: ExplanationReport;
  vitals?: VitalReadings;
  environment?: EnvironmentReadings;
  activeUid?: string;
  persistedAIExplanation?: PersistedAIExplanation | null;
  onSaveThresholds?: (t: RiskThresholds) => void;
  onResetThresholds?: () => void;
  onAIExplanationGenerated?: (explanation: PersistedAIExplanation) => void;
}

export const RiskRulesPage: React.FC<RiskRulesPageProps> = (props) => {
  const workspace = useSafetyWorkspace();

  const thresholds = props.thresholds ?? workspace.thresholds;
  const assessment = props.assessment ?? workspace.assessment;
  const explanation = props.explanation ?? workspace.explanation;
  const vitals = props.vitals ?? workspace.vitals;
  const environment = props.environment ?? workspace.environment;
  const activeUid = props.activeUid ?? workspace.activeUid;
  const persistedAIExplanation = props.persistedAIExplanation !== undefined ? props.persistedAIExplanation : workspace.aiExplanation;
  const onSaveThresholds = props.onSaveThresholds ?? workspace.handleSaveThresholds;
  const onResetThresholds = props.onResetThresholds ?? workspace.handleResetThresholds;
  const onAIExplanationGenerated = props.onAIExplanationGenerated ?? workspace.handleAIExplanationGenerated;

  return (
    <div className="space-y-8" data-testid="page-risk-rules">
      {/* Page Header */}
      <div className="bg-white border border-[#DCE4EE] rounded-xl p-5 sm:p-6 shadow-[0_1px_3px_rgba(12,25,44,0.04)]">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold font-mono tracking-wider uppercase bg-[#EFF5FF] text-[#155EEF] border border-[#C2D8FF]">
              DETERMINISTIC SAFETY ENGINE
            </span>
            <span className="text-xs font-mono text-[#64748B]">Configurable Clinical Thresholds</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[#0F172A]">
            Risk Rules & Safety Thresholds
          </h1>
          <p className="text-xs sm:text-sm text-[#475569] max-w-3xl">
            Configure biometric bounds, multi-parameter thermal strain matrices, and environmental hazard thresholds. The safety engine executes deterministically with verifiable boundary guarantees.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8 items-start">
        {/* Threshold Configuration Panel */}
        <RuleConfigPanel
          thresholds={thresholds}
          onSaveThresholds={onSaveThresholds}
          onResetThresholds={onResetThresholds}
        />

        {/* AI Explanation & Context */}
        <div className="space-y-6">
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

          {/* Clinical Threshold Specifications Reference Card */}
          <div className="vg-card p-5 sm:p-6 space-y-4">
            <div className="flex items-center gap-2 text-xs font-mono text-[#64748B]">
              <ShieldCheck className="w-4 h-4 text-[#155EEF]" />
              <span className="font-bold uppercase tracking-wider text-[#0F172A]">
                Deterministic Guardrail Specifications
              </span>
            </div>

            <p className="text-xs text-[#475569] leading-relaxed">
              VitaGuard AI separates classification from natural language generation. Threshold evaluations are purely mathematical and cannot be overridden by AI outputs.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="vg-well p-3 space-y-1">
                <div className="font-bold text-[#0F172A]">Tachycardia & Bradycardia</div>
                <div className="text-[11px] text-[#64748B]">
                  Evaluates high HR (&gt;{thresholds.heartRate.criticalHigh} bpm) and low HR (&lt;{thresholds.heartRate.criticalLow} bpm) with immediate alert generation.
                </div>
              </div>

              <div className="vg-well p-3 space-y-1">
                <div className="font-bold text-[#0F172A]">Hypoxemia & Desaturation</div>
                <div className="text-[11px] text-[#64748B]">
                  Flags moderate desaturation below {thresholds.oxygenSaturation.normalMin}% and critical hypoxic hazard below {thresholds.oxygenSaturation.highMin}%.
                </div>
              </div>

              <div className="vg-well p-3 space-y-1">
                <div className="font-bold text-[#0F172A]">Hyperthermia & Fever</div>
                <div className="text-[11px] text-[#64748B]">
                  Core body temperature &gt;{thresholds.bodyTemp.moderateMax}°C flags acute heat stroke risk when compounded by environmental heat.
                </div>
              </div>

              <div className="vg-well p-3 space-y-1">
                <div className="font-bold text-[#0F172A]">Environmental Heat Index</div>
                <div className="text-[11px] text-[#64748B]">
                  NOAA Steadman formula evaluates combined ambient temperature, humidity, and solar load into actionable WBGT/Heat Index risk bands.
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
