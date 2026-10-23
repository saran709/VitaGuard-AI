import React, { useState } from 'react';
import { Play, Pause, RotateCcw, Sliders } from 'lucide-react';
import {
  ActivityLevel,
  EnvironmentReadings,
  RiskLevel,
  SimulationPreset,
  VitalReadings,
  WeatherCondition,
} from '../types/safety';
import { SIMULATION_PRESETS } from '../engine/riskEngine';

interface SimulationPanelProps {
  vitals: VitalReadings;
  environment: EnvironmentReadings;
  activePresetId: string | null;
  autoDriftEnabled: boolean;
  onUpdateVitals: (next: VitalReadings) => void;
  onUpdateEnvironment: (next: EnvironmentReadings) => void;
  onApplyPreset: (preset: SimulationPreset) => void;
  onToggleAutoDrift: () => void;
  onResetNominal: () => void;
}

const SEVERITY_TEXT_STYLES: Record<RiskLevel, string> = {
  [RiskLevel.LOW]: 'text-[#065F46]',
  [RiskLevel.MODERATE]: 'text-[#92400E]',
  [RiskLevel.HIGH]: 'text-[#9A3412]',
  [RiskLevel.CRITICAL]: 'text-[#991B1B]',
};

export const SimulationPanel: React.FC<SimulationPanelProps> = ({
  vitals,
  environment,
  activePresetId,
  autoDriftEnabled,
  onUpdateVitals,
  onUpdateEnvironment,
  onApplyPreset,
  onToggleAutoDrift,
  onResetNominal,
}) => {
  const [validationMessage, setValidationMessage] = useState<string | null>(null);

  const handleVitalChange = <K extends keyof VitalReadings>(
    key: K,
    value: VitalReadings[K]
  ) => {
    setValidationMessage(null);
    const updated = { ...vitals, [key]: value };

    // Synchronize realistic cadence when activity level changes manually
    if (key === 'activityLevel') {
      const act = value as ActivityLevel;
      if (act === ActivityLevel.RESTING) updated.stepCadencePerMin = 0;
      else if (act === ActivityLevel.LIGHT_WALKING) updated.stepCadencePerMin = 75;
      else if (act === ActivityLevel.MODERATE_EXERCISE) updated.stepCadencePerMin = 112;
      else if (act === ActivityLevel.INTENSE_EXERTION) updated.stepCadencePerMin = 142;
    }

    onUpdateVitals(updated);
  };

  const handleEnvChange = <K extends keyof EnvironmentReadings>(
    key: K,
    value: EnvironmentReadings[K]
  ) => {
    setValidationMessage(null);
    onUpdateEnvironment({ ...environment, [key]: value });
  };

  return (
    <section
      aria-labelledby="simulation-panel-heading"
      className="vg-card p-6 space-y-6"
    >
      {/* Header & Controls */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-[#DCE4EE]">
        <div>
          <div className="flex items-center gap-2">
            <Sliders className="w-4 h-4 text-[#155EEF]" aria-hidden="true" />
            <h2 id="simulation-panel-heading" className="text-lg font-semibold text-[#0C192C]">
              Live Telemetry & Environmental Simulator
            </h2>
          </div>
          <p className="text-xs text-[#5E738B] mt-1">
            Adjust physiological sensors and ambient weather conditions in real time to test rule-based risk classification and alert escalation.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={onToggleAutoDrift}
            className={`px-3.5 py-2 text-xs font-semibold rounded-lg border transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
              autoDriftEnabled
                ? 'bg-[#155EEF] text-white border-[#155EEF]'
                : 'vg-btn-secondary'
            }`}
          >
            {autoDriftEnabled ? (
              <>
                <Pause className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Pause Sensor Micro-Drift</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Start Sensor Micro-Drift</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={onResetNominal}
            className="vg-btn-secondary px-3.5 py-2 text-xs inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Reset to Baseline</span>
          </button>
        </div>
      </div>

      {/* Scenario Presets */}
      <div className="space-y-2.5">
        <div className="text-xs font-semibold text-[#334760]">
          Quick Scenario Presets
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
          {SIMULATION_PRESETS.map((preset) => {
            const isSelected = activePresetId === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => onApplyPreset(preset)}
                className={`text-left p-3.5 rounded-lg border transition-colors flex flex-col justify-between ${
                  isSelected
                    ? 'border-[#155EEF] bg-[#EFF5FF]/80 ring-1 ring-[#155EEF]/30'
                    : 'border-[#DCE4EE] hover:border-[#9FB2CA] bg-white hover:bg-[#F7F9FC]'
                }`}
              >
                <div>
                  <div className="text-xs font-bold text-[#0C192C] leading-snug">
                    {preset.name}
                  </div>
                  <p className="text-[11px] text-[#334760] mt-1 line-clamp-2">
                    {preset.subtitle}
                  </p>
                </div>
                <div className="mt-2.5 pt-2 border-t border-[#E3EAF2] flex items-center justify-between text-[11px]">
                  <span className="text-[#5E738B] font-mono">Target:</span>
                  <span className={`font-bold font-mono uppercase ${SEVERITY_TEXT_STYLES[preset.expectedRisk]}`}>
                    {preset.expectedRisk}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {validationMessage && (
        <div
          role="alert"
          className="p-3 rounded-lg bg-[#FFFBEB] border border-[#FDE68A] text-xs text-[#92400E]"
        >
          {validationMessage}
        </div>
      )}

      {/* Sliders Grid: Physiological Inputs vs Environmental Inputs */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 pt-2">
        {/* Left Column: Physiological Controls */}
        <div className="space-y-5">
          <h3 className="text-sm font-semibold text-[#0C192C] pb-2 border-b border-[#E3EAF2]">
            1. Simulated Physiological Inputs
          </h3>

          {/* Heart Rate Slider */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <label htmlFor="sim-hr" className="font-medium text-[#334760]">
                Heart Rate (BPM)
              </label>
              <span className="font-mono tabular-nums font-bold text-[#0C192C]">
                {vitals.heartRateBpm} BPM
              </span>
            </div>
            <input
              id="sim-hr"
              type="range"
              min={35}
              max={200}
              step={1}
              value={vitals.heartRateBpm}
              onChange={(e) => handleVitalChange('heartRateBpm', Number(e.target.value))}
              className="w-full cursor-pointer"
            />
            <div className="flex justify-between text-[11px] text-[#5E738B] font-mono tabular-nums">
              <span>35 BPM (Bradycardia)</span>
              <span>75 BPM (Rest)</span>
              <span>200 BPM (Max)</span>
            </div>
          </div>

          {/* Oxygen Saturation Slider */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <label htmlFor="sim-spo2" className="font-medium text-[#334760]">
                Oxygen Saturation — SpO2 (%)
              </label>
              <span className="font-mono tabular-nums font-bold text-[#0C192C]">
                {vitals.oxygenSaturationPct}%
              </span>
            </div>
            <input
              id="sim-spo2"
              type="range"
              min={80}
              max={100}
              step={1}
              value={vitals.oxygenSaturationPct}
              onChange={(e) => handleVitalChange('oxygenSaturationPct', Number(e.target.value))}
              className="w-full cursor-pointer"
            />
            <div className="flex justify-between text-[11px] text-[#5E738B] font-mono tabular-nums">
              <span>80% (Severe Hypoxia)</span>
              <span>92% (Mod)</span>
              <span>100% (Nominal)</span>
            </div>
          </div>

          {/* Core Body Temperature Slider */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <label htmlFor="sim-body-temp" className="font-medium text-[#334760]">
                Core Body Temperature (°C)
              </label>
              <span className="font-mono tabular-nums font-bold text-[#0C192C]">
                {vitals.bodyTempCelsius.toFixed(1)}°C
              </span>
            </div>
            <input
              id="sim-body-temp"
              type="range"
              min={34.0}
              max={41.0}
              step={0.1}
              value={vitals.bodyTempCelsius}
              onChange={(e) => handleVitalChange('bodyTempCelsius', Number(e.target.value))}
              className="w-full cursor-pointer"
            />
            <div className="flex justify-between text-[11px] text-[#5E738B] font-mono tabular-nums">
              <span>34.0°C (Hypothermia)</span>
              <span>37.0°C (Normal)</span>
              <span>41.0°C (Hyperthermia)</span>
            </div>
          </div>

          {/* Activity Level Selector */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            <div>
              <label htmlFor="sim-activity" className="block text-xs font-medium text-[#334760] mb-1.5">
                Activity State
              </label>
              <select
                id="sim-activity"
                value={vitals.activityLevel}
                onChange={(e) =>
                  handleVitalChange('activityLevel', e.target.value as ActivityLevel)
                }
                className="w-full rounded-lg border border-[#C3D0E0] bg-white px-3 py-2 text-xs text-[#0C192C]"
              >
                <option value={ActivityLevel.RESTING}>Resting / Sedentary</option>
                <option value={ActivityLevel.LIGHT_WALKING}>Light Walking</option>
                <option value={ActivityLevel.MODERATE_EXERCISE}>Moderate Exercise</option>
                <option value={ActivityLevel.INTENSE_EXERTION}>Intense Exertion</option>
              </select>
            </div>

            <div>
              <label htmlFor="sim-cadence" className="block text-xs font-medium text-[#334760] mb-1.5">
                Step Cadence (steps/min)
              </label>
              <input
                id="sim-cadence"
                type="number"
                min={0}
                max={220}
                value={vitals.stepCadencePerMin}
                onChange={(e) => {
                  const val = Math.max(0, Math.min(220, Number(e.target.value) || 0));
                  handleVitalChange('stepCadencePerMin', val);
                }}
                className="w-full rounded-lg border border-[#C3D0E0] bg-white px-3 py-2 text-xs font-mono tabular-nums text-[#0C192C]"
              />
            </div>
          </div>
        </div>

        {/* Right Column: Environmental Controls */}
        <div className="space-y-5">
          <h3 className="text-sm font-semibold text-[#0C192C] pb-2 border-b border-[#E3EAF2]">
            2. Simulated Environmental Inputs
          </h3>

          {/* Ambient Temperature Slider */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <label htmlFor="sim-amb-temp" className="font-medium text-[#334760]">
                Ambient Temperature (°C)
              </label>
              <span className="font-mono tabular-nums font-bold text-[#0C192C]">
                {environment.ambientTempCelsius}°C
              </span>
            </div>
            <input
              id="sim-amb-temp"
              type="range"
              min={-15}
              max={48}
              step={1}
              value={environment.ambientTempCelsius}
              onChange={(e) => handleEnvChange('ambientTempCelsius', Number(e.target.value))}
              className="w-full cursor-pointer"
            />
            <div className="flex justify-between text-[11px] text-[#5E738B] font-mono tabular-nums">
              <span>-15°C (Extreme Cold)</span>
              <span>22°C (Temperate)</span>
              <span>48°C (Extreme Heat)</span>
            </div>
          </div>

          {/* Relative Humidity Slider */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <label htmlFor="sim-humidity" className="font-medium text-[#334760]">
                Relative Humidity (%)
              </label>
              <span className="font-mono tabular-nums font-bold text-[#0C192C]">
                {environment.humidityPct}%
              </span>
            </div>
            <input
              id="sim-humidity"
              type="range"
              min={10}
              max={100}
              step={1}
              value={environment.humidityPct}
              onChange={(e) => handleEnvChange('humidityPct', Number(e.target.value))}
              className="w-full cursor-pointer"
            />
            <div className="flex justify-between text-[11px] text-[#5E738B] font-mono tabular-nums">
              <span>10% (Arid)</span>
              <span>50% (Balanced)</span>
              <span>100% (Saturated)</span>
            </div>
          </div>

          {/* Wind Speed Slider */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <label htmlFor="sim-wind" className="font-medium text-[#334760]">
                Wind Speed (km/h)
              </label>
              <span className="font-mono tabular-nums font-bold text-[#0C192C]">
                {environment.windSpeedKmh} km/h
              </span>
            </div>
            <input
              id="sim-wind"
              type="range"
              min={0}
              max={75}
              step={1}
              value={environment.windSpeedKmh}
              onChange={(e) => handleEnvChange('windSpeedKmh', Number(e.target.value))}
              className="w-full cursor-pointer"
            />
            <div className="flex justify-between text-[11px] text-[#5E738B] font-mono tabular-nums">
              <span>0 km/h (Calm)</span>
              <span>25 km/h (Breezy)</span>
              <span>75 km/h (Gale)</span>
            </div>
          </div>

          {/* Weather Condition & AQI */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            <div>
              <label htmlFor="sim-weather" className="block text-xs font-medium text-[#334760] mb-1.5">
                Weather Condition
              </label>
              <select
                id="sim-weather"
                value={environment.weatherCondition}
                onChange={(e) =>
                  handleEnvChange('weatherCondition', e.target.value as WeatherCondition)
                }
                className="w-full rounded-lg border border-[#C3D0E0] bg-white px-3 py-2 text-xs text-[#0C192C]"
              >
                <option value={WeatherCondition.CLEAR}>Clear Sky</option>
                <option value={WeatherCondition.PARTLY_CLOUDY}>Partly Cloudy</option>
                <option value={WeatherCondition.HIGH_HUMIDITY}>Humid & Overcast</option>
                <option value={WeatherCondition.HEATWAVE}>Extreme Heatwave</option>
                <option value={WeatherCondition.HEAVY_RAIN}>Heavy Rain & Gusts</option>
                <option value={WeatherCondition.FREEZING_WIND}>Freezing Wind Advisory</option>
              </select>
            </div>

            <div>
              <label htmlFor="sim-aqi" className="block text-xs font-medium text-[#334760] mb-1.5">
                Air Quality Index (AQI)
              </label>
              <input
                id="sim-aqi"
                type="number"
                min={5}
                max={300}
                value={environment.airQualityIndex}
                onChange={(e) => {
                  const val = Math.max(5, Math.min(300, Number(e.target.value) || 5));
                  handleEnvChange('airQualityIndex', val);
                }}
                className="w-full rounded-lg border border-[#C3D0E0] bg-white px-3 py-2 text-xs font-mono tabular-nums text-[#0C192C]"
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
