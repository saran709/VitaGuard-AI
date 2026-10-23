import React from 'react';
import {
  DataQualityState,
  DataSourceMode,
  EnvironmentReadings,
  RiskLevel,
  RiskThresholds,
  WeatherCondition,
} from '../types/safety';

interface EnvironmentCardsProps {
  environment: EnvironmentReadings;
  heatIndexCelsius: number;
  environmentalRisk: RiskLevel;
  thresholds: RiskThresholds;
  sourceProvider?: string;
  observedAtIso?: string;
  dataMode?: DataSourceMode;
  freshnessStatus?: DataQualityState;
}

const WEATHER_LABELS: Record<WeatherCondition, string> = {
  [WeatherCondition.CLEAR]: 'Clear Sky',
  [WeatherCondition.PARTLY_CLOUDY]: 'Partly Cloudy',
  [WeatherCondition.HIGH_HUMIDITY]: 'Humid & Overcast',
  [WeatherCondition.HEATWAVE]: 'Extreme Heatwave',
  [WeatherCondition.HEAVY_RAIN]: 'Heavy Rain & Gusts',
  [WeatherCondition.FREEZING_WIND]: 'Freezing Wind Advisory',
};

const RISK_DESCRIPTION: Record<RiskLevel, { label: string; colorClass: string; guidance: string }> = {
  [RiskLevel.LOW]: {
    label: 'Low Environmental Risk',
    colorClass: 'text-[#065F46] font-semibold',
    guidance: 'Comfortable thermal envelope for normal outdoor or indoor activity.',
  },
  [RiskLevel.MODERATE]: {
    label: 'Moderate Environmental Risk',
    colorClass: 'text-[#92400E] font-semibold',
    guidance: 'Reduced evaporative cooling or damp conditions; monitor hydration.',
  },
  [RiskLevel.HIGH]: {
    label: 'High Environmental Risk',
    colorClass: 'text-[#9A3412] font-semibold',
    guidance: 'Significant thermal or weather stress; limit sustained outdoor exertion.',
  },
  [RiskLevel.CRITICAL]: {
    label: 'Critical Environmental Hazard',
    colorClass: 'text-[#991B1B] font-semibold',
    guidance: 'Extreme thermal exposure hazard; seek climate shelter immediately.',
  },
};

export const EnvironmentCards: React.FC<EnvironmentCardsProps> = ({
  environment,
  heatIndexCelsius,
  environmentalRisk,
  thresholds,
  sourceProvider = 'vitaguard-simulation-sandbox',
  observedAtIso,
  dataMode = 'SIMULATED',
  freshnessStatus = 'CURRENT',
}) => {
  const envSummary = RISK_DESCRIPTION[environmentalRisk];
  const formattedTime = observedAtIso
    ? new Date(observedAtIso).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    : 'Live Simulation';
  const modeLabel = dataMode === 'REAL' ? 'REAL (Outdoor Proxy)' : 'SIMULATED';

  return (
    <section aria-labelledby="environment-heading" className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-2">
        <div>
          <h2 id="environment-heading" className="text-lg font-semibold text-[#0C192C]">
            Environmental Conditions
          </h2>
          <p className="text-xs text-[#5E738B]">
            {dataMode === 'REAL'
              ? 'Regional outdoor weather observation (does not infer indoor microclimate) · Heat index evaluation'
              : 'Simulated micro-climate telemetry · Heat index and exposure risk evaluation'}
          </p>
        </div>
        <div className="text-xs text-[#5E738B] font-mono">
          <span>Source: {sourceProvider}</span>
          <span className="mx-1.5" aria-hidden="true">·</span>
          <span>Observed: {formattedTime}</span>
          <span className="mx-1.5" aria-hidden="true">·</span>
          <span>Freshness: {freshnessStatus}</span>
          <span className="mx-1.5" aria-hidden="true">·</span>
          <span className="tabular-nums">AQI {environment.airQualityIndex}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* 1. Ambient Temperature & Heat Index */}
        <article className="vg-card p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-xs text-[#5E738B] mb-2">
              <span className="font-medium text-[#334760]">Ambient Temperature</span>
              <span className="font-mono text-[11px]">{modeLabel} · {freshnessStatus}</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold font-mono tabular-nums text-[#0C192C]">
                {environment.ambientTempCelsius}
              </span>
              <span className="text-xs font-mono text-[#5E738B]">°C</span>
              <span className="text-xs font-mono tabular-nums text-[#5E738B] ml-2">
                (Heat Index: {heatIndexCelsius.toFixed(1)}°C)
              </span>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-[#E3EAF2] text-xs space-y-1">
            <div className="text-[#0C192C] font-medium">
              Relative Humidity: <span className="font-mono tabular-nums font-semibold">{environment.humidityPct}%</span>
            </div>
            <div className="text-[#5E738B] font-mono tabular-nums">
              Warn &ge;{thresholds.ambientTemp.heatWarn}°C · Crit &ge;{thresholds.ambientTemp.heatCritical}°C or &le;{thresholds.ambientTemp.coldCritical}°C
            </div>
          </div>
        </article>

        {/* 2. Weather Condition & Wind */}
        <article className="vg-card p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-xs text-[#5E738B] mb-2">
              <span className="font-medium text-[#334760]">Weather Conditions</span>
              <span className="font-mono text-[11px]">{modeLabel} · {freshnessStatus}</span>
            </div>
            <div className="text-xl font-bold text-[#0C192C] leading-snug">
              {WEATHER_LABELS[environment.weatherCondition]}
            </div>
            <div className="text-xs font-mono tabular-nums text-[#334760] mt-1">
              Wind: {environment.windSpeedKmh} km/h · AQI: {environment.airQualityIndex}
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-[#E3EAF2] text-xs space-y-1">
            <div className="text-[#0C192C] font-semibold">
              {environment.airQualityIndex > 100
                ? 'Elevated Particulate Load'
                : 'Acceptable Air Quality'}
            </div>
            <div className="text-[#5E738B]">
              Factored into ambient exposure rules
            </div>
          </div>
        </article>

        {/* 3. Environmental Risk Classification */}
        <article className="vg-card p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-xs text-[#5E738B] mb-2">
              <span className="font-medium text-[#334760]">Environmental Risk Rating</span>
              <span className="font-mono text-[11px]">Rule Assessment</span>
            </div>
            <div className={`text-xl font-bold leading-snug ${envSummary.colorClass}`}>
              {envSummary.label}
            </div>
            <p className="text-xs text-[#334760] mt-1.5 leading-relaxed">
              {envSummary.guidance}
            </p>
          </div>
          <div className="mt-4 pt-3 border-t border-[#E3EAF2] text-xs text-[#5E738B] font-mono tabular-nums">
            Effective Thermal Load: {heatIndexCelsius.toFixed(1)}°C
          </div>
        </article>
      </div>
    </section>
  );
};
