import { auth } from '../lib/firebase';
import {
  AIExplanationRequestPayload,
  EnvironmentReadings,
  ExplanationReport,
  PersistedAIExplanation,
  RiskAssessment,
  RiskLevel,
  VitalReadings,
} from '../types/safety';
import {
  AIExplanationServiceError,
  computeAssessmentFingerprint,
  detectDataUncertainties,
  redactSecretsFromText,
  validateAIExplanationSchema,
  validateExplanationRequest,
} from './geminiExplanationEngine';

/**
 * Architecture contract for Safety Explanation Providers.
 * Uses DeterministicExplanationProvider locally and ServerSideGeminiExplanationProvider
 * calling `/api/ai/explain-assessment` without changing any component interfaces.
 */
export interface SafetyExplanationProvider {
  readonly providerId: string;
  generateExplanation(
    assessment: RiskAssessment,
    vitals: VitalReadings,
    environment: EnvironmentReadings
  ): ExplanationReport;
}

export class DeterministicExplanationProvider implements SafetyExplanationProvider {
  public readonly providerId = 'deterministic-rule-synthesizer-v1';

  generateExplanation(
    assessment: RiskAssessment,
    vitals: VitalReadings,
    environment: EnvironmentReadings
  ): ExplanationReport {
    const { riskLevel, overallScore, triggeredRules, heatIndexCelsius } = assessment;
    const activityText = vitals.activityLevel.replace(/_/g, ' ');
    const weatherText = environment.weatherCondition.replace(/_/g, ' ');

    let headline = 'Nominal Physiological & Environmental Alignment';
    if (riskLevel === RiskLevel.CRITICAL) {
      headline = `Critical Safety Threshold Breach: ${assessment.primaryConcern}`;
    } else if (riskLevel === RiskLevel.HIGH) {
      headline = `High Risk Pattern Detected: ${assessment.primaryConcern}`;
    } else if (riskLevel === RiskLevel.MODERATE) {
      headline = `Moderate Advisory: ${assessment.primaryConcern}`;
    }

    const executiveSummary =
      triggeredRules.length === 0
        ? `Composite risk score is ${overallScore}/100 (Low). Simulated heart rate (${vitals.heartRateBpm} BPM), oxygen saturation (${vitals.oxygenSaturationPct}%), and core temperature (${vitals.bodyTempCelsius.toFixed(1)}°C) remain well-regulated during ${activityText} in ${environment.ambientTempCelsius}°C ${weatherText} conditions.`
        : `Composite risk score is ${overallScore}/100 (${riskLevel.toUpperCase()}). The rule engine triggered ${triggeredRules.length} active factor(s), led by "${assessment.primaryConcern}". Immediate review of current activity (${activityText}) and environmental exposure (${environment.ambientTempCelsius}°C, feels like ${heatIndexCelsius}°C) is recommended.`;

    const physiologicalCorrelation = `Simulated Heart Rate is ${vitals.heartRateBpm} BPM (${vitals.stepCadencePerMin} steps/min during ${activityText}), Blood Oxygen Saturation (SpO2) is ${vitals.oxygenSaturationPct}%, and Core Body Temperature is ${vitals.bodyTempCelsius.toFixed(1)}°C. ${
      vitals.oxygenSaturationPct < 92
        ? 'Reduced oxygen saturation alongside cardiovascular demand indicates impaired oxygen delivery in the simulated profile.'
        : vitals.bodyTempCelsius >= 38.0
        ? 'Elevated core temperature coupled with increased heart rate reflects simulated thermoregulatory strain.'
        : vitals.bodyTempCelsius <= 35.5
        ? 'Depressed core temperature indicates simulated cold-stress heat loss.'
        : 'Vital readings are being continuously cross-checked against activity-adjusted thresholds.'
    }`;

    const environmentalContext = `Ambient temperature is ${environment.ambientTempCelsius}°C with ${environment.humidityPct}% relative humidity (calculated Heat Index: ${heatIndexCelsius}°C) under ${weatherText} conditions and ${environment.windSpeedKmh} km/h wind. ${
      heatIndexCelsius >= 35
        ? 'High humidity and ambient heat substantially limit sweat evaporation, amplifying core temperature retention.'
        : environment.ambientTempCelsius <= 4
        ? 'Low ambient temperature and wind speed increase convective heat loss from exposed skin.'
        : 'Environmental conditions currently impose minimal external thermal load.'
    }`;

    const recommendedActions: string[] = [];
    if (riskLevel === RiskLevel.CRITICAL) {
      recommendedActions.push(
        'Acknowledge the active alert ("I am safe") immediately if you are conscious and out of danger.',
        'Cease physical exertion immediately and move to a climate-controlled, shaded, or sheltered environment.',
        'Review the simulated emergency contact escalation queue; in a real deployment, primary contacts would be alerted if unacknowledged.'
      );
    } else if (riskLevel === RiskLevel.HIGH) {
      recommendedActions.push(
        'Confirm your safety status using the "I am safe" check-in button to halt escalation.',
        'Pause strenuous activity and transition to a resting posture in a cooler or sheltered area.',
        'Hydrate and monitor simulated SpO2 and core temperature recovery over the next 10–15 minutes.'
      );
    } else if (riskLevel === RiskLevel.MODERATE) {
      recommendedActions.push(
        'Reduce exertion intensity or take a scheduled rest break.',
        'Increase fluid intake to compensate for warm or humid ambient conditions.',
        'Confirm check-in status if prompted by the alert panel.'
      );
    } else {
      recommendedActions.push(
        'Maintain current pace and standard hydration intervals.',
        'Use the Live Simulation Panel to test how sudden weather shifts or exertion spikes affect risk classification.'
      );
    }

    return {
      generatedAt: assessment.evaluatedAt,
      engineMode: 'deterministic_baseline',
      headline,
      executiveSummary,
      physiologicalCorrelation,
      environmentalContext,
      recommendedActions,
      confidenceNote: `Deterministic Rule Engine v1.2 · ${triggeredRules.length} rule(s) matched · Authoritative Classification Source`,
      disclaimer:
        'SIMULATION ONLY — NOT MEDICAL ADVICE: All readings, risk classifications, and explanations are generated from user-controlled simulated inputs for software demonstration. This system does not diagnose medical conditions or contact real emergency services.',
    };
  }
}

export const defaultExplanationProvider: SafetyExplanationProvider =
  new DeterministicExplanationProvider();

export function generateSafetyExplanation(
  assessment: RiskAssessment,
  vitals: VitalReadings,
  environment: EnvironmentReadings
): ExplanationReport {
  return defaultExplanationProvider.generateExplanation(assessment, vitals, environment);
}


const clientExplanationCache = new Map<string, PersistedAIExplanation>();

export function clearClientExplanationCache(): void {
  clientExplanationCache.clear();
}

/**
 * Requests a contextual AI explanation from the trusted server-side Gemini endpoint (`/api/ai/explain-assessment`).
 * - Never exposes or uses any Gemini API key in client code.
 * - Uses per-user fingerprint caching to avoid duplicate API calls for unchanged assessments.
 * - Validates the server response against `validateAIExplanationSchema`.
 * - Never silently fabricates AI responses if the backend or Gemini API is unavailable.
 */
export async function requestContextualAIExplanation(
  request: AIExplanationRequestPayload
): Promise<PersistedAIExplanation> {
  const { validated, sanitizedNote, verifiedDataMode } =
    validateExplanationRequest(request);

  const fingerprint = computeAssessmentFingerprint(
    validated.assessment,
    validated.vitals,
    validated.environment,
    verifiedDataMode,
    sanitizedNote.sanitizedNote
  );

  const cacheKey = `${validated.actingUid}::${fingerprint}`;
  if (!validated.forceRegenerate && clientExplanationCache.has(cacheKey)) {
    const cached = clientExplanationCache.get(cacheKey)!;
    return {
      ...structuredClone(cached),
      cached: true,
    };
  }

  let idToken = '';
  try {
    if (auth.currentUser) {
      idToken = await auth.currentUser.getIdToken();
    }
  } catch {
    // Token optional when using local vault auth; server still validates X-Authenticated-Uid & payload
  }

  let response: Response;
  try {
    response = await fetch('/api/ai/explain-assessment', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        'X-VitaGuard-Uid': validated.actingUid || '',
      },
      body: JSON.stringify(validated),
    });
  } catch (networkErr) {
    const msg = networkErr instanceof Error ? networkErr.message : String(networkErr);
    throw new AIExplanationServiceError(
      'AI_SERVICE_UNAVAILABLE',
      `Unable to reach the server-side Gemini explanation endpoint (${redactSecretsFromText(
        msg
      )}). Deterministic risk engine explanation remains active.`,
      503
    );
  }

  let bodyJson: Record<string, unknown> | null = null;
  try {
    bodyJson = (await response.json()) as Record<string, unknown>;
  } catch {
    throw new AIExplanationServiceError(
      'AI_SERVICE_UNAVAILABLE',
      `Server returned non-JSON response (HTTP ${response.status}). Deterministic risk engine explanation remains active.`,
      response.status || 502
    );
  }

  if (!response.ok) {
    const code =
      typeof bodyJson?.code === 'string'
        ? (bodyJson.code as AIExplanationServiceError['code'])
        : response.status === 401
        ? 'UNAUTHENTICATED'
        : response.status === 403
        ? 'PERMISSION_DENIED'
        : response.status === 429
        ? 'RATE_LIMITED'
        : response.status === 504
        ? 'AI_TIMEOUT'
        : 'AI_SERVICE_UNAVAILABLE';
    const message =
      typeof bodyJson?.error === 'string'
        ? bodyJson.error
        : `AI explanation request failed with status ${response.status}.`;
    throw new AIExplanationServiceError(code, message, response.status);
  }

  const rawExplanation = bodyJson?.explanation ?? bodyJson;
  const serverUncertainties = detectDataUncertainties({
    assessment: validated.assessment,
    vitals: validated.vitals,
    environment: validated.environment,
    dataMode: verifiedDataMode,
    injectionDetected: sanitizedNote.injectionDetected,
  });

  // Re-validate strict schema on the client boundary
  const coreValidated = validateAIExplanationSchema(
    {
      summary: (rawExplanation as Record<string, unknown>)?.summary,
      contributingFactors: (rawExplanation as Record<string, unknown>)?.contributingFactors,
      triggeredRules: (rawExplanation as Record<string, unknown>)?.triggeredRules,
      uncertainties: (rawExplanation as Record<string, unknown>)?.uncertainties,
      recommendedActions: (rawExplanation as Record<string, unknown>)?.recommendedActions,
      limitations: (rawExplanation as Record<string, unknown>)?.limitations,
      dataMode: (rawExplanation as Record<string, unknown>)?.dataMode,
      generatedAt: (rawExplanation as Record<string, unknown>)?.generatedAt,
    },
    {
      assessment: validated.assessment,
      verifiedDataMode,
      serverUncertainties,
      serverGeneratedAtIso:
        typeof (rawExplanation as Record<string, unknown>)?.generatedAt === 'string'
          ? ((rawExplanation as Record<string, unknown>).generatedAt as string)
          : new Date().toISOString(),
    }
  );

  const persisted: PersistedAIExplanation = {
    ...coreValidated,
    explanationId:
      typeof (rawExplanation as Record<string, unknown>)?.explanationId === 'string'
        ? ((rawExplanation as Record<string, unknown>).explanationId as string)
        : `ai-exp-${validated.assessmentId}-${fingerprint.slice(-8)}`,
    assessmentId: validated.assessmentId,
    assessmentFingerprint: fingerprint,
    userId: validated.actingUid!,
    riskLevelSnapshot: validated.assessment.riskLevel,
    overallScoreSnapshot: validated.assessment.overallScore,
    modelId:
      typeof (rawExplanation as Record<string, unknown>)?.modelId === 'string'
        ? ((rawExplanation as Record<string, unknown>).modelId as string)
        : 'gemini-3.8-flash',
    promptVersion:
      typeof (rawExplanation as Record<string, unknown>)?.promptVersion === 'string'
        ? ((rawExplanation as Record<string, unknown>).promptVersion as string)
        : 'vitaguard-explain-v3.1.0',
    schemaVersion:
      typeof (rawExplanation as Record<string, unknown>)?.schemaVersion === 'string'
        ? ((rawExplanation as Record<string, unknown>).schemaVersion as string)
        : 'ai-explanation-schema-v1.0',
    cached: Boolean((rawExplanation as Record<string, unknown>)?.cached),
    promptInjectionDetected: sanitizedNote.injectionDetected,
  };

  clientExplanationCache.set(cacheKey, structuredClone(persisted));
  return persisted;
}

