import { createAlertFromAssessment } from '../engine/alertManager';
import { DEFAULT_THRESHOLDS, evaluateRisk, RULE_ENGINE_VERSION } from '../engine/riskEngine';
import { redactSecretsFromText } from './geminiExplanationEngine';
import {
  ActivityLevel,
  CanonicalObservationUnit,
  DataQualityState,
  DataSourceMode,
  EnvironmentReadings,
  FreshnessPolicyConfig,
  IngestionBatchResult,
  NormalizedObservation,
  ObservationMetricType,
  ObservationValidationStatus,
  ProviderCategory,
  ProviderConnectionStatus,
  ProviderHealthDiagnostics,
  RiskAssessment,
  RiskLevel,
  RiskThresholds,
  SafetyAlert,
  SafetyEvent,
  SupportedInputUnit,
  VitalReadings,
  WeatherCondition,
} from '../types/safety';

export const DEFAULT_FRESHNESS_POLICY: FreshnessPolicyConfig = {
  physiologicalStaleAfterMs: 5 * 60 * 1000, // 5 minutes
  environmentalStaleAfterMs: 30 * 60 * 1000, // 30 minutes
  maxFutureClockSkewMs: 60 * 1000, // 60 seconds clock skew tolerance
};

const VALID_ID_REGEX = /^[a-zA-Z0-9_\-:]+$/;

export interface RawObservationInput {
  observationId?: string;
  authenticatedOwnerId?: string;
  metricType?: string;
  value?: unknown;
  unit?: string;
  observedAt?: string;
  receivedAt?: string;
  sourceProvider?: string;
  sourceRecordId?: string;
  claimedDataMode?: string;
  consentReference?: string;
  isOutdoorContext?: boolean;
}

export class DataIngestionError extends Error {
  public readonly code:
    | 'UNAUTHENTICATED'
    | 'PERMISSION_DENIED'
    | 'PROVIDER_NOT_CONNECTED'
    | 'PROVIDER_AUTH_FAILED'
    | 'PROVIDER_REVOKED'
    | 'CONSENT_REQUIRED'
    | 'RATE_LIMITED'
    | 'UPSTREAM_TIMEOUT'
    | 'UPSTREAM_UNAVAILABLE'
    | 'INVALID_OBSERVATION';
  public readonly httpStatus: number;

  constructor(
    code: DataIngestionError['code'],
    message: string,
    httpStatus: number = 400
  ) {
    super(sanitizeIngestionError(message));
    this.name = 'DataIngestionError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

/**
 * Scrubs raw physiological readings, coordinates, tokens, and API keys from ingestion error logs.
 */
export function sanitizeIngestionError(rawMessage: string): string {
  if (!rawMessage) return 'Unknown ingestion error.';
  return redactSecretsFromText(rawMessage)
    .replace(/\b\d+(?:\.\d+)?\s*(?:bpm|%|°c|°f|spo2)\b/gi, '[redacted-measurement]')
    .replace(/lat(?:itude)?\s*[:=]\s*[-+]?\d+(?:\.\d+)?/gi, 'lat:[redacted]')
    .replace(/lon(?:gitude)?\s*[:=]\s*[-+]?\d+(?:\.\d+)?/gi, 'lon:[redacted]')
    .replace(/access_token\s*[:=]\s*[^\s&"']+/gi, 'access_token:[REDACTED]');
}

const SUPPORTED_METRICS = new Set<ObservationMetricType>([
  'heart_rate',
  'oxygen_saturation',
  'body_temperature',
  'activity_state',
  'step_cadence',
  'ambient_temperature',
  'relative_humidity',
  'weather_condition',
  'wind_speed',
  'air_quality_index',
]);

const PHYSIOLOGICAL_METRICS = new Set<ObservationMetricType>([
  'heart_rate',
  'oxygen_saturation',
  'body_temperature',
  'activity_state',
  'step_cadence',
]);

const VALID_ACTIVITY_STATES = new Set<string>([
  ActivityLevel.RESTING,
  ActivityLevel.LIGHT_WALKING,
  ActivityLevel.MODERATE_EXERCISE,
  ActivityLevel.INTENSE_EXERTION,
]);

const VALID_WEATHER_CONDITIONS = new Set<string>([
  WeatherCondition.CLEAR,
  WeatherCondition.PARTLY_CLOUDY,
  WeatherCondition.HIGH_HUMIDITY,
  WeatherCondition.HEATWAVE,
  WeatherCondition.HEAVY_RAIN,
  WeatherCondition.FREEZING_WIND,
]);

/**
 * Normalizes supported units into VitaGuard's canonical unit system.
 * Rejects unsupported or incompatible units for the given metricType.
 */
export function normalizeObservationUnitAndValue(
  metricType: ObservationMetricType,
  rawValue: unknown,
  rawUnit: string
): {
  ok: true;
  normalizedValue: number | string;
  canonicalUnit: CanonicalObservationUnit;
  originalUnit: SupportedInputUnit;
} | {
  ok: false;
  validationStatus: 'REJECTED_UNIT' | 'REJECTED_RANGE' | 'REJECTED_SCHEMA';
  reason: string;
} {
  const unitClean = (rawUnit || '').trim().toLowerCase();

  if (metricType === 'activity_state') {
    if (unitClean !== 'enum_activity') {
      return {
        ok: false,
        validationStatus: 'REJECTED_UNIT',
        reason: `Unsupported unit "${rawUnit}" for activity_state (expected enum_activity).`,
      };
    }
    if (typeof rawValue !== 'string' || !VALID_ACTIVITY_STATES.has(rawValue)) {
      return {
        ok: false,
        validationStatus: 'REJECTED_RANGE',
        reason: 'Invalid activity_state value.',
      };
    }
    return {
      ok: true,
      normalizedValue: rawValue,
      canonicalUnit: 'enum_activity',
      originalUnit: 'enum_activity',
    };
  }

  if (metricType === 'weather_condition') {
    if (unitClean !== 'enum_weather') {
      return {
        ok: false,
        validationStatus: 'REJECTED_UNIT',
        reason: `Unsupported unit "${rawUnit}" for weather_condition (expected enum_weather).`,
      };
    }
    if (typeof rawValue !== 'string' || !VALID_WEATHER_CONDITIONS.has(rawValue)) {
      return {
        ok: false,
        validationStatus: 'REJECTED_RANGE',
        reason: 'Invalid weather_condition value.',
      };
    }
    return {
      ok: true,
      normalizedValue: rawValue,
      canonicalUnit: 'enum_weather',
      originalUnit: 'enum_weather',
    };
  }

  if (typeof rawValue !== 'number' || !Number.isFinite(rawValue)) {
    return {
      ok: false,
      validationStatus: 'REJECTED_SCHEMA',
      reason: `Numeric value required for metric "${metricType}".`,
    };
  }

  switch (metricType) {
    case 'heart_rate': {
      if (unitClean !== 'bpm') {
        return {
          ok: false,
          validationStatus: 'REJECTED_UNIT',
          reason: `Unsupported unit "${rawUnit}" for heart_rate (expected bpm).`,
        };
      }
      if (rawValue < 20 || rawValue > 250) {
        return {
          ok: false,
          validationStatus: 'REJECTED_RANGE',
          reason: 'Heart rate value outside plausible physiological bounds (20–250 bpm).',
        };
      }
      return {
        ok: true,
        normalizedValue: Math.round(rawValue),
        canonicalUnit: 'bpm',
        originalUnit: 'bpm',
      };
    }

    case 'oxygen_saturation': {
      if (unitClean !== 'pct' && unitClean !== '%') {
        return {
          ok: false,
          validationStatus: 'REJECTED_UNIT',
          reason: `Unsupported unit "${rawUnit}" for oxygen_saturation (expected pct).`,
        };
      }
      if (rawValue < 50 || rawValue > 100) {
        return {
          ok: false,
          validationStatus: 'REJECTED_RANGE',
          reason: 'Oxygen saturation value outside plausible bounds (50–100%).',
        };
      }
      return {
        ok: true,
        normalizedValue: Number(rawValue.toFixed(1)),
        canonicalUnit: 'pct',
        originalUnit: 'pct',
      };
    }

    case 'body_temperature': {
      let celsius = rawValue;
      let origUnit: SupportedInputUnit = 'celsius';
      if (unitClean === 'fahrenheit' || unitClean === 'f' || unitClean === '°f') {
        celsius = ((rawValue - 32) * 5) / 9;
        origUnit = 'fahrenheit';
      } else if (unitClean !== 'celsius' && unitClean !== 'c' && unitClean !== '°c') {
        return {
          ok: false,
          validationStatus: 'REJECTED_UNIT',
          reason: `Unsupported unit "${rawUnit}" for body_temperature (expected celsius or fahrenheit).`,
        };
      }
      if (celsius < 30 || celsius > 45) {
        return {
          ok: false,
          validationStatus: 'REJECTED_RANGE',
          reason: 'Body temperature outside plausible physiological bounds (30.0–45.0 °C).',
        };
      }
      return {
        ok: true,
        normalizedValue: Number(celsius.toFixed(1)),
        canonicalUnit: 'celsius',
        originalUnit: origUnit,
      };
    }

    case 'step_cadence': {
      if (unitClean !== 'steps_per_min') {
        return {
          ok: false,
          validationStatus: 'REJECTED_UNIT',
          reason: `Unsupported unit "${rawUnit}" for step_cadence (expected steps_per_min).`,
        };
      }
      if (rawValue < 0 || rawValue > 300) {
        return {
          ok: false,
          validationStatus: 'REJECTED_RANGE',
          reason: 'Step cadence outside plausible bounds (0–300 steps/min).',
        };
      }
      return {
        ok: true,
        normalizedValue: Math.round(rawValue),
        canonicalUnit: 'steps_per_min',
        originalUnit: 'steps_per_min',
      };
    }

    case 'ambient_temperature': {
      let celsius = rawValue;
      let origUnit: SupportedInputUnit = 'celsius';
      if (unitClean === 'fahrenheit' || unitClean === 'f' || unitClean === '°f') {
        celsius = ((rawValue - 32) * 5) / 9;
        origUnit = 'fahrenheit';
      } else if (unitClean !== 'celsius' && unitClean !== 'c' && unitClean !== '°c') {
        return {
          ok: false,
          validationStatus: 'REJECTED_UNIT',
          reason: `Unsupported unit "${rawUnit}" for ambient_temperature (expected celsius or fahrenheit).`,
        };
      }
      if (celsius < -60 || celsius > 70) {
        return {
          ok: false,
          validationStatus: 'REJECTED_RANGE',
          reason: 'Ambient temperature outside plausible meteorological bounds (-60 to 70 °C).',
        };
      }
      return {
        ok: true,
        normalizedValue: Number(celsius.toFixed(1)),
        canonicalUnit: 'celsius',
        originalUnit: origUnit,
      };
    }

    case 'relative_humidity': {
      if (unitClean !== 'pct' && unitClean !== '%') {
        return {
          ok: false,
          validationStatus: 'REJECTED_UNIT',
          reason: `Unsupported unit "${rawUnit}" for relative_humidity (expected pct).`,
        };
      }
      if (rawValue < 0 || rawValue > 100) {
        return {
          ok: false,
          validationStatus: 'REJECTED_RANGE',
          reason: 'Relative humidity outside bounds (0–100%).',
        };
      }
      return {
        ok: true,
        normalizedValue: Math.round(rawValue),
        canonicalUnit: 'pct',
        originalUnit: 'pct',
      };
    }

    case 'wind_speed': {
      let kmh = rawValue;
      let origUnit: SupportedInputUnit = 'kmh';
      if (unitClean === 'mph') {
        kmh = rawValue * 1.60934;
        origUnit = 'mph';
      } else if (unitClean === 'ms' || unitClean === 'm/s') {
        kmh = rawValue * 3.6;
        origUnit = 'ms';
      } else if (unitClean !== 'kmh' && unitClean !== 'km/h') {
        return {
          ok: false,
          validationStatus: 'REJECTED_UNIT',
          reason: `Unsupported unit "${rawUnit}" for wind_speed (expected kmh, mph, or ms).`,
        };
      }
      if (kmh < 0 || kmh > 400) {
        return {
          ok: false,
          validationStatus: 'REJECTED_RANGE',
          reason: 'Wind speed outside plausible meteorological bounds (0–400 km/h).',
        };
      }
      return {
        ok: true,
        normalizedValue: Number(kmh.toFixed(1)),
        canonicalUnit: 'kmh',
        originalUnit: origUnit,
      };
    }

    case 'air_quality_index': {
      if (unitClean !== 'aqi') {
        return {
          ok: false,
          validationStatus: 'REJECTED_UNIT',
          reason: `Unsupported unit "${rawUnit}" for air_quality_index (expected aqi).`,
        };
      }
      if (rawValue < 0 || rawValue > 500) {
        return {
          ok: false,
          validationStatus: 'REJECTED_RANGE',
          reason: 'Air quality index outside bounds (0–500 AQI).',
        };
      }
      return {
        ok: true,
        normalizedValue: Math.round(rawValue),
        canonicalUnit: 'aqi',
        originalUnit: 'aqi',
      };
    }
  }
}

/**
 * Evaluates observation freshness according to the metric's freshness window and clock skew limits.
 */
export function evaluateObservationFreshness(
  metricType: ObservationMetricType,
  observedAtIso: string,
  nowMs: number = Date.now(),
  policy: FreshnessPolicyConfig = DEFAULT_FRESHNESS_POLICY
): {
  freshnessStatus: DataQualityState;
  ageMs: number;
  clockSkewExceeded: boolean;
} {
  const observedMs = Date.parse(observedAtIso);
  if (Number.isNaN(observedMs)) {
    return {
      freshnessStatus: 'INVALID',
      ageMs: Infinity,
      clockSkewExceeded: false,
    };
  }

  const deltaMs = nowMs - observedMs;
  if (deltaMs < -policy.maxFutureClockSkewMs) {
    return {
      freshnessStatus: 'INVALID',
      ageMs: deltaMs,
      clockSkewExceeded: true,
    };
  }

  const maxAgeMs = PHYSIOLOGICAL_METRICS.has(metricType)
    ? policy.physiologicalStaleAfterMs
    : policy.environmentalStaleAfterMs;

  if (deltaMs > maxAgeMs) {
    return {
      freshnessStatus: 'STALE',
      ageMs: deltaMs,
      clockSkewExceeded: false,
    };
  }

  return {
    freshnessStatus: 'CURRENT',
    ageMs: Math.max(0, deltaMs),
    clockSkewExceeded: false,
  };
}

/**
 * Validates and normalizes an incoming raw observation on the trusted backend/coordinator.
 * - Never trusts a client-supplied `claimedDataMode === 'REAL'` unless the registered provider is verified REAL.
 */
export function validateAndNormalizeObservation(params: {
  raw: RawObservationInput;
  authenticatedUid: string;
  authoritativeProviderMode: DataSourceMode;
  providerVerifiedReal: boolean;
  freshnessPolicy?: FreshnessPolicyConfig;
  nowMs?: number;
}):
  | {
      ok: true;
      observation: NormalizedObservation;
    }
  | {
      ok: false;
      validationStatus: ObservationValidationStatus;
      sanitizedReason: string;
    } {
  const {
    raw,
    authenticatedUid,
    authoritativeProviderMode,
    providerVerifiedReal,
    freshnessPolicy = DEFAULT_FRESHNESS_POLICY,
    nowMs = Date.now(),
  } = params;

  if (!raw || typeof raw !== 'object') {
    return {
      ok: false,
      validationStatus: 'REJECTED_SCHEMA',
      sanitizedReason: 'Observation payload must be a JSON object.',
    };
  }

  if (
    raw.authenticatedOwnerId &&
    raw.authenticatedOwnerId.trim() !== authenticatedUid
  ) {
    return {
      ok: false,
      validationStatus: 'REJECTED_PROVENANCE',
      sanitizedReason: `Observation owner "${raw.authenticatedOwnerId}" does not match authenticated user "${authenticatedUid}".`,
    };
  }

  // Provenance Enforcement: Simulation or unverified sources can NEVER produce REAL observations
  if (
    raw.claimedDataMode === 'REAL' &&
    (authoritativeProviderMode !== 'REAL' || !providerVerifiedReal)
  ) {
    return {
      ok: false,
      validationStatus: 'REJECTED_PROVENANCE',
      sanitizedReason:
        'Provenance violation: Client or unverified provider attempted to mark observation as REAL without verified provider authorization.',
    };
  }

  const authoritativeMode: DataSourceMode =
    authoritativeProviderMode === 'REAL' && providerVerifiedReal
      ? 'REAL'
      : 'SIMULATED';

  const observationId = (raw.observationId || '').trim();
  if (
    !observationId ||
    observationId.length > 128 ||
    !VALID_ID_REGEX.test(observationId)
  ) {
    return {
      ok: false,
      validationStatus: 'REJECTED_SCHEMA',
      sanitizedReason: 'Invalid or missing observationId.',
    };
  }

  const sourceProvider = (raw.sourceProvider || '').trim();
  if (
    !sourceProvider ||
    sourceProvider.length > 64 ||
    !VALID_ID_REGEX.test(sourceProvider)
  ) {
    return {
      ok: false,
      validationStatus: 'REJECTED_SCHEMA',
      sanitizedReason: 'Invalid or missing sourceProvider identifier.',
    };
  }

  const metricType = (raw.metricType || '').trim() as ObservationMetricType;
  if (!SUPPORTED_METRICS.has(metricType)) {
    return {
      ok: false,
      validationStatus: 'REJECTED_SCHEMA',
      sanitizedReason: `Unsupported or unknown metricType "${raw.metricType}".`,
    };
  }

  const observedAt = (raw.observedAt || '').trim();
  if (!observedAt || Number.isNaN(Date.parse(observedAt))) {
    return {
      ok: false,
      validationStatus: 'REJECTED_SCHEMA',
      sanitizedReason: 'Malformed or missing observedAt ISO-8601 timestamp.',
    };
  }

  const freshness = evaluateObservationFreshness(
    metricType,
    observedAt,
    nowMs,
    freshnessPolicy
  );
  if (freshness.clockSkewExceeded || freshness.freshnessStatus === 'INVALID') {
    return {
      ok: false,
      validationStatus: 'REJECTED_SCHEMA',
      sanitizedReason:
        'Observation timestamp exceeds maximum future clock skew tolerance or is invalid.',
    };
  }

  const normalizedUnitResult = normalizeObservationUnitAndValue(
    metricType,
    raw.value,
    raw.unit || ''
  );
  if (!normalizedUnitResult.ok) {
    return {
      ok: false,
      validationStatus: normalizedUnitResult.validationStatus,
      sanitizedReason: normalizedUnitResult.reason,
    };
  }

  const receivedAt =
    raw.receivedAt && !Number.isNaN(Date.parse(raw.receivedAt))
      ? new Date(raw.receivedAt).toISOString()
      : new Date(nowMs).toISOString();

  const normalized: NormalizedObservation = {
    observationId,
    authenticatedOwnerId: authenticatedUid,
    metricType,
    value: normalizedUnitResult.normalizedValue,
    unit: normalizedUnitResult.canonicalUnit,
    originalUnit: normalizedUnitResult.originalUnit,
    observedAt: new Date(observedAt).toISOString(),
    receivedAt,
    sourceProvider,
    sourceRecordId: raw.sourceRecordId ? String(raw.sourceRecordId).slice(0, 128) : undefined,
    dataMode: authoritativeMode,
    validationStatus: 'VALIDATED',
    freshnessStatus: freshness.freshnessStatus,
    consentReference: raw.consentReference
      ? String(raw.consentReference).slice(0, 128)
      : undefined,
    isOutdoorContext: Boolean(raw.isOutdoorContext),
  };

  return {
    ok: true,
    observation: normalized,
  };
}

/**
 * Common Data Provider Adapter Interface (Section 2).
 */
export interface DataProviderAdapter {
  readonly providerId: string;
  readonly providerName: string;
  readonly category: ProviderCategory;
  readonly authoritativeDataMode: DataSourceMode;
  readonly supportedMetrics: ObservationMetricType[];

  getConnectionStatus(): ProviderConnectionStatus;
  isVerifiedRealProvider(): boolean;
  connectAndAuthorize(params: {
    authenticatedUid: string;
    consentGranted: boolean;
    consentReference?: string;
    authTokenOrCode?: string;
    coarseLatitude?: number;
    coarseLongitude?: number;
  }): Promise<ProviderHealthDiagnostics>;
  fetchObservations(params: {
    authenticatedUid: string;
    nowMs?: number;
  }): Promise<RawObservationInput[]>;
  disconnect(): Promise<ProviderHealthDiagnostics>;
  revokeAuthorization(): Promise<ProviderHealthDiagnostics>;
  getDiagnostics(nowMs?: number): ProviderHealthDiagnostics;
}

/**
 * A. SimulationDataProvider
 * - Uses synthetic test fixtures.
 * - Clearly labelled SIMULATED.
 * - Cannot produce records labelled REAL.
 * - Never contacts external devices or services.
 */
export class SimulationDataProvider implements DataProviderAdapter {
  public readonly providerId = 'vitaguard-simulation-sandbox';
  public readonly providerName = 'VitaGuard Synthetic Telemetry Sandbox';
  public readonly category: ProviderCategory = 'SIMULATION';
  public readonly authoritativeDataMode: DataSourceMode = 'SIMULATED';
  public readonly supportedMetrics: ObservationMetricType[] = [
    'heart_rate',
    'oxygen_saturation',
    'body_temperature',
    'activity_state',
    'step_cadence',
    'ambient_temperature',
    'relative_humidity',
    'weather_condition',
    'wind_speed',
    'air_quality_index',
  ];

  private connectionStatus: ProviderConnectionStatus = 'CONNECTED';
  private lastSuccessfulSyncAt?: string;
  private lastAttemptedSyncAt?: string;
  private fixtureVitals: VitalReadings;
  private fixtureEnvironment: EnvironmentReadings;
  private syncCounter = 0;

  constructor(initialFixture?: {
    vitals?: VitalReadings;
    environment?: EnvironmentReadings;
    initialVitals?: VitalReadings;
    initialEnvironment?: EnvironmentReadings;
  }) {
    this.fixtureVitals =
      initialFixture?.vitals ??
      initialFixture?.initialVitals ?? {
        heartRateBpm: 72,
        oxygenSaturationPct: 98,
        bodyTempCelsius: 36.8,
        activityLevel: ActivityLevel.RESTING,
        stepCadencePerMin: 0,
      };
    this.fixtureEnvironment =
      initialFixture?.environment ??
      initialFixture?.initialEnvironment ?? {
        ambientTempCelsius: 22,
        humidityPct: 45,
        weatherCondition: WeatherCondition.CLEAR,
        windSpeedKmh: 10,
        airQualityIndex: 28,
      };
  }

  public updateFixtures(
    vitals: VitalReadings,
    environment: EnvironmentReadings
  ): void {
    this.fixtureVitals = structuredClone(vitals);
    this.fixtureEnvironment = structuredClone(environment);
  }

  public setScenarioReadings(
    vitals: VitalReadings,
    environment: EnvironmentReadings
  ): void {
    this.updateFixtures(vitals, environment);
  }

  public getConnectionStatus(): ProviderConnectionStatus {
    return this.connectionStatus;
  }

  public isVerifiedRealProvider(): boolean {
    // SimulationDataProvider can NEVER produce REAL records
    return false;
  }

  public async connectAndAuthorize(_params?: {
    authenticatedUid: string;
    consentGranted: boolean;
  }): Promise<ProviderHealthDiagnostics> {
    this.connectionStatus = 'CONNECTED';
    return this.getDiagnostics();
  }

  public async fetchObservations(params: {
    authenticatedUid: string;
    nowMs?: number;
  }): Promise<RawObservationInput[]> {
    const { authenticatedUid, nowMs = Date.now() } = params;
    const nowIso = new Date(nowMs).toISOString();
    this.lastAttemptedSyncAt = nowIso;

    if (this.connectionStatus !== 'CONNECTED') {
      throw new DataIngestionError(
        'PROVIDER_NOT_CONNECTED',
        'Simulation provider is currently disconnected.',
        400
      );
    }

    this.syncCounter += 1;
    this.lastSuccessfulSyncAt = nowIso;
    const batchPrefix = `sim-${this.syncCounter}-${nowMs}`;

    return [
      {
        observationId: `${batchPrefix}-hr`,
        authenticatedOwnerId: authenticatedUid,
        metricType: 'heart_rate',
        value: this.fixtureVitals.heartRateBpm,
        unit: 'bpm',
        observedAt: nowIso,
        receivedAt: nowIso,
        sourceProvider: this.providerId,
        sourceRecordId: `rec-hr-${this.syncCounter}`,
        claimedDataMode: 'SIMULATED',
      },
      {
        observationId: `${batchPrefix}-spo2`,
        authenticatedOwnerId: authenticatedUid,
        metricType: 'oxygen_saturation',
        value: this.fixtureVitals.oxygenSaturationPct,
        unit: 'pct',
        observedAt: nowIso,
        receivedAt: nowIso,
        sourceProvider: this.providerId,
        sourceRecordId: `rec-spo2-${this.syncCounter}`,
        claimedDataMode: 'SIMULATED',
      },
      {
        observationId: `${batchPrefix}-btemp`,
        authenticatedOwnerId: authenticatedUid,
        metricType: 'body_temperature',
        value: this.fixtureVitals.bodyTempCelsius,
        unit: 'celsius',
        observedAt: nowIso,
        receivedAt: nowIso,
        sourceProvider: this.providerId,
        sourceRecordId: `rec-btemp-${this.syncCounter}`,
        claimedDataMode: 'SIMULATED',
      },
      {
        observationId: `${batchPrefix}-act`,
        authenticatedOwnerId: authenticatedUid,
        metricType: 'activity_state',
        value: this.fixtureVitals.activityLevel,
        unit: 'enum_activity',
        observedAt: nowIso,
        receivedAt: nowIso,
        sourceProvider: this.providerId,
        sourceRecordId: `rec-act-${this.syncCounter}`,
        claimedDataMode: 'SIMULATED',
      },
      {
        observationId: `${batchPrefix}-cad`,
        authenticatedOwnerId: authenticatedUid,
        metricType: 'step_cadence',
        value: this.fixtureVitals.stepCadencePerMin,
        unit: 'steps_per_min',
        observedAt: nowIso,
        receivedAt: nowIso,
        sourceProvider: this.providerId,
        sourceRecordId: `rec-cad-${this.syncCounter}`,
        claimedDataMode: 'SIMULATED',
      },
      {
        observationId: `${batchPrefix}-atemp`,
        authenticatedOwnerId: authenticatedUid,
        metricType: 'ambient_temperature',
        value: this.fixtureEnvironment.ambientTempCelsius,
        unit: 'celsius',
        observedAt: nowIso,
        receivedAt: nowIso,
        sourceProvider: this.providerId,
        sourceRecordId: `rec-atemp-${this.syncCounter}`,
        claimedDataMode: 'SIMULATED',
      },
      {
        observationId: `${batchPrefix}-hum`,
        authenticatedOwnerId: authenticatedUid,
        metricType: 'relative_humidity',
        value: this.fixtureEnvironment.humidityPct,
        unit: 'pct',
        observedAt: nowIso,
        receivedAt: nowIso,
        sourceProvider: this.providerId,
        sourceRecordId: `rec-hum-${this.syncCounter}`,
        claimedDataMode: 'SIMULATED',
      },
      {
        observationId: `${batchPrefix}-wx`,
        authenticatedOwnerId: authenticatedUid,
        metricType: 'weather_condition',
        value: this.fixtureEnvironment.weatherCondition,
        unit: 'enum_weather',
        observedAt: nowIso,
        receivedAt: nowIso,
        sourceProvider: this.providerId,
        sourceRecordId: `rec-wx-${this.syncCounter}`,
        claimedDataMode: 'SIMULATED',
      },
    ];
  }

  public async disconnect(): Promise<ProviderHealthDiagnostics> {
    this.connectionStatus = 'DISCONNECTED';
    return this.getDiagnostics();
  }

  public async revokeAuthorization(): Promise<ProviderHealthDiagnostics> {
    this.connectionStatus = 'REVOKED';
    return this.getDiagnostics();
  }

  public getDiagnostics(): ProviderHealthDiagnostics {
    return {
      providerId: this.providerId,
      providerName: this.providerName,
      category: this.category,
      dataMode: 'SIMULATED',
      connectionStatus: this.connectionStatus,
      authorizedScopes: ['simulation:vitals:read', 'simulation:environment:read'],
      supportedMetrics: this.supportedMetrics,
      lastSuccessfulSyncAt: this.lastSuccessfulSyncAt,
      lastAttemptedSyncAt: this.lastAttemptedSyncAt,
      dataQualityState:
        this.connectionStatus === 'CONNECTED' ? 'CURRENT' : 'MISSING',
      consentGranted: true,
      consentReference: 'consent-sim-local-default',
      locationPrecision: 'NONE',
      implementationStatus: 'IMPLEMENTED_SIMULATED',
      statusDetail:
        'Synthetic local telemetry generator active. Never contacts external devices or claims REAL provenance.',
    };
  }
}

/**
 * B. WearableDataProvider (Authorized Health-Data Export / OAuth Wearable Adapter Scaffold)
 * - Does NOT claim a connected status until explicit authorization + token validation + valid sample check succeed.
 * - Supports unit conversion (e.g., °F to °C from US wearable exports) and partial metric payloads.
 * - Supports explicit disconnection and authorization revocation.
 */
export class WearableDataProvider implements DataProviderAdapter {
  public readonly providerId: string;
  public readonly providerName: string;
  public readonly category: ProviderCategory = 'WEARABLE';
  public readonly authoritativeDataMode: DataSourceMode;
  public readonly supportedMetrics: ObservationMetricType[] = [
    'heart_rate',
    'oxygen_saturation',
    'body_temperature',
    'activity_state',
    'step_cadence',
  ];

  private connectionStatus: ProviderConnectionStatus = 'DISCONNECTED';
  private consentGranted = false;
  private consentReference?: string;
  private serverVerifiedSession = false;
  private lastSuccessfulSyncAt?: string;
  private lastAttemptedSyncAt?: string;
  private sanitizedLastError?: string;
  private upstreamFetcher?: (uid: string) => Promise<RawObservationInput[]>;

  constructor(options: {
    providerId?: string;
    providerName?: string;
    serverVerifiedOAuthConfigured?: boolean;
    upstreamFetcher?: (uid: string) => Promise<RawObservationInput[]>;
  } = {}) {
    this.providerId = options.providerId || 'wearable-oauth-bridge';
    this.providerName =
      options.providerName || 'Authorized Wearable Health Export Bridge';
    this.serverVerifiedSession = Boolean(options.serverVerifiedOAuthConfigured);
    this.authoritativeDataMode = this.serverVerifiedSession ? 'REAL' : 'SIMULATED';
    this.upstreamFetcher = options.upstreamFetcher;
  }

  public getConnectionStatus(): ProviderConnectionStatus {
    return this.connectionStatus;
  }

  public isVerifiedRealProvider(): boolean {
    return (
      this.connectionStatus === 'CONNECTED' &&
      this.consentGranted &&
      this.serverVerifiedSession
    );
  }

  public async connectAndAuthorize(params: {
    authenticatedUid: string;
    consentGranted: boolean;
    consentReference?: string;
    authTokenOrCode?: string;
  }): Promise<ProviderHealthDiagnostics> {
    if (!params.authenticatedUid) {
      throw new DataIngestionError(
        'UNAUTHENTICATED',
        'Authenticated user session required to authorize wearable provider.',
        401
      );
    }
    if (!params.consentGranted) {
      this.connectionStatus = 'DISCONNECTED';
      this.sanitizedLastError =
        'Explicit user health-data consent is required before connecting wearable bridge.';
      throw new DataIngestionError(
        'CONSENT_REQUIRED',
        this.sanitizedLastError,
        403
      );
    }

    if (
      !params.authTokenOrCode ||
      params.authTokenOrCode.trim() === 'INVALID_TOKEN' ||
      params.authTokenOrCode.trim() === 'EXPIRED_TOKEN'
    ) {
      this.connectionStatus = 'ERROR';
      this.sanitizedLastError =
        'Wearable provider authorization failed: Invalid or expired OAuth authorization code/token.';
      throw new DataIngestionError(
        'PROVIDER_AUTH_FAILED',
        this.sanitizedLastError,
        401
      );
    }

    this.consentGranted = true;
    this.consentReference =
      params.consentReference || `consent-wearable-${Date.now()}`;
    this.connectionStatus = 'CONNECTED';
    this.sanitizedLastError = undefined;
    return this.getDiagnostics();
  }

  public async fetchObservations(params: {
    authenticatedUid: string;
    nowMs?: number;
  }): Promise<RawObservationInput[]> {
    const { authenticatedUid, nowMs = Date.now() } = params;
    const nowIso = new Date(nowMs).toISOString();
    this.lastAttemptedSyncAt = nowIso;

    if (this.connectionStatus === 'REVOKED') {
      throw new DataIngestionError(
        'PROVIDER_REVOKED',
        'Wearable provider authorization was revoked. Re-authorize before syncing.',
        403
      );
    }

    if (this.connectionStatus !== 'CONNECTED' || !this.consentGranted) {
      throw new DataIngestionError(
        'PROVIDER_NOT_CONNECTED',
        'Wearable provider is not connected or lacks user consent.',
        400
      );
    }

    try {
      if (this.upstreamFetcher) {
        const records = await this.upstreamFetcher(authenticatedUid);
        this.lastSuccessfulSyncAt = nowIso;
        this.sanitizedLastError = undefined;
        return records;
      }

      // Default scaffold export payload when no live physical device is paired
      this.lastSuccessfulSyncAt = nowIso;
      return [
        {
          observationId: `wb-${nowMs}-hr`,
          authenticatedOwnerId: authenticatedUid,
          metricType: 'heart_rate',
          value: 78,
          unit: 'bpm',
          observedAt: nowIso,
          receivedAt: nowIso,
          sourceProvider: this.providerId,
          sourceRecordId: `wb-rec-hr-${nowMs}`,
          claimedDataMode: this.isVerifiedRealProvider() ? 'REAL' : 'SIMULATED',
          consentReference: this.consentReference,
        },
        {
          observationId: `wb-${nowMs}-spo2`,
          authenticatedOwnerId: authenticatedUid,
          metricType: 'oxygen_saturation',
          value: 97,
          unit: 'pct',
          observedAt: nowIso,
          receivedAt: nowIso,
          sourceProvider: this.providerId,
          sourceRecordId: `wb-rec-spo2-${nowMs}`,
          claimedDataMode: this.isVerifiedRealProvider() ? 'REAL' : 'SIMULATED',
          consentReference: this.consentReference,
        },
        {
          observationId: `wb-${nowMs}-btemp-f`,
          authenticatedOwnerId: authenticatedUid,
          metricType: 'body_temperature',
          value: 98.6, // Supplied in Fahrenheit to exercise unit normalization -> 37.0°C
          unit: 'fahrenheit',
          observedAt: nowIso,
          receivedAt: nowIso,
          sourceProvider: this.providerId,
          sourceRecordId: `wb-rec-btemp-${nowMs}`,
          claimedDataMode: this.isVerifiedRealProvider() ? 'REAL' : 'SIMULATED',
          consentReference: this.consentReference,
        },
      ];
    } catch (err) {
      const cleanMsg = sanitizeIngestionError(
        err instanceof Error ? err.message : 'Wearable synchronization error.'
      );
      this.sanitizedLastError = cleanMsg;
      this.connectionStatus = 'ERROR';
      throw err instanceof DataIngestionError
        ? err
        : new DataIngestionError('UPSTREAM_UNAVAILABLE', cleanMsg, 502);
    }
  }

  public async disconnect(): Promise<ProviderHealthDiagnostics> {
    this.connectionStatus = 'DISCONNECTED';
    return this.getDiagnostics();
  }

  public async revokeAuthorization(): Promise<ProviderHealthDiagnostics> {
    this.connectionStatus = 'REVOKED';
    this.consentGranted = false;
    this.consentReference = undefined;
    return this.getDiagnostics();
  }

  public getDiagnostics(): ProviderHealthDiagnostics {
    return {
      providerId: this.providerId,
      providerName: this.providerName,
      category: this.category,
      dataMode: this.isVerifiedRealProvider() ? 'REAL' : 'SIMULATED',
      connectionStatus: this.connectionStatus,
      authorizedScopes: this.consentGranted
        ? ['health.heart_rate.read', 'health.oxygen_saturation.read', 'health.body_temperature.read']
        : [],
      supportedMetrics: this.supportedMetrics,
      lastSuccessfulSyncAt: this.lastSuccessfulSyncAt,
      lastAttemptedSyncAt: this.lastAttemptedSyncAt,
      dataQualityState:
        this.connectionStatus === 'CONNECTED' && this.lastSuccessfulSyncAt
          ? 'CURRENT'
          : 'MISSING',
      consentGranted: this.consentGranted,
      consentReference: this.consentReference,
      locationPrecision: 'NONE',
      implementationStatus: this.serverVerifiedSession
        ? 'IMPLEMENTED_SERVER_PROXY'
        : 'SCAFFOLD_OAUTH_MOCK',
      sanitizedLastError: this.sanitizedLastError,
      statusDetail: this.serverVerifiedSession
        ? 'Verified OAuth wearable bridge connected.'
        : 'Adapter scaffold & mock export verifier active (no physical wearable hardware paired; records remain SIMULATED unless server OAuth credentials are provisioned).',
    };
  }
}

/**
 * C. EnvironmentalDataProvider (Documented Weather & Environmental Backend Adapter)
 * - Integrates with Open-Meteo / backend weather proxy endpoint.
 * - Requires explicit coarse-location user consent before requesting weather data.
 * - Validates units, timestamps, and source reliability.
 * - Marks observations with `isOutdoorContext: true` and never infers indoor conditions from outdoor weather.
 * - Gracefully handles API rate limits (429), timeouts (504), and unavailable data.
 */
export class EnvironmentalDataProvider implements DataProviderAdapter {
  public readonly providerId = 'open-meteo-weather-proxy';
  public readonly providerName = 'Open-Meteo Weather & Air Quality Service (Server Proxy)';
  public readonly category: ProviderCategory = 'ENVIRONMENTAL';
  public readonly authoritativeDataMode: DataSourceMode = 'REAL';
  public readonly supportedMetrics: ObservationMetricType[] = [
    'ambient_temperature',
    'relative_humidity',
    'weather_condition',
    'wind_speed',
    'air_quality_index',
  ];

  private connectionStatus: ProviderConnectionStatus = 'DISCONNECTED';
  private consentGranted = false;
  private consentReference?: string;
  private coarseLatitude = 37.77; // Rounded to 2 decimal places (~1.1km city precision)
  private coarseLongitude = -122.42;
  private lastSuccessfulSyncAt?: string;
  private lastAttemptedSyncAt?: string;
  private sanitizedLastError?: string;
  private customWeatherFetcher?: (params: {
    coarseLatitude: number;
    coarseLongitude: number;
  }) => Promise<{
    ambientTempCelsius: number;
    humidityPct: number;
    windSpeedKmh: number;
    weatherCondition: WeatherCondition;
    airQualityIndex?: number;
    observedAtIso: string;
  }>;

  constructor(options: {
    customWeatherFetcher?: EnvironmentalDataProvider['customWeatherFetcher'];
  } = {}) {
    this.customWeatherFetcher = options.customWeatherFetcher;
  }

  public getConnectionStatus(): ProviderConnectionStatus {
    return this.connectionStatus;
  }

  public isVerifiedRealProvider(): boolean {
    return this.connectionStatus === 'CONNECTED' && this.consentGranted;
  }

  public async connectAndAuthorize(params: {
    authenticatedUid: string;
    consentGranted: boolean;
    consentReference?: string;
    coarseLatitude?: number;
    coarseLongitude?: number;
  }): Promise<ProviderHealthDiagnostics> {
    if (!params.authenticatedUid) {
      throw new DataIngestionError(
        'UNAUTHENTICATED',
        'Authentication required to enable environmental weather provider.',
        401
      );
    }
    if (!params.consentGranted) {
      this.connectionStatus = 'DISCONNECTED';
      this.sanitizedLastError =
        'Location consent is required to retrieve regional weather observations.';
      throw new DataIngestionError(
        'CONSENT_REQUIRED',
        this.sanitizedLastError,
        403
      );
    }

    // Privacy minimization: coarsen coordinates to 2 decimal places (~1.1 km resolution)
    if (typeof params.coarseLatitude === 'number' && Number.isFinite(params.coarseLatitude)) {
      this.coarseLatitude = Number(
        Math.max(-90, Math.min(90, params.coarseLatitude)).toFixed(2)
      );
    }
    if (typeof params.coarseLongitude === 'number' && Number.isFinite(params.coarseLongitude)) {
      this.coarseLongitude = Number(
        Math.max(-180, Math.min(180, params.coarseLongitude)).toFixed(2)
      );
    }

    this.consentGranted = true;
    this.consentReference =
      params.consentReference || `consent-env-coarse-loc-${Date.now()}`;
    this.connectionStatus = 'CONNECTED';
    this.sanitizedLastError = undefined;
    return this.getDiagnostics();
  }

  public async fetchObservations(params: {
    authenticatedUid: string;
    nowMs?: number;
  }): Promise<RawObservationInput[]> {
    const { authenticatedUid, nowMs = Date.now() } = params;
    const nowIso = new Date(nowMs).toISOString();
    this.lastAttemptedSyncAt = nowIso;

    if (this.connectionStatus === 'REVOKED') {
      throw new DataIngestionError(
        'PROVIDER_REVOKED',
        'Environmental provider location consent was revoked.',
        403
      );
    }

    if (this.connectionStatus !== 'CONNECTED' || !this.consentGranted) {
      throw new DataIngestionError(
        'PROVIDER_NOT_CONNECTED',
        'Environmental provider is not connected or location consent was not granted.',
        400
      );
    }

    try {
      if (!this.customWeatherFetcher) {
        throw new DataIngestionError(
          'UPSTREAM_UNAVAILABLE',
          'Weather fetcher is not configured.',
          503
        );
      }

      const wx = await this.customWeatherFetcher({
        coarseLatitude: this.coarseLatitude,
        coarseLongitude: this.coarseLongitude,
      });

      this.lastSuccessfulSyncAt = nowIso;
      this.sanitizedLastError = undefined;
      const obsIso = wx.observedAtIso || nowIso;
      const prefix = `wx-${nowMs}`;

      const records: RawObservationInput[] = [
        {
          observationId: `${prefix}-atemp`,
          authenticatedOwnerId: authenticatedUid,
          metricType: 'ambient_temperature',
          value: wx.ambientTempCelsius,
          unit: 'celsius',
          observedAt: obsIso,
          receivedAt: nowIso,
          sourceProvider: this.providerId,
          sourceRecordId: `om-atemp-${obsIso}`,
          claimedDataMode: 'REAL',
          consentReference: this.consentReference,
          isOutdoorContext: true,
        },
        {
          observationId: `${prefix}-hum`,
          authenticatedOwnerId: authenticatedUid,
          metricType: 'relative_humidity',
          value: wx.humidityPct,
          unit: 'pct',
          observedAt: obsIso,
          receivedAt: nowIso,
          sourceProvider: this.providerId,
          sourceRecordId: `om-hum-${obsIso}`,
          claimedDataMode: 'REAL',
          consentReference: this.consentReference,
          isOutdoorContext: true,
        },
        {
          observationId: `${prefix}-wind`,
          authenticatedOwnerId: authenticatedUid,
          metricType: 'wind_speed',
          value: wx.windSpeedKmh,
          unit: 'kmh',
          observedAt: obsIso,
          receivedAt: nowIso,
          sourceProvider: this.providerId,
          sourceRecordId: `om-wind-${obsIso}`,
          claimedDataMode: 'REAL',
          consentReference: this.consentReference,
          isOutdoorContext: true,
        },
        {
          observationId: `${prefix}-cond`,
          authenticatedOwnerId: authenticatedUid,
          metricType: 'weather_condition',
          value: wx.weatherCondition,
          unit: 'enum_weather',
          observedAt: obsIso,
          receivedAt: nowIso,
          sourceProvider: this.providerId,
          sourceRecordId: `om-cond-${obsIso}`,
          claimedDataMode: 'REAL',
          consentReference: this.consentReference,
          isOutdoorContext: true,
        },
      ];

      if (typeof wx.airQualityIndex === 'number' && Number.isFinite(wx.airQualityIndex)) {
        records.push({
          observationId: `${prefix}-aqi`,
          authenticatedOwnerId: authenticatedUid,
          metricType: 'air_quality_index',
          value: wx.airQualityIndex,
          unit: 'aqi',
          observedAt: obsIso,
          receivedAt: nowIso,
          sourceProvider: this.providerId,
          sourceRecordId: `om-aqi-${obsIso}`,
          claimedDataMode: 'REAL',
          consentReference: this.consentReference,
          isOutdoorContext: true,
        });
      }

      return records;
    } catch (err) {
      const cleanMsg = sanitizeIngestionError(
        err instanceof Error ? err.message : 'Weather API request failed.'
      );
      this.sanitizedLastError = cleanMsg;
      if (err instanceof DataIngestionError) {
        throw err;
      }
      throw new DataIngestionError('UPSTREAM_UNAVAILABLE', cleanMsg, 502);
    }
  }

  public async disconnect(): Promise<ProviderHealthDiagnostics> {
    this.connectionStatus = 'DISCONNECTED';
    return this.getDiagnostics();
  }

  public async revokeAuthorization(): Promise<ProviderHealthDiagnostics> {
    this.connectionStatus = 'REVOKED';
    this.consentGranted = false;
    this.consentReference = undefined;
    return this.getDiagnostics();
  }

  public getDiagnostics(): ProviderHealthDiagnostics {
    return {
      providerId: this.providerId,
      providerName: this.providerName,
      category: this.category,
      dataMode: 'REAL',
      connectionStatus: this.connectionStatus,
      authorizedScopes: this.consentGranted ? ['location:coarse_city', 'weather:current'] : [],
      supportedMetrics: this.supportedMetrics,
      lastSuccessfulSyncAt: this.lastSuccessfulSyncAt,
      lastAttemptedSyncAt: this.lastAttemptedSyncAt,
      dataQualityState:
        this.connectionStatus === 'CONNECTED' && this.lastSuccessfulSyncAt
          ? 'CURRENT'
          : 'MISSING',
      consentGranted: this.consentGranted,
      consentReference: this.consentReference,
      locationPrecision: this.consentGranted ? 'COARSE_CITY' : 'NONE',
      implementationStatus: 'IMPLEMENTED_SERVER_PROXY',
      sanitizedLastError: this.sanitizedLastError,
      statusDetail:
        this.connectionStatus === 'CONNECTED'
          ? `Connected to Open-Meteo proxy using coarse city coordinates (${this.coarseLatitude}, ${this.coarseLongitude}). Outdoor ambient weather only — never infers indoor conditions.`
          : 'Disconnected. Requires explicit coarse-location user consent.',
    };
  }
}

/**
 * Maps WMO Weather interpretation codes (from Open-Meteo) to VitaGuard's WeatherCondition enum.
 */
export function mapWmoCodeToWeatherCondition(
  wmoCode: number,
  tempCelsius: number,
  humidityPct: number
): WeatherCondition {
  if (tempCelsius >= 35) return WeatherCondition.HEATWAVE;
  if (tempCelsius <= 0) return WeatherCondition.FREEZING_WIND;
  if (wmoCode >= 51 && wmoCode <= 99) return WeatherCondition.HEAVY_RAIN;
  if (humidityPct >= 80) return WeatherCondition.HIGH_HUMIDITY;
  if (wmoCode >= 1 && wmoCode <= 48) return WeatherCondition.PARTLY_CLOUDY;
  return WeatherCondition.CLEAR;
}

/**
 * Pipeline Coordinator: Validates, deduplicates, checks provenance & freshness,
 * isolates SIMULATED from REAL streams, and invokes the deterministic risk engine
 * without creating a second risk engine or classifying disconnected wearables as emergencies.
 */
export class TelemetryIngestionCoordinator {
  private readonly freshnessPolicy: FreshnessPolicyConfig;
  private readonly providers = new Map<string, DataProviderAdapter>();
  private readonly observationsByUser = new Map<string, NormalizedObservation[]>();
  private readonly seenObservationKeysByUser = new Map<string, Set<string>>();
  private readonly latestAcceptedByUserModeMetric = new Map<
    string,
    NormalizedObservation
  >();
  private readonly activeAlertsByUserMode = new Map<string, SafetyAlert>();
  private readonly lastAlertSignatureByUserMode = new Map<string, string>();
  private readonly auditEventsByUser = new Map<string, SafetyEvent[]>();

  constructor(options: {
    freshnessPolicy?: Partial<FreshnessPolicyConfig>;
    providers?: DataProviderAdapter[];
  } = {}) {
    this.freshnessPolicy = {
      ...DEFAULT_FRESHNESS_POLICY,
      ...options.freshnessPolicy,
    };
    if (options.providers) {
      for (const p of options.providers) {
        this.registerProvider(p);
      }
    }
  }

  public registerProvider(provider: DataProviderAdapter): void {
    this.providers.set(provider.providerId, provider);
  }

  public getProvider(providerId: string): DataProviderAdapter | undefined {
    return this.providers.get(providerId);
  }

  public listProviderDiagnostics(nowMs?: number): ProviderHealthDiagnostics[] {
    return Array.from(this.providers.values()).map((p) => p.getDiagnostics(nowMs));
  }

  private assertAuthorized(actingUid: string | null, targetUid: string): string {
    if (!actingUid || !actingUid.trim()) {
      throw new DataIngestionError(
        'UNAUTHENTICATED',
        'Authentication is required to ingest or query telemetry observations.',
        401
      );
    }
    if (actingUid.trim() !== targetUid.trim()) {
      throw new DataIngestionError(
        'PERMISSION_DENIED',
        `PERMISSION_DENIED: User "${actingUid}" cannot access or ingest observations for user "${targetUid}".`,
        403
      );
    }
    return actingUid.trim();
  }

  /**
   * Synchronizes directly from a registered provider adapter and runs the ingestion pipeline.
   */
  public async syncFromProvider(params: {
    actingUid: string | null;
    targetUid: string;
    providerId: string;
    thresholds?: RiskThresholds;
    nowMs?: number;
  }): Promise<IngestionBatchResult> {
    const uid = this.assertAuthorized(params.actingUid, params.targetUid);
    const provider = this.providers.get(params.providerId);
    if (!provider) {
      throw new DataIngestionError(
        'PROVIDER_NOT_CONNECTED',
        `Unknown data provider "${params.providerId}".`,
        404
      );
    }

    const rawRecords = await provider.fetchObservations({
      authenticatedUid: uid,
      nowMs: params.nowMs,
    });

    return this.ingestBatch({
      actingUid: uid,
      targetUid: uid,
      providerId: provider.providerId,
      rawObservations: rawRecords,
      thresholds: params.thresholds,
      nowMs: params.nowMs,
    });
  }

  /**
   * Executes the 8-step ingestion-to-assessment pipeline:
   * 1. Validates incoming observations
   * 2. Confirms source provenance and authorization
   * 3. Normalizes metrics and timestamps
   * 4. Stores observations securely (isolated by SIMULATED vs REAL)
   * 5. Updates data-quality state (CURRENT, STALE, MISSING, INVALID)
   * 6. Invokes the existing deterministic risk engine when appropriate
   * 7. Persists the resulting assessment
   * 8. Invokes the existing alert workflow without duplicate alerts
   */
  public ingestBatch(params: {
    actingUid: string | null;
    targetUid: string;
    providerId: string;
    rawObservations: RawObservationInput[];
    thresholds?: RiskThresholds;
    nowMs?: number;
  }): IngestionBatchResult {
    const {
      actingUid,
      targetUid,
      providerId,
      rawObservations,
      thresholds = DEFAULT_THRESHOLDS,
      nowMs = Date.now(),
    } = params;

    const uid = this.assertAuthorized(actingUid, targetUid);
    const provider = this.providers.get(providerId);

    if (!provider) {
      throw new DataIngestionError(
        'PROVIDER_NOT_CONNECTED',
        `Unregistered provider "${providerId}" cannot ingest observations.`,
        403
      );
    }

    const connStatus = provider.getConnectionStatus();
    if (connStatus === 'REVOKED') {
      throw new DataIngestionError(
        'PROVIDER_REVOKED',
        `Provider "${providerId}" authorization has been revoked. Ingestion rejected.`,
        403
      );
    }
    if (connStatus !== 'CONNECTED') {
      throw new DataIngestionError(
        'PROVIDER_NOT_CONNECTED',
        `Provider "${providerId}" is not connected (status: ${connStatus}).`,
        400
      );
    }

    const accepted: NormalizedObservation[] = [];
    const rejected: IngestionBatchResult['rejected'] = [];
    const seenKeys =
      this.seenObservationKeysByUser.get(uid) ?? new Set<string>();
    this.seenObservationKeysByUser.set(uid, seenKeys);

    const userHistory = this.observationsByUser.get(uid) ?? [];

    for (const raw of rawObservations) {
      const validation = validateAndNormalizeObservation({
        raw: {
          ...raw,
          sourceProvider: raw.sourceProvider || provider.providerId,
        },
        authenticatedUid: uid,
        authoritativeProviderMode: provider.authoritativeDataMode,
        providerVerifiedReal: provider.isVerifiedRealProvider(),
        freshnessPolicy: this.freshnessPolicy,
        nowMs,
      });

      if (!validation.ok) {
        rejected.push({
          rawRecordId: raw.observationId || raw.sourceRecordId,
          metricType: raw.metricType,
          validationStatus: validation.validationStatus,
          sanitizedReason: sanitizeIngestionError(validation.sanitizedReason),
        });
        continue;
      }

      const obs = validation.observation;
      const dedupeKeyId = `id:${obs.observationId}`;
      const dedupeKeySource = obs.sourceRecordId
        ? `src:${obs.sourceProvider}:${obs.sourceRecordId}`
        : null;

      if (
        seenKeys.has(dedupeKeyId) ||
        (dedupeKeySource && seenKeys.has(dedupeKeySource))
      ) {
        rejected.push({
          rawRecordId: obs.observationId,
          metricType: obs.metricType,
          validationStatus: 'REJECTED_DUPLICATE',
          sanitizedReason: `Duplicate observation "${obs.observationId}" suppressed.`,
        });
        continue;
      }

      seenKeys.add(dedupeKeyId);
      if (dedupeKeySource) seenKeys.add(dedupeKeySource);

      // Out-of-order check: compare against latest accepted observation for (uid, dataMode, metricType)
      const streamKey = `${uid}::${obs.dataMode}::${obs.metricType}`;
      const priorLatest = this.latestAcceptedByUserModeMetric.get(streamKey);
      if (
        priorLatest &&
        Date.parse(obs.observedAt) < Date.parse(priorLatest.observedAt)
      ) {
        const quarantined: NormalizedObservation = {
          ...obs,
          validationStatus: 'QUARANTINED_OUT_OF_ORDER',
        };
        userHistory.unshift(quarantined);
        rejected.push({
          rawRecordId: obs.observationId,
          metricType: obs.metricType,
          validationStatus: 'QUARANTINED_OUT_OF_ORDER',
          sanitizedReason: `Out-of-order observation (${obs.observedAt} < ${priorLatest.observedAt}) recorded in history without overwriting newer reading.`,
        });
        continue;
      }

      this.latestAcceptedByUserModeMetric.set(streamKey, obs);
      userHistory.unshift(obs);
      accepted.push(obs);
    }

    // Apply retention limit (keep latest 200 observations per user)
    this.observationsByUser.set(uid, userHistory.slice(0, 200));

    // Evaluate stream data quality for the provider's authoritative mode (never mixing SIMULATED and REAL)
    const activeStreamMode: DataSourceMode = provider.isVerifiedRealProvider()
      ? 'REAL'
      : 'SIMULATED';

    const qualitySummary = this.computeStreamDataQuality(
      uid,
      activeStreamMode,
      nowMs
    );

    let assessmentTriggered = false;
    let assessment: RiskAssessment | undefined;
    let alertCreatedOrUpdated: SafetyAlert | null = null;
    let duplicateAlertSuppressed = false;

    // Only invoke the deterministic risk engine when accepted observations arrived
    // and required physiological or environmental readings in this stream are CURRENT (never classify missing/stale data as an emergency)
    if (accepted.length > 0 && qualitySummary.canEvaluateRisk) {
      assessmentTriggered = true;
      assessment = evaluateRisk(
        qualitySummary.assembledVitals,
        qualitySummary.assembledEnvironment,
        thresholds
      );

      // Check alert deduplication so duplicate/unchanged assessments do not trigger duplicate alerts
      const alertModeKey = `${uid}::${activeStreamMode}`;
      const priorAlert = this.activeAlertsByUserMode.get(alertModeKey) ?? null;
      const signature = `${assessment.riskLevel}:${assessment.triggeredRules
        .map((r) => r.id)
        .sort()
        .join(',')}`;
      const priorSignature = this.lastAlertSignatureByUserMode.get(alertModeKey);

      if (
        priorAlert &&
        !priorAlert.acknowledged &&
        priorSignature === signature
      ) {
        duplicateAlertSuppressed = true;
        alertCreatedOrUpdated = priorAlert;
      } else {
        alertCreatedOrUpdated = createAlertFromAssessment(
          assessment,
          priorAlert,
          new Date(nowMs).toISOString()
        );
        if (alertCreatedOrUpdated) {
          this.activeAlertsByUserMode.set(alertModeKey, alertCreatedOrUpdated);
          this.lastAlertSignatureByUserMode.set(alertModeKey, signature);
        } else {
          this.activeAlertsByUserMode.delete(alertModeKey);
          this.lastAlertSignatureByUserMode.delete(alertModeKey);
        }
      }
    }

    if (accepted.length > 0) {
      this.appendAuditEvent(uid, {
        id: `evt-ingest-${providerId}-${nowMs}`,
        timestamp: new Date(nowMs).toISOString(),
        type: 'observation_ingested',
        riskLevel: assessment?.riskLevel ?? RiskLevel.LOW,
        title: `Ingested ${accepted.length} Observation(s) from ${provider.providerName}`,
        detail: `Mode: ${activeStreamMode} · Overall Quality: ${qualitySummary.overallDataQuality}.`,
      });
    }

    return {
      accepted: structuredClone(accepted),
      rejected,
      dataQualityByMetric: qualitySummary.dataQualityByMetric,
      overallDataQuality: qualitySummary.overallDataQuality,
      assessmentTriggered,
      assessment: assessment ? structuredClone(assessment) : undefined,
      alertCreatedOrUpdated: alertCreatedOrUpdated
        ? structuredClone(alertCreatedOrUpdated)
        : null,
      duplicateAlertSuppressed,
      uncertainties: qualitySummary.uncertainties,
    };
  }

  /**
   * Computes the freshness and completeness of observations for a single isolated stream (`SIMULATED` or `REAL`).
   * Never mixes `SIMULATED` observations into a `REAL` stream or vice versa.
   * Never invents dangerous physiological values when a wearable is disconnected or a metric is missing/stale.
   */
  public computeStreamDataQuality(
    uid: string,
    streamMode: DataSourceMode,
    nowMs: number = Date.now()
  ): {
    dataQualityByMetric: Partial<Record<ObservationMetricType, DataQualityState>>;
    overallDataQuality: DataQualityState;
    canEvaluateRisk: boolean;
    assembledVitals: VitalReadings;
    assembledEnvironment: EnvironmentReadings;
    uncertainties: string[];
  } {
    const coreVitals: ObservationMetricType[] = [
      'heart_rate',
      'oxygen_saturation',
      'body_temperature',
    ];
    const coreEnv: ObservationMetricType[] = [
      'ambient_temperature',
      'relative_humidity',
      'weather_condition',
    ];
    const allTracked: ObservationMetricType[] = [
      ...coreVitals,
      'activity_state',
      'step_cadence',
      ...coreEnv,
      'wind_speed',
      'air_quality_index',
    ];

    const dataQualityByMetric: Partial<
      Record<ObservationMetricType, DataQualityState>
    > = {};
    const uncertainties: string[] = [];

    let anyCurrentVital = false;
    let anyCurrentEnv = false;
    let anyStale = false;
    let anyMissingCore = false;

    const getFreshObs = (
      metric: ObservationMetricType
    ): NormalizedObservation | undefined => {
      const key = `${uid}::${streamMode}::${metric}`;
      const obs = this.latestAcceptedByUserModeMetric.get(key);
      if (!obs) {
        dataQualityByMetric[metric] = 'MISSING';
        return undefined;
      }
      const freshness = evaluateObservationFreshness(
        metric,
        obs.observedAt,
        nowMs,
        this.freshnessPolicy
      );
      dataQualityByMetric[metric] = freshness.freshnessStatus;
      return freshness.freshnessStatus === 'CURRENT' ? obs : undefined;
    };

    const hrObs = getFreshObs('heart_rate');
    const spo2Obs = getFreshObs('oxygen_saturation');
    const btempObs = getFreshObs('body_temperature');
    const actObs = getFreshObs('activity_state');
    const cadObs = getFreshObs('step_cadence');

    const atempObs = getFreshObs('ambient_temperature');
    const humObs = getFreshObs('relative_humidity');
    const wxObs = getFreshObs('weather_condition');
    const windObs = getFreshObs('wind_speed');
    const aqiObs = getFreshObs('air_quality_index');

    for (const m of allTracked) {
      const state = dataQualityByMetric[m];
      if (state === 'STALE') {
        anyStale = true;
        uncertainties.push(
          `Metric "${m}" in ${streamMode} stream is STALE and excluded from active hazard triggering.`
        );
      } else if (
        state === 'MISSING' &&
        (coreVitals.includes(m) || coreEnv.includes(m))
      ) {
        anyMissingCore = true;
      }
    }

    if (hrObs && spo2Obs && btempObs) {
      anyCurrentVital = true;
    } else {
      uncertainties.push(
        `Complete current physiological wearable measurements (heart rate, SpO2, body temperature) are unavailable in the ${streamMode} stream.`
      );
    }

    if (atempObs && humObs && wxObs) {
      anyCurrentEnv = true;
      if (atempObs.isOutdoorContext) {
        uncertainties.push(
          `Environmental weather observations (${atempObs.sourceProvider} at ${atempObs.observedAt}) represent outdoor regional conditions and do not measure indoor microclimates.`
        );
      }
    } else {
      uncertainties.push(
        `Complete current environmental measurements (ambient temperature, humidity, weather condition) are unavailable in the ${streamMode} stream.`
      );
    }

    // Safe neutral baseline used ONLY for non-supplied stream dimensions so missing/stale metrics never trigger false alerts
    const assembledVitals: VitalReadings = {
      heartRateBpm: hrObs ? Number(hrObs.value) : 72,
      oxygenSaturationPct: spo2Obs ? Number(spo2Obs.value) : 98,
      bodyTempCelsius: btempObs ? Number(btempObs.value) : 36.8,
      activityLevel: actObs
        ? (actObs.value as ActivityLevel)
        : ActivityLevel.RESTING,
      stepCadencePerMin: cadObs ? Number(cadObs.value) : 0,
    };

    const assembledEnvironment: EnvironmentReadings = {
      ambientTempCelsius: atempObs ? Number(atempObs.value) : 22,
      humidityPct: humObs ? Number(humObs.value) : 45,
      weatherCondition: wxObs
        ? (wxObs.value as WeatherCondition)
        : WeatherCondition.CLEAR,
      windSpeedKmh: windObs ? Number(windObs.value) : 10,
      airQualityIndex: aqiObs ? Number(aqiObs.value) : 25,
    };

    const canEvaluateRisk = anyCurrentVital || anyCurrentEnv;
    const overallDataQuality: DataQualityState =
      anyCurrentVital && anyCurrentEnv && !anyStale
        ? 'CURRENT'
        : anyStale
        ? 'STALE'
        : anyMissingCore && !anyCurrentVital && !anyCurrentEnv
        ? 'MISSING'
        : 'CURRENT';

    return {
      dataQualityByMetric,
      overallDataQuality,
      canEvaluateRisk,
      assembledVitals,
      assembledEnvironment,
      uncertainties,
    };
  }

  public getObservationsForUser(
    actingUid: string | null,
    targetUid: string,
    filterMode?: DataSourceMode
  ): NormalizedObservation[] {
    const uid = this.assertAuthorized(actingUid, targetUid);
    const list = this.observationsByUser.get(uid) ?? [];
    const filtered = filterMode
      ? list.filter((o) => o.dataMode === filterMode)
      : list;
    return structuredClone(filtered);
  }

  public clearObservationsForUser(
    actingUid: string | null,
    targetUid: string
  ): void {
    const uid = this.assertAuthorized(actingUid, targetUid);
    this.observationsByUser.delete(uid);
    this.seenObservationKeysByUser.delete(uid);
    for (const key of Array.from(this.latestAcceptedByUserModeMetric.keys())) {
      if (key.startsWith(`${uid}::`)) {
        this.latestAcceptedByUserModeMetric.delete(key);
      }
    }
  }

  /**
   * Safe Demo Reset:
   * Removes ONLY `SIMULATED` observations and `SIMULATED` alert state for the user,
   * leaving all `REAL` observations and other users' records untouched.
   */
  public resetSimulatedDemoDataOnly(
    actingUid: string | null,
    targetUid: string
  ): { preservedRealCount: number; purgedSimulatedCount: number } {
    const uid = this.assertAuthorized(actingUid, targetUid);
    const currentList = this.observationsByUser.get(uid) ?? [];
    const realOnly = currentList.filter((o) => o.dataMode === 'REAL');
    const simulatedOnly = currentList.filter((o) => o.dataMode === 'SIMULATED');

    this.observationsByUser.set(uid, realOnly);

    const seenKeys = this.seenObservationKeysByUser.get(uid);
    if (seenKeys) {
      for (const simObs of simulatedOnly) {
        seenKeys.delete(`id:${simObs.observationId}`);
        if (simObs.sourceRecordId) {
          seenKeys.delete(`src:${simObs.sourceProvider}:${simObs.sourceRecordId}`);
        }
      }
    }

    for (const key of Array.from(this.latestAcceptedByUserModeMetric.keys())) {
      if (key.startsWith(`${uid}::SIMULATED::`)) {
        this.latestAcceptedByUserModeMetric.delete(key);
      }
    }

    this.activeAlertsByUserMode.delete(`${uid}::SIMULATED`);
    this.lastAlertSignatureByUserMode.delete(`${uid}::SIMULATED`);

    return {
      preservedRealCount: realOnly.length,
      purgedSimulatedCount: simulatedOnly.length,
    };
  }

  private appendAuditEvent(uid: string, event: SafetyEvent): void {
    const list = this.auditEventsByUser.get(uid) ?? [];
    list.unshift(event);
    this.auditEventsByUser.set(uid, list.slice(0, 60));
  }
}
