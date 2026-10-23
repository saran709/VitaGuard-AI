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
        return 'text-[#065F46] bg-[#ECFDF5] border-[#A7F3D0]';
      case 'STALE':
        return 'text-[#92400E] bg-[#FFFBEB] border-[#FDE68A]';
      case 'INVALID':
        return 'text-[#991B1B] bg-[#FEF2F2] border-[#FECACA]';
      default:
        return 'text-[#334760] bg-[#F7F9FC] border-[#DCE4EE]';
    }
  };

  return (
    <section
      aria-labelledby="data-sources-heading"
      className="vg-card overflow-hidden"
    >
      {/* Header */}
      <div className="px-5 py-4 border-b border-[#DCE4EE] flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-[#155EEF]" aria-hidden="true" />
            <h2
              id="data-sources-heading"
              className="text-base font-bold tracking-tight text-[#0C192C]"
            >
              Wearable & Environmental Data Ingestion Pipeline
            </h2>
          </div>
          <p className="text-xs text-[#5E738B] mt-1">
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
            className="vg-btn-secondary px-3 py-1.5 text-xs"
          >
            Test Unit Normalization (°F & mph → Canonical)
          </button>
        </div>
      </div>

      <div className="p-5 space-y-6">
        {/* 1. Connected-Source Cards */}
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-[#5E738B] mb-3">
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
                  className="vg-well p-4 flex flex-col justify-between gap-4"
                >
                  <div className="space-y-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        {isSim && (
                          <Sliders className="w-4 h-4 text-[#D97706] shrink-0" />
                        )}
                        {isWearable && (
                          <Activity className="w-4 h-4 text-[#155EEF] shrink-0" />
                        )}
                        {isEnv && (
                          <CloudSun className="w-4 h-4 text-[#0284C7] shrink-0" />
                        )}
                        <h4 className="text-sm font-bold text-[#0C192C]">
                          {prov.providerName}
                        </h4>
                      </div>
                    </div>

                    {/* Provenance & Connection Status Row */}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-mono">
                      <span
                        className={
                          prov.dataMode === 'REAL'
                            ? 'text-[#065F46] font-bold'
                            : 'text-[#92400E] font-bold'
                        }
                      >
                        Mode: {prov.dataMode}
                      </span>
                      <span className="text-[#C3D0E0]">·</span>
                      <span className="text-[#334760]">
                        Status: <strong className="text-[#0C192C]">{prov.connectionStatus}</strong>
                      </span>
                      <span className="text-[#C3D0E0]">·</span>
                      <span className="text-[#334760]">
                        Quality: <strong className="text-[#0C192C]">{prov.dataQualityState}</strong>
                      </span>
                    </div>

                    <p className="text-xs text-[#334760] leading-relaxed">
                      {prov.statusDetail}
                    </p>

                    {prov.sanitizedLastError && (
                      <div
                        role="alert"
                        className="p-2.5 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-xs text-[#991B1B]"
                      >
                        {prov.sanitizedLastError}
                      </div>
                    )}

                    {/* Consent & Configuration Controls per Provider */}
                    {isWearable && (
                      <div className="pt-1 space-y-1.5 border-t border-[#E3EAF2] text-xs">
                        <label className="flex items-center gap-2 text-[#334760] cursor-pointer">
                          <input
                            type="checkbox"
                            checked={wearableConsent}
                            onChange={(e) =>
                              onToggleWearableConsent(e.target.checked)
                            }
                            className="rounded border-[#C3D0E0]"
                          />
                          <span>
                            Grant explicit health-telemetry export consent
                          </span>
                        </label>
                      </div>
                    )}

                    {isEnv && (
                      <div className="pt-1 space-y-2 border-t border-[#E3EAF2] text-xs">
                        <label className="flex items-center gap-2 text-[#334760] cursor-pointer">
                          <input
                            type="checkbox"
                            checked={coarseLocationConsent}
                            onChange={(e) =>
                              onToggleCoarseLocationConsent(e.target.checked)
                            }
                            className="rounded border-[#C3D0E0]"
                          />
                          <span>
                            Allow coarse city-level location (2-decimal rounding)
                          </span>
                        </label>
                        <div>
                          <label className="block text-[11px] font-semibold text-[#334760] mb-1">
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
                            className="w-full rounded-lg border border-[#C3D0E0] bg-white px-2.5 py-1.5 text-xs text-[#0C192C]"
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

                    <div className="text-[11px] font-mono text-[#5E738B] pt-1">
                      Last Sync: {formatTimestamp(prov.lastSuccessfulSyncAt)}
                    </div>
                  </div>

                  {/* Provider Action Buttons */}
                  <div className="pt-3 border-t border-[#E3EAF2] flex flex-wrap items-center gap-2">
                    {!isConnected ? (
                      <button
                        type="button"
                        onClick={() => onConnectProvider(prov.providerId)}
                        className="vg-btn-primary px-3 py-1.5 text-xs"
                      >
                        Connect Provider
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          disabled={isSyncing}
                          onClick={() => onSyncProvider(prov.providerId)}
                          className="vg-btn-primary px-3 py-1.5 text-xs disabled:opacity-50 inline-flex items-center gap-1.5"
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
                              className="vg-btn-secondary px-2.5 py-1.5 text-xs inline-flex items-center gap-1"
                            >
                              <Unplug className="w-3 h-3" aria-hidden="true" />
                              <span>Disconnect</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => onRevokeProvider(prov.providerId)}
                              className="px-2.5 py-1.5 rounded-lg border border-[#FECACA] bg-[#FEF2F2] text-[#991B1B] text-xs font-semibold hover:bg-[#FEE2E2] transition-colors"
                            >
                              Revoke Access
                            </button>
                          </>
                        )}

                        {isSim && (
                          <button
                            type="button"
                            onClick={onResetSimulationProvider}
                            className="vg-btn-secondary px-2.5 py-1.5 text-xs"
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
        <div className="rounded-xl border border-[#DCE4EE] p-4 bg-white">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#5E738B]">
              Telemetry Freshness & Data-Quality Matrix
            </h3>
            <span className="text-xs text-[#5E738B]">
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
        <div className="rounded-xl border border-[#DCE4EE] overflow-hidden">
          <div className="px-4 py-3 bg-[#F7F9FC] border-b border-[#DCE4EE] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#0C192C]">
                Normalized Observation Ledger ({filteredObservations.length})
              </h3>
              <p className="text-[11px] text-[#5E738B]">
                SIMULATED and REAL observations are strictly isolated; client flags cannot override server provenance.
              </p>
            </div>

            {/* Interactive Stream Filter */}
            <div
              role="group"
              aria-label="Filter observations by provenance"
              className="inline-flex rounded-lg border border-[#C3D0E0] bg-white p-0.5 text-xs"
            >
              {(['ALL', 'SIMULATED', 'REAL'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setStreamFilter(mode)}
                  className={`px-3 py-1 rounded-md font-semibold transition-colors ${
                    streamFilter === mode
                      ? 'bg-[#155EEF] text-white'
                      : 'text-[#334760] hover:text-[#0C192C]'
                  }`}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>

          {lastBatchResult && lastBatchResult.rejected.length > 0 && (
            <div className="px-4 py-2.5 bg-[#FFFBEB] border-b border-[#FDE68A] text-xs text-[#92400E]">
              <strong>Last Ingestion Validation Notice:</strong>{' '}
              {lastBatchResult.rejected
                .map((r) => `${r.validationStatus} (${r.sanitizedReason})`)
                .join(' · ')}
            </div>
          )}

          <div className="overflow-x-auto max-h-64 overflow-y-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="vg-table-header">
                  <th className="py-2.5 px-3">Provenance</th>
                  <th className="py-2.5 px-3">Metric</th>
                  <th className="py-2.5 px-3">Normalized Value</th>
                  <th className="py-2.5 px-3">Source Provider</th>
                  <th className="py-2.5 px-3">Freshness / Validation</th>
                  <th className="py-2.5 px-3">Observed At</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E3EAF2]">
                {filteredObservations.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="py-6 text-center text-[#5E738B] text-xs"
                    >
                      No normalized observations recorded in {streamFilter} view. Click "Sync Readings" on a provider card above.
                    </td>
                  </tr>
                ) : (
                  filteredObservations.slice(0, 15).map((obs) => (
                    <tr key={obs.observationId} className="hover:bg-[#F7F9FC]">
                      <td className="py-2 px-3 font-mono font-bold">
                        {obs.dataMode === 'REAL' ? (
                          <span className="inline-flex items-center gap-1 text-[#065F46]">
                            <ShieldCheck className="w-3.5 h-3.5" />
                            REAL
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[#92400E]">
                            <ShieldAlert className="w-3.5 h-3.5" />
                            SIMULATED
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-3 font-medium text-[#0C192C]">
                        {METRIC_LABELS[obs.metricType] || obs.metricType}
                        {obs.isOutdoorContext ? (
                          <span className="ml-1.5 text-[11px] text-[#0369A1] font-normal">
                            (Outdoor)
                          </span>
                        ) : null}
                      </td>
                      <td className="py-2 px-3 font-mono text-[#0C192C]">
                        {String(obs.value)} {obs.unit}
                        {obs.originalUnit && obs.originalUnit !== obs.unit ? (
                          <span className="ml-1.5 text-[11px] text-[#5E738B]">
                            (from {obs.originalUnit})
                          </span>
                        ) : null}
                      </td>
                      <td className="py-2 px-3 font-mono text-[#334760]">
                        {obs.sourceProvider}
                      </td>
                      <td className="py-2 px-3 font-mono">
                        <span className="font-semibold text-[#0C192C]">
                          {obs.freshnessStatus}
                        </span>{' '}
                        ·{' '}
                        <span className="text-[#5E738B]">
                          {obs.validationStatus}
                        </span>
                      </td>
                      <td className="py-2 px-3 font-mono text-[#5E738B]">
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
        <div className="vg-well p-4">
          <h3 className="text-xs font-bold uppercase tracking-wider text-[#5E738B] mb-2.5">
            Integration Verification & Availability Disclosure
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
            <div className="p-3 rounded-lg bg-white border border-[#DCE4EE]">
              <div className="font-bold text-[#0C192C]">
                SimulationDataProvider
              </div>
              <div className="font-mono text-[11px] text-[#065F46] font-semibold mt-0.5">
                IMPLEMENTED & TESTED
              </div>
              <p className="text-[#334760] mt-1">
                Generates deterministic synthetic scenarios. Strictly labelled SIMULATED; never produces REAL provenance.
              </p>
            </div>
            <div className="p-3 rounded-lg bg-white border border-[#DCE4EE]">
              <div className="font-bold text-[#0C192C]">
                EnvironmentalDataProvider (Open-Meteo)
              </div>
              <div className="font-mono text-[11px] text-[#065F46] font-semibold mt-0.5">
                IMPLEMENTED & TESTED (SERVER PROXY)
              </div>
              <p className="text-[#334760] mt-1">
                Queries Open-Meteo via Express backend with 2-decimal coarse coordinates and explicit outdoor-context labeling.
              </p>
            </div>
            <div className="p-3 rounded-lg bg-white border border-[#DCE4EE]">
              <div className="font-bold text-[#0C192C]">
                WearableDataProvider (OAuth / Export)
              </div>
              <div className="font-mono text-[11px] text-[#92400E] font-semibold mt-0.5">
                ADAPTER SCAFFOLD & MOCK VERIFIER
              </div>
              <p className="text-[#334760] mt-1">
                Implements unit normalization (°F→°C), token verification, and revocation. Stays SIMULATED until server OAuth credentials are provisioned.
              </p>
            </div>
            <div className="p-3 rounded-lg bg-white border border-[#DCE4EE]">
              <div className="font-bold text-[#0C192C]">
                Proprietary Native / Amazon BLE SDKs
              </div>
              <div className="font-mono text-[11px] text-[#5E738B] font-semibold mt-0.5">
                UNAVAILABLE IN WEB SANDBOX
              </div>
              <p className="text-[#334760] mt-1">
                Apple HealthKit native iOS and discontinued/private Amazon Halo APIs are not claimed as live browser connections.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
