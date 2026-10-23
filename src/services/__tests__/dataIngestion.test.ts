import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FRESHNESS_POLICY,
  DataIngestionError,
  EnvironmentalDataProvider,
  SimulationDataProvider,
  TelemetryIngestionCoordinator,
  WearableDataProvider,
  evaluateObservationFreshness,
  mapWmoCodeToWeatherCondition,
  normalizeObservationUnitAndValue,
  sanitizeIngestionError,
  validateAndNormalizeObservation,
} from '../dataIngestionEngine';
import {
  AIExplanationServiceError,
  detectDataUncertainties,
  validateAIExplanationSchema,
} from '../geminiExplanationEngine';
import { SecureSafetyRepositorySimulator } from '../../repositories/safetyRepository';
import { DEFAULT_THRESHOLDS, evaluateRisk, SIMULATION_PRESETS } from '../../engine/riskEngine';
import { WeatherCondition } from '../../types/safety';

describe('Wearable & Environmental Data Integration Engine', () => {
  const userAlice = 'uid-alice-ingestion';
  const userBob = 'uid-bob-ingestion';
  const fixedNowMs = Date.parse('2026-05-15T14:00:00.000Z');
  const fixedNowIso = new Date(fixedNowMs).toISOString();

  it('1. validates normalized observation schema and rejects malformed IDs, missing fields, and cross-user spoofing', () => {
    const validRes = validateAndNormalizeObservation({
      raw: {
        observationId: 'obs-valid-001',
        authenticatedOwnerId: userAlice,
        metricType: 'heart_rate',
        value: 84,
        unit: 'bpm',
        observedAt: fixedNowIso,
        receivedAt: fixedNowIso,
        sourceProvider: 'simulation-synthetic-provider',
        sourceRecordId: 'src-001',
        claimedDataMode: 'SIMULATED',
      },
      authenticatedUid: userAlice,
      authoritativeProviderMode: 'SIMULATED',
      providerVerifiedReal: false,
      nowMs: fixedNowMs,
    });

    expect(validRes.ok).toBe(true);
    if (validRes.ok) {
      expect(validRes.observation.observationId).toBe('obs-valid-001');
      expect(validRes.observation.authenticatedOwnerId).toBe(userAlice);
      expect(validRes.observation.dataMode).toBe('SIMULATED');
      expect(validRes.observation.validationStatus).toBe('VALIDATED');
      expect(validRes.observation.freshnessStatus).toBe('CURRENT');
    }

    // Reject cross-user authenticatedOwnerId spoofing
    const crossUserRes = validateAndNormalizeObservation({
      raw: {
        observationId: 'obs-spoof-001',
        authenticatedOwnerId: userBob,
        metricType: 'heart_rate',
        value: 84,
        unit: 'bpm',
        observedAt: fixedNowIso,
        sourceProvider: 'simulation-synthetic-provider',
      },
      authenticatedUid: userAlice,
      authoritativeProviderMode: 'SIMULATED',
      providerVerifiedReal: false,
      nowMs: fixedNowMs,
    });

    expect(crossUserRes.ok).toBe(false);
    if (!crossUserRes.ok) {
      expect(crossUserRes.validationStatus).toBe('REJECTED_PROVENANCE');
    }

    // Reject malformed observationId with spaces/script tags
    const badIdRes = validateAndNormalizeObservation({
      raw: {
        observationId: 'obs <script>bad</script>',
        authenticatedOwnerId: userAlice,
        metricType: 'heart_rate',
        value: 80,
        unit: 'bpm',
        observedAt: fixedNowIso,
        sourceProvider: 'simulation-synthetic-provider',
      },
      authenticatedUid: userAlice,
      authoritativeProviderMode: 'SIMULATED',
      providerVerifiedReal: false,
      nowMs: fixedNowMs,
    });

    expect(badIdRes.ok).toBe(false);
    if (!badIdRes.ok) {
      expect(badIdRes.validationStatus).toBe('REJECTED_SCHEMA');
    }
  });

  it('2. normalizes compatible units (°F -> °C, mph/m/s -> km/h) and rejects unsupported units or out-of-bounds values', () => {
    // 98.6 °F -> 37.0 °C
    const bodyTempF = normalizeObservationUnitAndValue('body_temperature', 98.6, 'fahrenheit');
    expect(bodyTempF.ok).toBe(true);
    if (bodyTempF.ok) {
      expect(bodyTempF.canonicalUnit).toBe('celsius');
      expect(bodyTempF.normalizedValue).toBe(37);
      expect(bodyTempF.originalUnit).toBe('fahrenheit');
    }

    // 104.0 °F -> 40.0 °C
    const highFeverF = normalizeObservationUnitAndValue('body_temperature', 104, 'fahrenheit');
    expect(highFeverF.ok).toBe(true);
    if (highFeverF.ok) {
      expect(highFeverF.normalizedValue).toBe(40);
    }

    // 25 mph -> ~40.2 km/h
    const windMph = normalizeObservationUnitAndValue('wind_speed', 25, 'mph');
    expect(windMph.ok).toBe(true);
    if (windMph.ok) {
      expect(windMph.canonicalUnit).toBe('kmh');
      expect(windMph.normalizedValue).toBeCloseTo(40.2, 1);
    }

    // 10 m/s -> 36.0 km/h
    const windMs = normalizeObservationUnitAndValue('wind_speed', 10, 'ms');
    expect(windMs.ok).toBe(true);
    if (windMs.ok) {
      expect(windMs.canonicalUnit).toBe('kmh');
      expect(windMs.normalizedValue).toBe(36);
    }

    // Reject impossible heart rate (e.g., 450 bpm)
    const impossibleHr = normalizeObservationUnitAndValue('heart_rate', 450, 'bpm');
    expect(impossibleHr.ok).toBe(false);
    if (!impossibleHr.ok) {
      expect(impossibleHr.validationStatus).toBe('REJECTED_RANGE');
    }

    // Reject incompatible unit (e.g., fahrenheit for heart_rate)
    const wrongUnit = normalizeObservationUnitAndValue('heart_rate', 98.6, 'fahrenheit');
    expect(wrongUnit.ok).toBe(false);
    if (!wrongUnit.ok) {
      expect(wrongUnit.validationStatus).toBe('REJECTED_UNIT');
    }
  });

  it('3. enforces server-authoritative provenance and prevents client flags from marking simulated readings as REAL', () => {
    const simProvider = new SimulationDataProvider();
    const wearableScaffold = new WearableDataProvider({
      serverVerifiedOAuthConfigured: false,
    });
    const coordinator = new TelemetryIngestionCoordinator({
      providers: [simProvider, wearableScaffold],
    });

    // If client payload claims claimedDataMode: 'REAL' on SimulationDataProvider, it is rejected with REJECTED_PROVENANCE
    const spoofBatch = coordinator.ingestBatch({
      actingUid: userAlice,
      targetUid: userAlice,
      providerId: simProvider.providerId,
      nowMs: fixedNowMs,
      rawObservations: [
        {
          observationId: 'obs-client-fake-real-1',
          authenticatedOwnerId: userAlice,
          metricType: 'heart_rate',
          value: 92,
          unit: 'bpm',
          observedAt: fixedNowIso,
          sourceProvider: simProvider.providerId,
          claimedDataMode: 'REAL',
        },
        {
          observationId: 'obs-client-honest-sim-1',
          authenticatedOwnerId: userAlice,
          metricType: 'heart_rate',
          value: 92,
          unit: 'bpm',
          observedAt: fixedNowIso,
          sourceProvider: simProvider.providerId,
        },
      ],
    });

    expect(spoofBatch.rejected).toHaveLength(1);
    expect(spoofBatch.rejected[0].validationStatus).toBe('REJECTED_PROVENANCE');
    expect(spoofBatch.accepted).toHaveLength(1);
    expect(spoofBatch.accepted[0].dataMode).toBe('SIMULATED');

    // Direct validation rejects REAL claim when provider is unverified REAL
    const unverifiedRealAttempt = validateAndNormalizeObservation({
      raw: {
        observationId: 'obs-unverified-real',
        authenticatedOwnerId: userAlice,
        metricType: 'heart_rate',
        value: 80,
        unit: 'bpm',
        observedAt: fixedNowIso,
        sourceProvider: 'wearable-oauth-bridge',
        claimedDataMode: 'REAL',
      },
      authenticatedUid: userAlice,
      authoritativeProviderMode: 'REAL',
      providerVerifiedReal: false,
      nowMs: fixedNowMs,
    });

    expect(unverifiedRealAttempt.ok).toBe(false);
    if (!unverifiedRealAttempt.ok) {
      expect(unverifiedRealAttempt.validationStatus).toBe('REJECTED_PROVENANCE');
    }
  });

  it('4. isolates SIMULATED and REAL observation streams without silent mixing', async () => {
    const simProvider = new SimulationDataProvider();
    const envProvider = new EnvironmentalDataProvider({
      customWeatherFetcher: async () => ({
        ambientTempCelsius: 31.5,
        humidityPct: 62,
        windSpeedKmh: 18,
        weatherCondition: WeatherCondition.PARTLY_CLOUDY,
        airQualityIndex: 42,
        observedAtIso: fixedNowIso,
      }),
    });

    await envProvider.connectAndAuthorize({
      authenticatedUid: userAlice,
      consentGranted: true,
      coarseLatitude: 37.7749,
      coarseLongitude: -122.4194,
    });

    const coordinator = new TelemetryIngestionCoordinator({
      providers: [simProvider, envProvider],
    });

    await coordinator.syncFromProvider({
      actingUid: userAlice,
      targetUid: userAlice,
      providerId: simProvider.providerId,
      nowMs: fixedNowMs,
    });

    await coordinator.syncFromProvider({
      actingUid: userAlice,
      targetUid: userAlice,
      providerId: envProvider.providerId,
      nowMs: fixedNowMs,
    });

    const simOnly = coordinator.getObservationsForUser(userAlice, userAlice, 'SIMULATED');
    const realOnly = coordinator.getObservationsForUser(userAlice, userAlice, 'REAL');

    expect(simOnly.length).toBeGreaterThan(0);
    expect(realOnly.length).toBeGreaterThan(0);
    expect(simOnly.every((o) => o.dataMode === 'SIMULATED')).toBe(true);
    expect(realOnly.every((o) => o.dataMode === 'REAL')).toBe(true);

    // REAL stream quality check must show physiological vitals as MISSING because only SIMULATED vitals were synced
    const realQuality = coordinator.computeStreamDataQuality(userAlice, 'REAL', fixedNowMs);
    expect(realQuality.dataQualityByMetric.heart_rate).toBe('MISSING');
    expect(realQuality.dataQualityByMetric.ambient_temperature).toBe('CURRENT');
  });

  it('5. detects duplicate observations and quarantines out-of-order observations without overwriting newer state', () => {
    const simProvider = new SimulationDataProvider();
    const coordinator = new TelemetryIngestionCoordinator({
      providers: [simProvider],
    });

    const tNewer = new Date(fixedNowMs).toISOString();
    const tOlder = new Date(fixedNowMs - 60_000).toISOString();

    const batch = coordinator.ingestBatch({
      actingUid: userAlice,
      targetUid: userAlice,
      providerId: simProvider.providerId,
      nowMs: fixedNowMs,
      rawObservations: [
        {
          observationId: 'obs-hr-100',
          authenticatedOwnerId: userAlice,
          metricType: 'heart_rate',
          value: 105,
          unit: 'bpm',
          observedAt: tNewer,
          sourceRecordId: 'rec-hr-100',
        },
        // Duplicate observationId
        {
          observationId: 'obs-hr-100',
          authenticatedOwnerId: userAlice,
          metricType: 'heart_rate',
          value: 105,
          unit: 'bpm',
          observedAt: tNewer,
          sourceRecordId: 'rec-hr-101',
        },
        // Duplicate sourceRecordId
        {
          observationId: 'obs-hr-102',
          authenticatedOwnerId: userAlice,
          metricType: 'heart_rate',
          value: 105,
          unit: 'bpm',
          observedAt: tNewer,
          sourceRecordId: 'rec-hr-100',
        },
        // Out-of-order older timestamp arriving after newer reading
        {
          observationId: 'obs-hr-older',
          authenticatedOwnerId: userAlice,
          metricType: 'heart_rate',
          value: 62,
          unit: 'bpm',
          observedAt: tOlder,
          sourceRecordId: 'rec-hr-older',
        },
      ],
    });

    expect(batch.accepted).toHaveLength(1);
    expect(batch.accepted[0].value).toBe(105);
    expect(batch.rejected).toHaveLength(3);
    expect(batch.rejected[0].validationStatus).toBe('REJECTED_DUPLICATE');
    expect(batch.rejected[1].validationStatus).toBe('REJECTED_DUPLICATE');
    expect(batch.rejected[2].validationStatus).toBe('QUARANTINED_OUT_OF_ORDER');

    // Verify the active stream value was NOT overwritten by the older 62 bpm reading
    const streamState = coordinator.computeStreamDataQuality(userAlice, 'SIMULATED', fixedNowMs);
    expect(streamState.assembledVitals.heartRateBpm).toBe(105);
  });

  it('6. classifies stale and future-skewed timestamps accurately and excludes stale metrics from hazard triggering', () => {
    // Physiological reading 10 minutes old (> 5 min threshold) -> STALE
    const stalePhys = evaluateObservationFreshness(
      'heart_rate',
      new Date(fixedNowMs - 10 * 60 * 1000).toISOString(),
      fixedNowMs,
      DEFAULT_FRESHNESS_POLICY
    );
    expect(stalePhys.freshnessStatus).toBe('STALE');

    // Environmental reading 15 minutes old (< 30 min threshold) -> CURRENT
    const currentEnv = evaluateObservationFreshness(
      'ambient_temperature',
      new Date(fixedNowMs - 15 * 60 * 1000).toISOString(),
      fixedNowMs,
      DEFAULT_FRESHNESS_POLICY
    );
    expect(currentEnv.freshnessStatus).toBe('CURRENT');

    // Future timestamp 5 minutes ahead (> 60s skew tolerance) -> INVALID
    const futureSkew = evaluateObservationFreshness(
      'heart_rate',
      new Date(fixedNowMs + 5 * 60 * 1000).toISOString(),
      fixedNowMs,
      DEFAULT_FRESHNESS_POLICY
    );
    expect(futureSkew.freshnessStatus).toBe('INVALID');

    // Verify stale high-risk readings do NOT trigger an emergency assessment
    const simProvider = new SimulationDataProvider();
    const coordinator = new TelemetryIngestionCoordinator({
      providers: [simProvider],
    });
    const staleIso = new Date(fixedNowMs - 12 * 60 * 1000).toISOString();

    const batch = coordinator.ingestBatch({
      actingUid: userAlice,
      targetUid: userAlice,
      providerId: simProvider.providerId,
      nowMs: fixedNowMs,
      rawObservations: [
        {
          observationId: 'obs-stale-hr-critical',
          authenticatedOwnerId: userAlice,
          metricType: 'heart_rate',
          value: 175,
          unit: 'bpm',
          observedAt: staleIso,
        },
      ],
    });

    expect(batch.overallDataQuality).toBe('STALE');
    expect(batch.assessmentTriggered).toBe(false);
    expect(batch.alertCreatedOrUpdated).toBeNull();
    expect(batch.uncertainties.some((u) => u.includes('STALE'))).toBe(true);
  });

  it('7. rejects unsupported metrics and invalid timestamps cleanly', () => {
    const unsupportedMetric = validateAndNormalizeObservation({
      raw: {
        observationId: 'obs-unsupported-1',
        authenticatedOwnerId: userAlice,
        metricType: 'electroencephalogram_alpha',
        value: 12,
        unit: 'bpm',
        observedAt: fixedNowIso,
        sourceProvider: 'simulation-synthetic-provider',
      },
      authenticatedUid: userAlice,
      authoritativeProviderMode: 'SIMULATED',
      providerVerifiedReal: false,
      nowMs: fixedNowMs,
    });

    expect(unsupportedMetric.ok).toBe(false);
    if (!unsupportedMetric.ok) {
      expect(unsupportedMetric.validationStatus).toBe('REJECTED_SCHEMA');
    }

    const invalidDate = validateAndNormalizeObservation({
      raw: {
        observationId: 'obs-baddate-1',
        authenticatedOwnerId: userAlice,
        metricType: 'heart_rate',
        value: 75,
        unit: 'bpm',
        observedAt: 'not-an-iso-timestamp',
        sourceProvider: 'simulation-synthetic-provider',
      },
      authenticatedUid: userAlice,
      authoritativeProviderMode: 'SIMULATED',
      providerVerifiedReal: false,
      nowMs: fixedNowMs,
    });

    expect(invalidDate.ok).toBe(false);
    if (!invalidDate.ok) {
      expect(invalidDate.validationStatus).toBe('REJECTED_SCHEMA');
    }
  });

  it('8. handles wearable provider authorization failures, missing consent, and revocation safely', async () => {
    const wearable = new WearableDataProvider({
      serverVerifiedOAuthConfigured: true,
    });

    // Missing consent must fail with CONSENT_REQUIRED
    await expect(
      wearable.connectAndAuthorize({
        authenticatedUid: userAlice,
        consentGranted: false,
        authTokenOrCode: 'valid-code',
      })
    ).rejects.toThrow(/consent is required/i);
    expect(wearable.getConnectionStatus()).toBe('DISCONNECTED');

    // Invalid token must fail with PROVIDER_AUTH_FAILED
    await expect(
      wearable.connectAndAuthorize({
        authenticatedUid: userAlice,
        consentGranted: true,
        authTokenOrCode: 'EXPIRED_TOKEN',
      })
    ).rejects.toThrow(/authorization failed/i);
    expect(wearable.getConnectionStatus()).toBe('ERROR');

    // Valid authorization succeeds
    const diag = await wearable.connectAndAuthorize({
      authenticatedUid: userAlice,
      consentGranted: true,
      authTokenOrCode: 'valid-oauth-grant-token',
    });
    expect(diag.connectionStatus).toBe('CONNECTED');
    expect(wearable.isVerifiedRealProvider()).toBe(true);

    // Revoking authorization blocks future fetches
    await wearable.revokeAuthorization();
    expect(wearable.getConnectionStatus()).toBe('REVOKED');
    expect(wearable.isVerifiedRealProvider()).toBe(false);

    await expect(
      wearable.fetchObservations({ authenticatedUid: userAlice, nowMs: fixedNowMs })
    ).rejects.toThrow(/revoked/i);
  });

  it('9. enforces coarse-location rounding, outdoor context labeling, and handles weather API rate limits/timeouts', async () => {
    let capturedCoords: { coarseLatitude: number; coarseLongitude: number } | null = null;
    const envProvider = new EnvironmentalDataProvider({
      customWeatherFetcher: async (coords) => {
        capturedCoords = coords;
        return {
          ambientTempCelsius: 37.2,
          humidityPct: 55,
          windSpeedKmh: 22,
          weatherCondition: mapWmoCodeToWeatherCondition(0, 37.2, 55),
          airQualityIndex: 60,
          observedAtIso: fixedNowIso,
        };
      },
    });

    // Fine GPS coordinates (37.774929, -122.419416) must be coarsened to 2 decimals (37.77, -122.42)
    await envProvider.connectAndAuthorize({
      authenticatedUid: userAlice,
      consentGranted: true,
      coarseLatitude: 37.774929,
      coarseLongitude: -122.419416,
    });

    const records = await envProvider.fetchObservations({
      authenticatedUid: userAlice,
      nowMs: fixedNowMs,
    });

    expect(capturedCoords).toEqual({ coarseLatitude: 37.77, coarseLongitude: -122.42 });
    expect(records.every((r) => r.isOutdoorContext === true)).toBe(true);

    // Rate-limit / timeout error propagation without crashing
    const failingEnvProvider = new EnvironmentalDataProvider({
      customWeatherFetcher: async () => {
        throw new DataIngestionError(
          'RATE_LIMITED',
          'Environmental weather service HTTP 429 rate limit exceeded.',
          429
        );
      },
    });
    await failingEnvProvider.connectAndAuthorize({
      authenticatedUid: userAlice,
      consentGranted: true,
    });

    await expect(
      failingEnvProvider.fetchObservations({ authenticatedUid: userAlice })
    ).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      httpStatus: 429,
    });
  });

  it('10. enforces strict user ownership and blocks cross-user observation access in both coordinator and repository', () => {
    const simProvider = new SimulationDataProvider();
    const coordinator = new TelemetryIngestionCoordinator({
      providers: [simProvider],
    });

    coordinator.ingestBatch({
      actingUid: userAlice,
      targetUid: userAlice,
      providerId: simProvider.providerId,
      nowMs: fixedNowMs,
      rawObservations: [
        {
          observationId: 'obs-alice-private-1',
          authenticatedOwnerId: userAlice,
          metricType: 'heart_rate',
          value: 74,
          unit: 'bpm',
          observedAt: fixedNowIso,
        },
      ],
    });

    // Bob cannot read Alice's observations from the coordinator
    expect(() =>
      coordinator.getObservationsForUser(userBob, userAlice)
    ).toThrow(/PERMISSION_DENIED/);

    // Bob cannot ingest into Alice's account
    expect(() =>
      coordinator.ingestBatch({
        actingUid: userBob,
        targetUid: userAlice,
        providerId: simProvider.providerId,
        rawObservations: [],
      })
    ).toThrow(/PERMISSION_DENIED/);

    // Repository simulator also enforces ownership and blocks client-fabricated REAL provenance
    const repo = new SecureSafetyRepositorySimulator();
    repo.createProfile(userAlice, userAlice, {
      uid: userAlice,
      email: 'alice@vitaguard.example',
      displayName: 'Alice',
      simulationNoticeAccepted: true,
      createdAt: fixedNowIso,
      updatedAt: fixedNowIso,
    });
    const aliceObs = coordinator.getObservationsForUser(userAlice, userAlice)[0];
    repo.saveNormalizedObservationFromClient(userAlice, userAlice, aliceObs);

    expect(repo.getNormalizedObservations(userAlice, userAlice)).toHaveLength(1);
    expect(() =>
      repo.getNormalizedObservations(userBob, userAlice)
    ).toThrow(/PERMISSION_DENIED/);

    // Client cannot directly write dataMode: 'REAL' to Firestore simulator
    expect(() =>
      repo.saveNormalizedObservationFromClient(userAlice, userAlice, {
        ...aliceObs,
        observationId: 'obs-client-fake-real-direct',
        dataMode: 'REAL',
      })
    ).toThrow(/PERMISSION_DENIED/);
  });

  it('11. never classifies a disconnected wearable as a medical emergency and triggers deterministic alerts without duplicates', async () => {
    const simProvider = new SimulationDataProvider({
      initialVitals: SIMULATION_PRESETS[3].vitals, // Critical Heat & Exertion Emergency preset
      initialEnvironment: SIMULATION_PRESETS[3].environment,
    });
    const wearable = new WearableDataProvider();
    const coordinator = new TelemetryIngestionCoordinator({
      providers: [simProvider, wearable],
    });

    // Wearable is DISCONNECTED -> stream quality for REAL has missing vitals, no emergency triggered
    const disconnectedStream = coordinator.computeStreamDataQuality(
      userAlice,
      'REAL',
      fixedNowMs
    );
    expect(disconnectedStream.canEvaluateRisk).toBe(false);
    expect(disconnectedStream.overallDataQuality).toBe('MISSING');

    // Sync high-risk scenario from SimulationDataProvider -> triggers deterministic risk engine & alert
    const firstSync = await coordinator.syncFromProvider({
      actingUid: userAlice,
      targetUid: userAlice,
      providerId: simProvider.providerId,
      thresholds: DEFAULT_THRESHOLDS,
      nowMs: fixedNowMs,
    });

    expect(firstSync.assessmentTriggered).toBe(true);
    expect(firstSync.assessment?.riskLevel).toBe('critical');
    expect(firstSync.alertCreatedOrUpdated).not.toBeNull();
    expect(firstSync.duplicateAlertSuppressed).toBe(false);

    // Second sync with identical risk state suppresses duplicate alert creation
    const secondSync = await coordinator.syncFromProvider({
      actingUid: userAlice,
      targetUid: userAlice,
      providerId: simProvider.providerId,
      thresholds: DEFAULT_THRESHOLDS,
      nowMs: fixedNowMs + 5000,
    });

    expect(secondSync.assessmentTriggered).toBe(true);
    expect(secondSync.duplicateAlertSuppressed).toBe(true);
    expect(secondSync.alertCreatedOrUpdated?.id).toBe(
      firstSync.alertCreatedOrUpdated?.id
    );
  });

  it('12. integrates ingestion uncertainties with Gemini explanation validator and redacts sensitive measurements from logs', () => {
    const assessment = evaluateRisk(
      SIMULATION_PRESETS[1].vitals,
      SIMULATION_PRESETS[1].environment,
      DEFAULT_THRESHOLDS
    );

    const uncertainties = detectDataUncertainties({
      assessment,
      vitals: SIMULATION_PRESETS[1].vitals,
      environment: SIMULATION_PRESETS[1].environment,
      dataMode: 'SIMULATED',
      injectionDetected: false,
      ingestionUncertainties: [
        'Metric "oxygen_saturation" in SIMULATED stream is STALE and excluded from active hazard triggering.',
      ],
      environmentalSourceMeta: {
        providerId: 'open-meteo-weather-proxy',
        observedAt: fixedNowIso,
      },
      nowMs: Date.parse(assessment.evaluatedAt),
    });

    expect(
      uncertainties.some((u) => u.includes('open-meteo-weather-proxy'))
    ).toBe(true);
    expect(
      uncertainties.some((u) => u.includes('oxygen_saturation'))
    ).toBe(true);

    // Reject AI output that falsely claims a live physical wearable is streaming while in SIMULATED mode
    expect(() =>
      validateAIExplanationSchema(
        {
          summary:
            'Your connected physical wearable is streaming elevated heart rate telemetry.',
          contributingFactors: ['Elevated heart rate'],
          triggeredRules: [],
          uncertainties: ['Simulated mode'],
          recommendedActions: ['Rest in shade'],
          limitations:
            'Informational only and not a medical diagnosis.',
          dataMode: 'SIMULATED',
          generatedAt: fixedNowIso,
        },
        {
          assessment,
          verifiedDataMode: 'SIMULATED',
          serverUncertainties: uncertainties,
        }
      )
    ).toThrow(AIExplanationServiceError);

    // Verify privacy-safe error sanitization scrubs BPM, SpO2, °C, lat/lon, and tokens
    const rawSensitiveError =
      'Failed to parse payload: heartRate=168 bpm, SpO2=88%, temp=39.4°C at lat=37.774929, lon=-122.419416 with access_token=ya29.secret_token_123';
    const scrubbed = sanitizeIngestionError(rawSensitiveError);
    expect(scrubbed).not.toContain('168 bpm');
    expect(scrubbed).not.toContain('37.774929');
    expect(scrubbed).not.toContain('-122.419416');
    expect(scrubbed).not.toContain('ya29.secret_token_123');
    expect(scrubbed).toContain('[redacted-measurement]');
    expect(scrubbed).toContain('lat:[redacted]');
    expect(scrubbed).toContain('access_token:[REDACTED]');
  });
});
