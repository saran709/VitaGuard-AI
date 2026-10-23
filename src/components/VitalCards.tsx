import React from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  ActivityLevel,
  DataQualityState,
  RiskThresholds,
  TelemetryPoint,
  VitalReadings,
} from '../types/safety';

interface VitalCardsProps {
  vitals: VitalReadings;
  thresholds: RiskThresholds;
  history: TelemetryPoint[];
  freshnessStatus?: DataQualityState;
  sourceProvider?: string;
}

function getVitalStatusText(
  value: number,
  lowWarn: number,
  highWarn: number,
  highCrit: number,
  lowCrit?: number
): { label: string; colorClass: string } {
  if ((lowCrit !== undefined && value <= lowCrit) || value >= highCrit) {
    return { label: 'Critical Range', colorClass: 'text-red-700 font-semibold' };
  }
  if (value < lowWarn || value >= highWarn) {
    return { label: 'Elevated Deviation', colorClass: 'text-amber-700 font-semibold' };
  }
  return { label: 'Within Nominal Bounds', colorClass: 'text-emerald-700 font-medium' };
}

function getSpo2StatusText(
  spo2: number,
  thresholds: RiskThresholds['oxygenSaturation']
): { label: string; colorClass: string } {
  if (spo2 <= thresholds.highMin) {
    return { label: 'Critical Desaturation', colorClass: 'text-red-700 font-semibold' };
  }
  if (spo2 < thresholds.moderateMin) {
    return { label: 'High Risk Desaturation', colorClass: 'text-red-600 font-semibold' };
  }
  if (spo2 < thresholds.normalMin) {
    return { label: 'Borderline Saturation', colorClass: 'text-amber-700 font-semibold' };
  }
  return { label: 'Optimal Saturation', colorClass: 'text-emerald-700 font-medium' };
}

const ACTIVITY_LABELS: Record<ActivityLevel, string> = {
  [ActivityLevel.RESTING]: 'Resting / Sedentary',
  [ActivityLevel.LIGHT_WALKING]: 'Light Walking',
  [ActivityLevel.MODERATE_EXERCISE]: 'Moderate Exercise',
  [ActivityLevel.INTENSE_EXERTION]: 'Intense Exertion',
};

export const VitalCards: React.FC<VitalCardsProps> = ({
  vitals,
  thresholds,
  history,
  freshnessStatus = 'CURRENT',
  sourceProvider = 'vitaguard-simulation-sandbox',
}) => {
  const hrStatus = getVitalStatusText(
    vitals.heartRateBpm,
    thresholds.heartRate.lowMin,
    thresholds.heartRate.moderateHigh,
    thresholds.heartRate.criticalHigh,
    thresholds.heartRate.criticalLow
  );

  const spo2Status = getSpo2StatusText(
    vitals.oxygenSaturationPct,
    thresholds.oxygenSaturation
  );

  const tempStatus = getVitalStatusText(
    vitals.bodyTempCelsius,
    thresholds.bodyTemp.normalMin,
    thresholds.bodyTemp.normalMax + 0.1,
    thresholds.bodyTemp.highMax,
    thresholds.bodyTemp.lowHypothermia
  );

  return (
    <section aria-labelledby="vitals-heading" className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-2">
        <div>
          <h2 id="vitals-heading" className="text-lg font-semibold text-slate-900">
            Physiological Telemetry
          </h2>
          <p className="text-xs text-slate-500">
            Simulated wearable sensor stream · Evaluated against configurable safety thresholds
          </p>
        </div>
        <div className="text-xs text-slate-500 font-mono">
          <span>Source: {sourceProvider}</span>
          <span className="mx-1.5" aria-hidden="true">·</span>
          <span>Freshness: {freshnessStatus}</span>
          <span className="mx-1.5" aria-hidden="true">·</span>
          <span className="tabular-nums">{history.length} samples buffered</span>
        </div>
      </div>

      {/* 4 Health Monitoring Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {/* 1. Heart Rate */}
        <article className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-xs text-slate-500 mb-2">
              <span>Heart Rate</span>
              <span className="font-mono">SIMULATED · {freshnessStatus}</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold font-mono tabular-nums text-slate-900">
                {vitals.heartRateBpm}
              </span>
              <span className="text-xs font-mono text-slate-500">BPM</span>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100 text-xs space-y-1">
            <div className={hrStatus.colorClass}>{hrStatus.label}</div>
            <div className="text-slate-500 font-mono tabular-nums">
              Nominal: {thresholds.heartRate.lowMin}–{thresholds.heartRate.moderateHigh - 1} BPM · Crit &ge;{thresholds.heartRate.criticalHigh}
            </div>
          </div>
        </article>

        {/* 2. Oxygen Saturation */}
        <article className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-xs text-slate-500 mb-2">
              <span>Oxygen Saturation (SpO2)</span>
              <span>Simulated Data</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold font-mono tabular-nums text-slate-900">
                {vitals.oxygenSaturationPct}
              </span>
              <span className="text-xs font-mono text-slate-500">%</span>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100 text-xs space-y-1">
            <div className={spo2Status.colorClass}>{spo2Status.label}</div>
            <div className="text-slate-500 font-mono tabular-nums">
              Nominal: &ge;{thresholds.oxygenSaturation.normalMin}% · Crit &le;{thresholds.oxygenSaturation.highMin}%
            </div>
          </div>
        </article>

        {/* 3. Body Temperature */}
        <article className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-xs text-slate-500 mb-2">
              <span>Core Body Temperature</span>
              <span>Simulated Data</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold font-mono tabular-nums text-slate-900">
                {vitals.bodyTempCelsius.toFixed(1)}
              </span>
              <span className="text-xs font-mono text-slate-500">°C</span>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100 text-xs space-y-1">
            <div className={tempStatus.colorClass}>{tempStatus.label}</div>
            <div className="text-slate-500 font-mono tabular-nums">
              Nominal: {thresholds.bodyTemp.normalMin.toFixed(1)}–{thresholds.bodyTemp.normalMax.toFixed(1)}°C · Crit &ge;{thresholds.bodyTemp.highMax.toFixed(1)}°C
            </div>
          </div>
        </article>

        {/* 4. Activity Level */}
        <article className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-xs text-slate-500 mb-2">
              <span>Physical Activity Profile</span>
              <span>Simulated Data</span>
            </div>
            <div className="text-xl font-bold text-slate-900 leading-snug">
              {ACTIVITY_LABELS[vitals.activityLevel]}
            </div>
            <div className="text-xs font-mono tabular-nums text-slate-600 mt-1">
              Cadence: {vitals.stepCadencePerMin} steps/min
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100 text-xs space-y-1">
            <div className="text-slate-700 font-medium">
              {vitals.activityLevel === ActivityLevel.INTENSE_EXERTION
                ? 'High Metabolic Load'
                : vitals.activityLevel === ActivityLevel.MODERATE_EXERCISE
                ? 'Active Exertion State'
                : 'Low Metabolic Demand'}
            </div>
            <div className="text-slate-500">
              Modulates compound heat-strain rules
            </div>
          </div>
        </article>
      </div>

      {/* Live Recharts Telemetry Trend Chart */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              Simulated Telemetry Trend (Heart Rate, SpO2 & Risk Score)
            </h3>
            <p className="text-xs text-slate-500">
              Real-time progression across simulation updates and scenario changes
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-600 font-mono">
            <span>HR (BPM)</span>
            <span aria-hidden="true">·</span>
            <span>SpO2 (%)</span>
            <span aria-hidden="true">·</span>
            <span>Risk Score (0–100)</span>
          </div>
        </div>

        {history.length === 0 ? (
          <div className="h-56 flex items-center justify-center text-sm text-slate-500">
            No telemetry points recorded yet. Adjust simulation controls to log readings.
          </div>
        ) : (
          <div className="h-60 w-full min-w-0">
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <LineChart data={history} margin={{ top: 8, right: 16, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                <XAxis
                  dataKey="timeLabel"
                  tick={{ fontSize: 11, fill: '#64748B' }}
                  stroke="#CBD5E1"
                />
                <YAxis
                  tick={{ fontSize: 11, fill: '#64748B' }}
                  stroke="#CBD5E1"
                  domain={[0, 190]}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#FFFFFF',
                    borderColor: '#E2E8F0',
                    borderRadius: '8px',
                    fontSize: '12px',
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="heartRateBpm"
                  name="Heart Rate (BPM)"
                  stroke="#DC2626"
                  strokeWidth={2}
                  dot={{ r: 2.5 }}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="oxygenSaturationPct"
                  name="SpO2 (%)"
                  stroke="#0284C7"
                  strokeWidth={2}
                  dot={{ r: 2.5 }}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="riskScore"
                  name="Risk Score"
                  stroke="#D97706"
                  strokeWidth={2}
                  strokeDasharray="4 4"
                  dot={{ r: 2 }}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </section>
  );
};
