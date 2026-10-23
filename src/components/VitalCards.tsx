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
    return { label: 'Critical Range', colorClass: 'text-[#991B1B] font-semibold' };
  }
  if (value < lowWarn || value >= highWarn) {
    return { label: 'Elevated Deviation', colorClass: 'text-[#92400E] font-semibold' };
  }
  return { label: 'Within Nominal Bounds', colorClass: 'text-[#065F46] font-semibold' };
}

function getSpo2StatusText(
  spo2: number,
  thresholds: RiskThresholds['oxygenSaturation']
): { label: string; colorClass: string } {
  if (spo2 <= thresholds.highMin) {
    return { label: 'Critical Desaturation', colorClass: 'text-[#991B1B] font-semibold' };
  }
  if (spo2 < thresholds.moderateMin) {
    return { label: 'High Risk Desaturation', colorClass: 'text-[#9A3412] font-semibold' };
  }
  if (spo2 < thresholds.normalMin) {
    return { label: 'Borderline Saturation', colorClass: 'text-[#92400E] font-semibold' };
  }
  return { label: 'Optimal Saturation', colorClass: 'text-[#065F46] font-semibold' };
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
          <h2 id="vitals-heading" className="text-lg font-semibold text-[#0C192C]">
            Physiological Telemetry
          </h2>
          <p className="text-xs text-[#5E738B]">
            Simulated wearable sensor stream · Evaluated against configurable safety thresholds
          </p>
        </div>
        <div className="text-xs text-[#5E738B] font-mono">
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
        <article className="vg-card p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-xs text-[#5E738B] mb-2">
              <span className="font-medium text-[#334760]">Heart Rate</span>
              <span className="font-mono text-[11px]">SIMULATED · {freshnessStatus}</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold font-mono tabular-nums text-[#0C192C]">
                {vitals.heartRateBpm}
              </span>
              <span className="text-xs font-mono text-[#5E738B]">BPM</span>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-[#E3EAF2] text-xs space-y-1">
            <div className={hrStatus.colorClass}>{hrStatus.label}</div>
            <div className="text-[#5E738B] font-mono tabular-nums">
              Nominal: {thresholds.heartRate.lowMin}–{thresholds.heartRate.moderateHigh - 1} BPM · Crit &ge;{thresholds.heartRate.criticalHigh}
            </div>
          </div>
        </article>

        {/* 2. Oxygen Saturation */}
        <article className="vg-card p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-xs text-[#5E738B] mb-2">
              <span className="font-medium text-[#334760]">Oxygen Saturation (SpO2)</span>
              <span className="font-mono text-[11px]">Simulated Data</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold font-mono tabular-nums text-[#0C192C]">
                {vitals.oxygenSaturationPct}
              </span>
              <span className="text-xs font-mono text-[#5E738B]">%</span>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-[#E3EAF2] text-xs space-y-1">
            <div className={spo2Status.colorClass}>{spo2Status.label}</div>
            <div className="text-[#5E738B] font-mono tabular-nums">
              Nominal: &ge;{thresholds.oxygenSaturation.normalMin}% · Crit &le;{thresholds.oxygenSaturation.highMin}%
            </div>
          </div>
        </article>

        {/* 3. Body Temperature */}
        <article className="vg-card p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-xs text-[#5E738B] mb-2">
              <span className="font-medium text-[#334760]">Core Body Temperature</span>
              <span className="font-mono text-[11px]">Simulated Data</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold font-mono tabular-nums text-[#0C192C]">
                {vitals.bodyTempCelsius.toFixed(1)}
              </span>
              <span className="text-xs font-mono text-[#5E738B]">°C</span>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-[#E3EAF2] text-xs space-y-1">
            <div className={tempStatus.colorClass}>{tempStatus.label}</div>
            <div className="text-[#5E738B] font-mono tabular-nums">
              Nominal: {thresholds.bodyTemp.normalMin.toFixed(1)}–{thresholds.bodyTemp.normalMax.toFixed(1)}°C · Crit &ge;{thresholds.bodyTemp.highMax.toFixed(1)}°C
            </div>
          </div>
        </article>

        {/* 4. Activity Level */}
        <article className="vg-card p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-xs text-[#5E738B] mb-2">
              <span className="font-medium text-[#334760]">Physical Activity Profile</span>
              <span className="font-mono text-[11px]">Simulated Data</span>
            </div>
            <div className="text-xl font-bold text-[#0C192C] leading-snug">
              {ACTIVITY_LABELS[vitals.activityLevel]}
            </div>
            <div className="text-xs font-mono tabular-nums text-[#334760] mt-1">
              Cadence: {vitals.stepCadencePerMin} steps/min
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-[#E3EAF2] text-xs space-y-1">
            <div className="text-[#0C192C] font-semibold">
              {vitals.activityLevel === ActivityLevel.INTENSE_EXERTION
                ? 'High Metabolic Load'
                : vitals.activityLevel === ActivityLevel.MODERATE_EXERCISE
                ? 'Active Exertion State'
                : 'Low Metabolic Demand'}
            </div>
            <div className="text-[#5E738B]">
              Modulates compound heat-strain rules
            </div>
          </div>
        </article>
      </div>

      {/* Live Recharts Telemetry Trend Chart */}
      <div className="vg-card p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
          <div>
            <h3 className="text-sm font-semibold text-[#0C192C]">
              Simulated Telemetry Trend (Heart Rate, SpO2 & Risk Score)
            </h3>
            <p className="text-xs text-[#5E738B]">
              Real-time progression across simulation updates and scenario changes
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs text-[#334760] font-mono">
            <span className="text-[#E11D48] font-semibold">HR (BPM)</span>
            <span aria-hidden="true">·</span>
            <span className="text-[#155EEF] font-semibold">SpO2 (%)</span>
            <span aria-hidden="true">·</span>
            <span className="text-[#D97706] font-semibold">Risk Score (0–100)</span>
          </div>
        </div>

        {history.length === 0 ? (
          <div className="h-56 flex items-center justify-center text-sm text-[#5E738B]">
            No telemetry points recorded yet. Adjust simulation controls to log readings.
          </div>
        ) : (
          <div className="h-60 w-full min-w-0">
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <LineChart data={history} margin={{ top: 8, right: 16, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E3EAF2" />
                <XAxis
                  dataKey="timeLabel"
                  tick={{ fontSize: 11, fill: '#5E738B' }}
                  stroke="#DCE4EE"
                />
                <YAxis
                  tick={{ fontSize: 11, fill: '#5E738B' }}
                  stroke="#DCE4EE"
                  domain={[0, 190]}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#FFFFFF',
                    borderColor: '#DCE4EE',
                    borderRadius: '8px',
                    fontSize: '12px',
                    color: '#0C192C',
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="heartRateBpm"
                  name="Heart Rate (BPM)"
                  stroke="#E11D48"
                  strokeWidth={2}
                  dot={{ r: 2.5, fill: '#E11D48' }}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="oxygenSaturationPct"
                  name="SpO2 (%)"
                  stroke="#155EEF"
                  strokeWidth={2}
                  dot={{ r: 2.5, fill: '#155EEF' }}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="riskScore"
                  name="Risk Score"
                  stroke="#D97706"
                  strokeWidth={2}
                  strokeDasharray="4 4"
                  dot={{ r: 2, fill: '#D97706' }}
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
