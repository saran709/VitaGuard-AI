import React from 'react';
import { AlertTriangle, CheckCircle2, ShieldAlert } from 'lucide-react';
import {
  EscalationStage,
  RiskAssessment,
  RiskLevel,
  SafetyAlert,
  SimulationPreset,
} from '../types/safety';
import { SIMULATION_PRESETS } from '../engine/riskEngine';

interface OverviewSummaryBarProps {
  assessment: RiskAssessment;
  activeAlert: SafetyAlert | null;
  activePresetId: string | null;
  onAcknowledgeSafe: (note: string) => void;
  onApplyPreset: (preset: SimulationPreset) => void;
}

const RISK_SUMMARY_CONFIG: Record<
  RiskLevel,
  {
    title: string;
    accentText: string;
    containerClass: string;
    dividerClass: string;
  }
> = {
  [RiskLevel.LOW]: {
    title: 'LOW RISK — NOMINAL SAFETY STATUS',
    accentText: 'text-[#065F46]',
    containerClass: 'bg-white border-[#DCE4EE] shadow-[0_1px_2px_rgba(12,25,44,0.03)]',
    dividerClass: 'border-[#E3EAF2]',
  },
  [RiskLevel.MODERATE]: {
    title: 'MODERATE RISK — ELEVATED ADVISORY',
    accentText: 'text-[#92400E]',
    containerClass: 'bg-[#FFFBEB] border-[#FDE68A] shadow-[0_1px_2px_rgba(146,64,14,0.04)]',
    dividerClass: 'border-[#FDE68A]/80',
  },
  [RiskLevel.HIGH]: {
    title: 'HIGH RISK — SAFETY CHECK-IN REQUIRED',
    accentText: 'text-[#9A3412]',
    containerClass: 'bg-[#FFF7ED] border-[#FDBA74] shadow-[0_1px_3px_rgba(154,52,18,0.05)]',
    dividerClass: 'border-[#FED7AA]',
  },
  [RiskLevel.CRITICAL]: {
    title: 'CRITICAL RISK — IMMEDIATE ACTION & CHECK-IN REQUIRED',
    accentText: 'text-[#991B1B]',
    containerClass: 'bg-[#FEF2F2] border-[#FECACA] shadow-[0_1px_3px_rgba(153,27,27,0.06)]',
    dividerClass: 'border-[#FECACA]',
  },
};

export const OverviewSummaryBar: React.FC<OverviewSummaryBarProps> = ({
  assessment,
  activeAlert,
  activePresetId,
  onAcknowledgeSafe,
  onApplyPreset,
}) => {
  const cfg = RISK_SUMMARY_CONFIG[assessment.riskLevel];
  const hasUnacknowledged = Boolean(activeAlert && !activeAlert.acknowledged);

  return (
    <section
      aria-label="Safety Status Summary"
      className={`border rounded-xl p-6 space-y-5 transition-colors ${cfg.containerClass}`}
    >
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <div className="space-y-1.5 max-w-3xl">
          <div className="flex flex-wrap items-center gap-2 text-xs text-[#5E738B] font-mono tabular-nums">
            <span>Overall Risk Level: {assessment.riskLevel.toUpperCase()}</span>
            <span aria-hidden="true">·</span>
            <span>Composite Score: {assessment.overallScore}/100</span>
            <span aria-hidden="true">·</span>
            <span>Triggered Rules: {assessment.triggeredRules.length}</span>
            <span aria-hidden="true">·</span>
            <span>
              Escalation:{' '}
              {activeAlert
                ? activeAlert.escalationStage.replace(/_/g, ' ').toUpperCase()
                : EscalationStage.MONITORING.toUpperCase()}
            </span>
          </div>

          <div className="flex items-center gap-2.5">
            {assessment.riskLevel === RiskLevel.LOW ? (
              <CheckCircle2 className="w-6 h-6 text-[#059669] shrink-0" aria-hidden="true" />
            ) : assessment.riskLevel === RiskLevel.CRITICAL ? (
              <ShieldAlert className="w-6 h-6 text-[#DC2626] shrink-0" aria-hidden="true" />
            ) : (
              <AlertTriangle className="w-6 h-6 text-[#D97706] shrink-0" aria-hidden="true" />
            )}
            <h1 className={`text-xl sm:text-2xl font-bold tracking-tight ${cfg.accentText}`}>
              {cfg.title}
            </h1>
          </div>

          <p className="text-sm text-[#334760] leading-relaxed">
            {assessment.primaryConcern}
          </p>
        </div>

        {/* Immediate Action / Check-in Box */}
        <div className="flex flex-col sm:flex-row lg:flex-col items-stretch sm:items-center lg:items-end justify-between gap-3 shrink-0">
          {hasUnacknowledged ? (
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
              <div className="text-xs text-[#334760] sm:text-right">
                <div className="font-semibold text-[#0C192C]">Active Check-In Pending</div>
                <div className="font-mono tabular-nums text-[#5E738B]">
                  Unacknowledged for {activeAlert?.secondsSinceTriggered ?? 0}s
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  onAcknowledgeSafe('Confirmed "I am safe" from Overview Status Bar.')
                }
                className="vg-btn-safe px-5 py-2.5 text-xs whitespace-nowrap shrink-0"
              >
                I am safe
              </button>
            </div>
          ) : activeAlert?.acknowledged ? (
            <div className="text-xs text-[#065F46] font-semibold">
              Alert acknowledged ("I am safe") at{' '}
              <span className="font-mono tabular-nums">
                {new Date(activeAlert.acknowledgedAt!).toLocaleTimeString()}
              </span>
            </div>
          ) : (
            <div className="text-xs text-[#5E738B] font-mono">
              Status: Passive Safety Monitoring Active
            </div>
          )}
        </div>
      </div>

      {/* Quick Scenario Switcher Bar for Instant Testing */}
      <div className={`pt-4 border-t ${cfg.dividerClass} flex flex-col sm:flex-row sm:items-center justify-between gap-3`}>
        <span className="text-xs font-semibold text-[#334760] shrink-0">
          Test Simulated Scenarios:
        </span>
        <div className="flex flex-wrap items-center gap-1.5">
          {SIMULATION_PRESETS.map((preset) => {
            const active = activePresetId === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => onApplyPreset(preset)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                  active
                    ? 'bg-[#155EEF] text-white border-[#155EEF] shadow-2xs'
                    : 'bg-white text-[#334760] border-[#DCE4EE] hover:border-[#9FB2CA] hover:bg-[#F7F9FC] hover:text-[#0C192C]'
                }`}
              >
                {preset.name} ({preset.expectedRisk.toUpperCase()})
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
};
