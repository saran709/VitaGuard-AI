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
  }
> = {
  [RiskLevel.LOW]: {
    title: 'LOW RISK — NOMINAL SAFETY STATUS',
    accentText: 'text-emerald-800',
    containerClass: 'bg-white border-slate-200',
  },
  [RiskLevel.MODERATE]: {
    title: 'MODERATE RISK — ELEVATED ADVISORY',
    accentText: 'text-amber-800',
    containerClass: 'bg-amber-50/40 border-amber-200',
  },
  [RiskLevel.HIGH]: {
    title: 'HIGH RISK — SAFETY CHECK-IN REQUIRED',
    accentText: 'text-orange-800',
    containerClass: 'bg-orange-50/50 border-orange-200',
  },
  [RiskLevel.CRITICAL]: {
    title: 'CRITICAL RISK — IMMEDIATE ACTION & CHECK-IN REQUIRED',
    accentText: 'text-red-800',
    containerClass: 'bg-red-50/60 border-red-200',
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
      className={`border rounded-xl p-6 space-y-5 ${cfg.containerClass}`}
    >
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <div className="space-y-1.5 max-w-3xl">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 font-mono tabular-nums">
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
              <CheckCircle2 className="w-6 h-6 text-emerald-700 shrink-0" aria-hidden="true" />
            ) : assessment.riskLevel === RiskLevel.CRITICAL ? (
              <ShieldAlert className="w-6 h-6 text-red-700 shrink-0" aria-hidden="true" />
            ) : (
              <AlertTriangle className="w-6 h-6 text-amber-700 shrink-0" aria-hidden="true" />
            )}
            <h1 className={`text-xl sm:text-2xl font-bold tracking-tight ${cfg.accentText}`}>
              {cfg.title}
            </h1>
          </div>

          <p className="text-sm text-slate-700 leading-relaxed">
            {assessment.primaryConcern}
          </p>
        </div>

        {/* Immediate Action / Check-in Box */}
        <div className="flex flex-col sm:flex-row lg:flex-col items-stretch sm:items-center lg:items-end justify-between gap-3 shrink-0">
          {hasUnacknowledged ? (
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
              <div className="text-xs text-slate-700 sm:text-right">
                <div className="font-semibold text-slate-900">Active Check-In Pending</div>
                <div className="font-mono tabular-nums text-slate-500">
                  Unacknowledged for {activeAlert?.secondsSinceTriggered ?? 0}s
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  onAcknowledgeSafe('Confirmed "I am safe" from Overview Status Bar.')
                }
                className="px-5 py-2.5 text-xs font-semibold text-white bg-emerald-700 rounded-lg hover:bg-emerald-800 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
              >
                I am safe
              </button>
            </div>
          ) : activeAlert?.acknowledged ? (
            <div className="text-xs text-emerald-800 font-medium">
              Alert acknowledged ("I am safe") at{' '}
              <span className="font-mono tabular-nums">
                {new Date(activeAlert.acknowledgedAt!).toLocaleTimeString()}
              </span>
            </div>
          ) : (
            <div className="text-xs text-slate-500 font-mono">
              Status: Passive Safety Monitoring Active
            </div>
          )}
        </div>
      </div>

      {/* Quick Scenario Switcher Bar for Instant Testing */}
      <div className="pt-4 border-t border-slate-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <span className="text-xs font-medium text-slate-600 shrink-0">
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
                className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                  active
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300 hover:bg-slate-50'
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
