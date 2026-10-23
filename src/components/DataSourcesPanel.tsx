import React, { useState } from 'react';
import {
  Activity,
  CloudSun,
  Database,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  Unplug,
} from 'lucide-react';
import {
  DataQualityState,
  DataSourceMode,
  EnvironmentReadings,
  IngestionBatchResult,
  NormalizedObservation,
  ObservationMetricType,
  ProviderHealthDiagnostics,
  VitalReadings,
} from '../types/safety';

interface DataSourcesPanelProps {
  diagnostics: ProviderHealthDiagnostics[];
  observations: NormalizedObservation[];
  dataQualityByMetric: Partial<Record<ObservationMetricType, DataQualityState>>;
  overallDataQuality: DataQualityState;
  lastBatchResult: IngestionBatchResult | null;
  coarseLocationConsent: boolean;
  wearableConsent: boolean;
  coarseCityLabel: string;
  isSyncingProviderId: string | null;
  onToggleCoarseLocationConsent: (granted: boolean) => void;
  onToggleWearableConsent: (granted: boolean) => void;
  onChangeCoarseCity: (cityLabel: string, lat: number, lon: number) => void;
  onConnectProvider: (providerId: string) => void;
  onSyncProvider: (providerId: string) => void;
  onDisconnectProvider: (providerId: string) => void;
  onRevokeProvider: (providerId: string) => void;
  onResetSimulationProvider: () => void;
  onInjectUnitConversionSample: () => void;
  vitals: VitalReadings;
  environment: EnvironmentReadings;
}

const COARSE_CITY_PRESETS: Array<{
  label: string;
  latitude: number;
  longitude: number;
}> = [
  { label: 'San Francisco, US (37.77, -122.42)', latitude: 37.77, longitude: -122.42 },
  { label: 'Phoenix, US (33.45, -112.07)', latitude: 33.45, longitude: -112.07 },
  { label: 'Miami, US (25.76, -80.19)', latitude: 25.76, longitude: -80.19 },
  { label: 'London, UK (51.51, -0.13)', latitude: 51.51, longitude: -0.13 },
];

const METRIC_LABELS: Record<ObservationMetricType, string> = {
  heart_rate: 'Heart Rate',
  oxygen_saturation: 'SpO2 Saturation',
  body_temperature: 'Core Body Temp',
  activity_state: 'Activity State',
  step_cadence: 'Step Cadence',
  ambient_temperature: 'Ambient Temp (Outdoor)',
  relative_humidity: 'Relative Humidity',
  weather_condition: 'Weather Condition',
  wind_speed: 'Wind Speed',
  air_quality_index: 'Air Quality Index',
};

export const DataSourcesPanel: React.FC<DataSourcesPanelProps> = ({
  diagnostics,
  observations,
  dataQualityByMetric,
  overallDataQuality,
  lastBatchResult,
  coarseLocationConsent,
  wearableConsent,
  coarseCityLabel,
  isSyncingProviderId,
  onToggleCoarseLocationConsent,
  onToggleWearableConsent,
  onChangeCoarseCity,
  onConnectProvider,
  onSyncProvider,
  onDisconnectProvider,
  onRevokeProvider,
  onResetSimulationProvider,
  onInjectUnitConversionSample,
}) => {
  const [streamFilter, setStreamFilter] = useState<'ALL' | DataSourceMode>('ALL');

  const filteredObservations = observations.filter((obs) =>
    streamFilter === 'ALL' ? true : obs.dataMode === streamFilter
  );

  const formatTimestamp = (iso?: string) => {
    if (!iso) return 'Never synced';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return 'Invalid timestamp';
    return d.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const getQualityTone = (state: DataQualityState) => {
    switch (state) {
      case 'CURRENT':
        return 'text-emerald-800 bg-emerald-50 border-emerald-200';
      case 'STALE':
        return 'text-amber-800 bg-amber-50 border-amber-200';
      case 'INVALID':
        return 'text-rose-800 bg-rose-50 border-rose-200';
      default:
        return 'text-slate-600 bg-slate-100 border-slate-200';
    }
  };

  return (
    <section
      aria-labelledby="data-sources-heading"
      className="bg-white rounded-xl border border-slate-200/90 shadow-xs overflow-hidden"
    >
      {/* Header */}
      <div className="px-5 py-4 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-slate-700" aria-hidden="true" />
            <h2
              id="data-sources-heading"
              className="text-base font-bold tracking-tight text-slate-900"
            >
              Wearable & Environmental Data Ingestion Pipeline
            </h2>
          </div>
          <p className="text-xs text-slate-600 mt-1">
            Provider-independent observation normalization, strict SIMULATED vs REAL provenance isolation, unit conversion (°F→°C, mph→km/h), and freshness validation.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs">
          <div
            className={`px-3 py-1.5 rounded-lg border font-mono font-semibold ${getQualityTone(
              overallDataQuality
            )}`}
          >
            Pipeline Quality: {overallDataQuality}
          </div>
          <button
            type="button"
            onClick={onInjectUnitConversionSample}
            className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-800 font-semibold hover:bg-slate-50 transition-colors"
          >
            Test Unit Normalization (°F & mph → Canonical)
          </button>
        </div>
      </div>

      <div className="p-5 space-y-6">
        {/* 1. Connected-Source Cards */}
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">
            Registered Data Provider Adapters
          </h3>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {diagnostics.map((prov) => {
              const isSim = prov.category === 'SIMULATION';
              const isWearable = prov.category === 'WEARABLE';
              const isEnv = prov.category === 'ENVIRONMENTAL';
              const isConnected = prov.connectionStatus === 'CONNECTED';
              const isSyncing = isSyncingProviderId === prov.providerId;

              return (
                <div
                  key={prov.providerId}
                  className="rounded-xl border border-slate-200 p-4 flex flex-col justify-between gap-4 bg-slate-50/50"
                >
                  <div className="space-y-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        {isSim && (
                          <Sliders className="w-4 h-4 text-amber-700 shrink-0" />
                        )}
                        {isWearable && (
                          <Activity className="w-4 h-4 text-slate-700 shrink-0" />
                        )}
                        {isEnv && (
                          <CloudSun className="w-4 h-4 text-sky-700 shrink-0" />
                        )}
                        <h4 className="text-sm font-bold text-slate-900">
                          {prov.providerName}
                        </h4>
                      </div>
                    </div>

                    {/* Provenance & Connection Status Row */}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-mono">
                      <span
                        className={
                          prov.dataMode === 'REAL'
                            ? 'text-emerald-800 font-bold'
                            : 'text-amber-800 font-bold'
                        }
                      >
                        Mode: {prov.dataMode}
                      </span>
                      <span className="text-slate-300">·</span>
                      <span className="text-slate-700">
                        Status: <strong>{prov.connectionStatus}</strong>
                      </span>
                      <span className="text-slate-300">·</span>
                      <span className="text-slate-700">
                        Quality: <strong>{prov.dataQualityState}</strong>
                      </span>
                    </div>

                    <p className="text-xs text-slate-600 leading-relaxed">
                      {prov.statusDetail}
                    </p>

                    {prov.sanitizedLastError && (
                      <div
                        role="alert"
                        className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-900"
                      >
                        {prov.sanitizedLastError}
                      </div>
                    )}

                    {/* Consent & Configuration Controls per Provider */}
                    {isWearable && (
                      <div className="pt-1 space-y-1.5 border-t border-slate-200/80 text-xs">
                        <label className="flex items-center gap-2 text-slate-700 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={wearableConsent}
                            onChange={(e) =>
                              onToggleWearableConsent(e.target.checked)
                            }
                            className="rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                          />
                          <span>
                            Grant explicit health-telemetry export consent
                          </span>
                        </label>
                      </div>
                    )}

                    {isEnv && (
                      <div className="pt-1 space-y-2 border-t border-slate-200/80 text-xs">
                        <label className="flex items-center gap-2 text-slate-700 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={coarseLocationConsent}
                            onChange={(e) =>
                              onToggleCoarseLocationConsent(e.target.checked)
                            }
                            className="rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                          />
                          <span>
                            Allow coarse city-level location (2-decimal rounding)
                          </span>
                        </label>
                        <div>
                          <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                            Outdoor Weather Region (Never infers indoor climate):
                          </label>
                          <select
                            aria-label="Outdoor Weather Region"
                            value={coarseCityLabel}
                            onChange={(e) => {
                              const found = COARSE_CITY_PRESETS.find(
                                (c) => c.label === e.target.value
                              );
                              if (found) {
                                onChangeCoarseCity(
                                  found.label,
                                  found.latitude,
                                  found.longitude
                                );
                              }
                            }}
                            className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800"
                          >
                            {COARSE_CITY_PRESETS.map((city) => (
                              <option key={city.label} value={city.label}>
                                {city.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    )}

                    <div className="text-[11px] font-mono text-slate-500 pt-1">
                      Last Sync: {formatTimestamp(prov.lastSuccessfulSyncAt)}
                    </div>
                  </div>

                  {/* Provider Action Buttons */}
                  <div className="pt-3 border-t border-slate-200 flex flex-wrap items-center gap-2">
                    {!isConnected ? (
                      <button
                        type="button"
                        onClick={() => onConnectProvider(prov.providerId)}
                        className="px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 transition-colors"
                      >
                        Connect Provider
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          disabled={isSyncing}
                          onClick={() => onSyncProvider(prov.providerId)}
                          className="px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 disabled:opacity-50 transition-colors inline-flex items-center gap-1.5"
                        >
                          <RefreshCw
                            className={`w-3.5 h-3.5 ${
                              isSyncing ? 'animate-spin' : ''
                            }`}
                            aria-hidden="true"
                          />
                          <span>{isSyncing ? 'Syncing...' : 'Sync Readings'}</span>
                        </button>

                        {!isSim && (
                          <>
                            <button
                              type="button"
                              onClick={() => onDisconnectProvider(prov.providerId)}
                              className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 text-xs font-medium hover:bg-slate-100 transition-colors inline-flex items-center gap-1"
                            >
                              <Unplug className="w-3 h-3" aria-hidden="true" />
                              <span>Disconnect</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => onRevokeProvider(prov.providerId)}
                              className="px-2.5 py-1.5 rounded-lg border border-rose-200 bg-rose-50 text-rose-800 text-xs font-medium hover:bg-rose-100 transition-colors"
                            >
                              Revoke Access
                            </button>
                          </>
                        )}

                        {isSim && (
                          <button
                            type="button"
                            onClick={onResetSimulationProvider}
                            className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 text-xs font-medium hover:bg-slate-100 transition-colors"
                          >
                            Reset Simulation
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 2. Per-Metric Freshness & Data Quality Grid */}
        <div className="rounded-xl border border-slate-200 p-4 bg-white">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Telemetry Freshness & Data-Quality Matrix
            </h3>
            <span className="text-xs text-slate-500">
              Stale or missing metrics are surfaced in uncertainties and never trigger false emergency alerts.
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
            {(Object.keys(METRIC_LABELS) as ObservationMetricType[]).map(
              (metric) => {
                const quality = dataQualityByMetric[metric] || 'MISSING';
                return (
                  <div
                    key={metric}
                    className={`p-2.5 rounded-lg border text-xs flex flex-col justify-between gap-1 ${getQualityTone(
                      quality
                    )}`}
                  >
                    <span className="font-medium truncate">
                      {METRIC_LABELS[metric]}
                    </span>
                    <span className="font-mono font-bold text-[11px]">
                      {quality}
                    </span>
                  </div>
                );
              }
            )}
          </div>
        </div>

        {/* 3. Normalized Observation Stream & Provenance Isolation Table */}
        <div className="rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                Normalized Observation Ledger ({filteredObservations.length})
              </h3>
              <p className="text-[11px] text-slate-500">
                SIMULATED and REAL observations are strictly isolated; client flags cannot override server provenance.
              </p>
            </div>

            {/* Interactive Stream Filter */}
            <div
              role="group"
              aria-label="Filter observations by provenance"
              className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5 text-xs"
            >
              {(['ALL', 'SIMULATED', 'REAL'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setStreamFilter(mode)}
                  className={`px-3 py-1 rounded-md font-semibold transition-colors ${
                    streamFilter === mode
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>

          {lastBatchResult && lastBatchResult.rejected.length > 0 && (
            <div className="px-4 py-2.5 bg-amber-50 border-b border-amber-200 text-xs text-amber-950">
              <strong>Last Ingestion Validation Notice:</strong>{' '}
              {lastBatchResult.rejected
                .map((r) => `${r.validationStatus} (${r.sanitizedReason})`)
                .join(' · ')}
            </div>
          )}

          <div className="overflow-x-auto max-h-64 overflow-y-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  <th className="py-2.5 px-3">Provenance</th>
                  <th className="py-2.5 px-3">Metric</th>
                  <th className="py-2.5 px-3">Normalized Value</th>
                  <th className="py-2.5 px-3">Source Provider</th>
                  <th className="py-2.5 px-3">Freshness / Validation</th>
                  <th className="py-2.5 px-3">Observed At</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {filteredObservations.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="py-6 text-center text-slate-500 text-xs"
                    >
                      No normalized observations recorded in {streamFilter} view. Click "Sync Readings" on a provider card above.
                    </td>
                  </tr>
                ) : (
                  filteredObservations.slice(0, 15).map((obs) => (
                    <tr key={obs.observationId} className="hover:bg-slate-50/80">
                      <td className="py-2 px-3 font-mono font-bold">
                        {obs.dataMode === 'REAL' ? (
                          <span className="inline-flex items-center gap-1 text-emerald-800">
                            <ShieldCheck className="w-3.5 h-3.5" />
                            REAL
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-amber-800">
                            <ShieldAlert className="w-3.5 h-3.5" />
                            SIMULATED
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-3 font-medium text-slate-900">
                        {METRIC_LABELS[obs.metricType] || obs.metricType}
                        {obs.isOutdoorContext ? (
                          <span className="ml-1.5 text-[11px] text-sky-700 font-normal">
                            (Outdoor)
                          </span>
                        ) : null}
                      </td>
                      <td className="py-2 px-3 font-mono text-slate-900">
                        {String(obs.value)} {obs.unit}
                        {obs.originalUnit && obs.originalUnit !== obs.unit ? (
                          <span className="ml-1.5 text-[11px] text-slate-500">
                            (from {obs.originalUnit})
                          </span>
                        ) : null}
                      </td>
                      <td className="py-2 px-3 font-mono text-slate-600">
                        {obs.sourceProvider}
                      </td>
                      <td className="py-2 px-3 font-mono">
                        <span className="font-semibold text-slate-800">
                          {obs.freshnessStatus}
                        </span>{' '}
                        ·{' '}
                        <span className="text-slate-500">
                          {obs.validationStatus}
                        </span>
                      </td>
                      <td className="py-2 px-3 font-mono text-slate-500">
                        {formatTimestamp(obs.observedAt)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* 4. Honest Integration Verification Matrix */}
        <div className="rounded-xl border border-slate-200 p-4 bg-slate-50/60">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600 mb-2">
            Integration Verification & Availability Disclosure
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
            <div className="p-3 rounded-lg bg-white border border-slate-200">
              <div className="font-bold text-slate-900">
                SimulationDataProvider
              </div>
              <div className="font-mono text-[11px] text-emerald-800 mt-0.5">
                IMPLEMENTED & TESTED
              </div>
              <p className="text-slate-600 mt-1">
                Generates deterministic synthetic scenarios. Strictly labelled SIMULATED; never produces REAL provenance.
              </p>
            </div>
            <div className="p-3 rounded-lg bg-white border border-slate-200">
              <div className="font-bold text-slate-900">
                EnvironmentalDataProvider (Open-Meteo)
              </div>
              <div className="font-mono text-[11px] text-emerald-800 mt-0.5">
                IMPLEMENTED & TESTED (SERVER PROXY)
              </div>
              <p className="text-slate-600 mt-1">
                Queries Open-Meteo via Express backend with 2-decimal coarse coordinates and explicit outdoor-context labeling.
              </p>
            </div>
            <div className="p-3 rounded-lg bg-white border border-slate-200">
              <div className="font-bold text-slate-900">
                WearableDataProvider (OAuth / Export)
              </div>
              <div className="font-mono text-[11px] text-amber-800 mt-0.5">
                ADAPTER SCAFFOLD & MOCK VERIFIER
              </div>
              <p className="text-slate-600 mt-1">
                Implements unit normalization (°F→°C), token verification, and revocation. Stays SIMULATED until server OAuth credentials are provisioned.
              </p>
            </div>
            <div className="p-3 rounded-lg bg-white border border-slate-200">
              <div className="font-bold text-slate-900">
                Proprietary Native / Amazon BLE SDKs
              </div>
              <div className="font-mono text-[11px] text-slate-500 mt-0.5">
                UNAVAILABLE IN WEB SANDBOX
              </div>
              <p className="text-slate-600 mt-1">
                Apple HealthKit native iOS and discontinued/private Amazon Halo APIs are not claimed as live browser connections.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
