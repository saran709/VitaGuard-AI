export enum RiskLevel {
  LOW = 'low',
  MODERATE = 'moderate',
  HIGH = 'high',
  CRITICAL = 'critical',
}

export enum ActivityLevel {
  RESTING = 'resting',
  LIGHT_WALKING = 'light_walking',
  MODERATE_EXERCISE = 'moderate_exercise',
  INTENSE_EXERTION = 'intense_exertion',
}

export enum WeatherCondition {
  CLEAR = 'clear',
  PARTLY_CLOUDY = 'partly_cloudy',
  HIGH_HUMIDITY = 'high_humidity',
  HEATWAVE = 'heatwave',
  HEAVY_RAIN = 'heavy_rain',
  FREEZING_WIND = 'freezing_wind',
}

export enum EscalationStage {
  MONITORING = 'monitoring',
  PROMPTED_USER = 'prompted_user',
  CHECK_IN_OVERDUE = 'check_in_overdue',
  DEMO_CONTACT_READY = 'demo_contact_ready',
  ACKNOWLEDGED_SAFE = 'acknowledged_safe',
}

export type AlertLifecycleStatus =
  | 'ACTIVE'
  | 'ACKNOWLEDGED'
  | 'RESOLVED'
  | 'CANCELLED';

export type EscalationTaskStatus =
  | 'SCHEDULED'
  | 'DUE'
  | 'ATTEMPTED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'FAILED';

export type ContactVerificationStatus = 'UNVERIFIED' | 'PENDING_CODE' | 'VERIFIED';

export type NotificationDeliveryMode = 'SIMULATION' | 'LIVE';

export type NotificationDeliveryStatus =
  | 'QUEUED'
  | 'SUBMITTED'
  | 'SENT'
  | 'DELIVERED'
  | 'FAILED'
  | 'UNKNOWN';

export type ProviderFailureClassification =
  | 'NONE'
  | 'TRANSIENT'
  | 'PERMANENT'
  | 'TIMEOUT'
  | 'UNSUPPORTED_RECEIPT';

export interface VitalReadings {
  heartRateBpm: number;
  oxygenSaturationPct: number;
  bodyTempCelsius: number;
  activityLevel: ActivityLevel;
  stepCadencePerMin: number;
}

export interface EnvironmentReadings {
  ambientTempCelsius: number;
  humidityPct: number;
  weatherCondition: WeatherCondition;
  windSpeedKmh: number;
  airQualityIndex: number;
}

export interface TelemetryPoint {
  timestamp: string;
  timeLabel: string;
  heartRateBpm: number;
  oxygenSaturationPct: number;
  bodyTempCelsius: number;
  ambientTempCelsius: number;
  riskScore: number;
  riskLevel: RiskLevel;
}

export interface RiskThresholds {
  heartRate: {
    lowMin: number;
    moderateLow: number;
    moderateHigh: number;
    highHigh: number;
    criticalHigh: number;
    criticalLow: number;
  };
  oxygenSaturation: {
    normalMin: number;
    moderateMin: number;
    highMin: number;
  };
  bodyTemp: {
    lowHypothermia: number;
    normalMin: number;
    normalMax: number;
    moderateMax: number;
    highMax: number;
  };
  ambientTemp: {
    coldWarn: number;
    coldCritical: number;
    heatWarn: number;
    heatHigh: number;
    heatCritical: number;
  };
}

export interface TriggeredRule {
  id: string;
  category: 'physiological' | 'environmental' | 'compound';
  title: string;
  severity: RiskLevel;
  metricLabel: string;
  observedValue: string;
  thresholdReference: string;
  scoreContribution: number;
  rationale: string;
}

export interface RiskAssessment {
  riskLevel: RiskLevel;
  overallScore: number; // 0 - 100
  physiologicalRisk: RiskLevel;
  environmentalRisk: RiskLevel;
  heatIndexCelsius: number;
  triggeredRules: TriggeredRule[];
  primaryConcern: string;
  evaluatedAt: string;
  ruleVersion?: string;
}

export interface SafetyAlert {
  id: string;
  createdAt: string;
  updatedAt: string;
  status?: AlertLifecycleStatus;
  ruleVersion?: string;
  riskLevel: RiskLevel;
  title: string;
  summary: string;
  triggeredRuleIds: string[];
  acknowledged: boolean;
  acknowledgedAt?: string;
  acknowledgementNote?: string;
  escalationStage: EscalationStage;
  secondsSinceTriggered: number;
  escalationTimeoutSeconds?: number;
  escalationDeadlineIso?: string;
  escalationTaskId?: string;
  escalationTaskStatus?: EscalationTaskStatus;
  cancelledAt?: string;
  cancellationReason?: string;
}

export interface SafetyEvent {
  id: string;
  timestamp: string;
  type:
    | 'assessment_change'
    | 'alert_triggered'
    | 'user_acknowledged'
    | 'escalation_step'
    | 'preset_applied'
    | 'rules_updated'
    | 'contact_simulated'
    | 'ai_explanation_generated'
    | 'escalation_scheduled'
    | 'escalation_cancelled'
    | 'notification_attempt'
    | 'provider_connected'
    | 'provider_disconnected'
    | 'observation_ingested'
    | 'observation_quarantined';
  riskLevel: RiskLevel;
  title: string;
  detail: string;
  alertId?: string;
}

export type ObservationMetricType =
  | 'heart_rate'
  | 'oxygen_saturation'
  | 'body_temperature'
  | 'activity_state'
  | 'step_cadence'
  | 'ambient_temperature'
  | 'relative_humidity'
  | 'weather_condition'
  | 'wind_speed'
  | 'air_quality_index';

export type CanonicalObservationUnit =
  | 'bpm'
  | 'pct'
  | 'celsius'
  | 'enum_activity'
  | 'steps_per_min'
  | 'enum_weather'
  | 'kmh'
  | 'aqi';

export type SupportedInputUnit =
  | CanonicalObservationUnit
  | 'fahrenheit'
  | 'mph'
  | 'ms';

export type DataQualityState = 'CURRENT' | 'STALE' | 'MISSING' | 'INVALID';

export type ObservationValidationStatus =
  | 'VALIDATED'
  | 'REJECTED_SCHEMA'
  | 'REJECTED_UNIT'
  | 'REJECTED_RANGE'
  | 'REJECTED_PROVENANCE'
  | 'REJECTED_DUPLICATE'
  | 'QUARANTINED_OUT_OF_ORDER';

export type ProviderConnectionStatus =
  | 'DISCONNECTED'
  | 'AUTHORIZING'
  | 'CONNECTED'
  | 'ERROR'
  | 'REVOKED'
  | 'UNAVAILABLE';

export type ProviderCategory = 'SIMULATION' | 'WEARABLE' | 'ENVIRONMENTAL';

export interface NormalizedObservation {
  observationId: string;
  authenticatedOwnerId: string;
  metricType: ObservationMetricType;
  value: number | string;
  unit: CanonicalObservationUnit;
  originalUnit?: SupportedInputUnit;
  observedAt: string;
  receivedAt: string;
  sourceProvider: string;
  sourceRecordId?: string;
  dataMode: DataSourceMode;
  validationStatus: ObservationValidationStatus;
  freshnessStatus: DataQualityState;
  consentReference?: string;
  isOutdoorContext?: boolean;
}

export interface ProviderHealthDiagnostics {
  providerId: string;
  providerName: string;
  category: ProviderCategory;
  dataMode: DataSourceMode;
  connectionStatus: ProviderConnectionStatus;
  authorizedScopes: string[];
  supportedMetrics: ObservationMetricType[];
  lastSuccessfulSyncAt?: string;
  lastAttemptedSyncAt?: string;
  dataQualityState: DataQualityState;
  consentGranted: boolean;
  consentReference?: string;
  locationPrecision?: 'COARSE_CITY' | 'NONE';
  implementationStatus: 'IMPLEMENTED_SIMULATED' | 'IMPLEMENTED_SERVER_PROXY' | 'SCAFFOLD_OAUTH_MOCK' | 'UNAVAILABLE';
  sanitizedLastError?: string;
  statusDetail: string;
}

export interface FreshnessPolicyConfig {
  physiologicalStaleAfterMs: number;
  environmentalStaleAfterMs: number;
  maxFutureClockSkewMs: number;
}

export interface IngestionBatchResult {
  accepted: NormalizedObservation[];
  rejected: Array<{
    rawRecordId?: string;
    metricType?: string;
    validationStatus: ObservationValidationStatus;
    sanitizedReason: string;
  }>;
  dataQualityByMetric: Partial<Record<ObservationMetricType, DataQualityState>>;
  overallDataQuality: DataQualityState;
  assessmentTriggered: boolean;
  assessment?: RiskAssessment;
  alertCreatedOrUpdated?: SafetyAlert | null;
  duplicateAlertSuppressed: boolean;
  uncertainties: string[];
}

export interface EmergencyContact {
  id: string;
  name: string;
  relationship: string;
  phoneDisplay: string;
  email: string;
  isPrimary: boolean;
  notifyOnLevel: RiskLevel.HIGH | RiskLevel.CRITICAL;
  lastSimulatedDispatchAt?: string;
  verificationStatus?: ContactVerificationStatus;
  verifiedAtIso?: string;
  consentGranted?: boolean;
}

export interface EscalationPolicyConfig {
  deliveryMode: NotificationDeliveryMode;
  userCheckInChannel: 'IN_APP_BANNER' | 'SIMULATED_PUSH' | 'SMS';
  criticalTimeoutSeconds: number;
  highTimeoutSeconds: number;
  explicitLiveConsentGranted: boolean;
  liveConsentConfirmedAtIso?: string;
  liveReviewCompleted: boolean;
  customMessageTemplate?: string;
}

export interface EscalationTaskRecord {
  taskId: string;
  userId: string;
  alertId: string;
  riskLevel: RiskLevel;
  status: EscalationTaskStatus;
  deadlineIso: string;
  timeoutSeconds: number;
  attemptCount: number;
  maxRetries: number;
  nextRetryDeadlineIso?: string;
  lastOutcomeNote: string;
  createdAtIso: string;
  updatedAtIso: string;
}

export interface NotificationAttemptRecord {
  attemptId: string;
  userId: string;
  alertId: string;
  recipientRef: string;
  recipientRole: 'USER_CHECK_IN' | 'EMERGENCY_CONTACT';
  providerId: string;
  deliveryMode: NotificationDeliveryMode;
  attemptNumber: number;
  idempotencyKey: string;
  attemptedAtIso: string;
  providerMessageId?: string;
  responseClassification: ProviderFailureClassification;
  deliveryStatus: NotificationDeliveryStatus;
  retryEligible: boolean;
  nextRetryDeadlineIso?: string;
  sanitizedError?: string;
  receiptLimitationNote?: string;
  messagePreview?: string;
}

export interface ExplanationReport {
  generatedAt: string;
  engineMode: 'deterministic_baseline' | 'gemini_ready_contract';
  headline: string;
  executiveSummary: string;
  physiologicalCorrelation: string;
  environmentalContext: string;
  recommendedActions: string[];
  confidenceNote: string;
  disclaimer: string;
}

export type DataSourceMode = 'SIMULATED' | 'REAL';

export interface AITriggeredRuleExplanation {
  id: string;
  explanation: string;
}

/**
 * Validated Gemini AI Explanation schema.
 * Strictly explains the deterministic risk engine's output without replacing it.
 */
export interface AIContextualExplanation {
  summary: string;
  contributingFactors: string[];
  triggeredRules: AITriggeredRuleExplanation[];
  uncertainties: string[];
  recommendedActions: string[];
  limitations: string;
  dataMode: DataSourceMode;
  generatedAt: string;
}

export interface PersistedAIExplanation extends AIContextualExplanation {
  explanationId: string;
  assessmentId: string;
  assessmentFingerprint: string;
  userId: string;
  riskLevelSnapshot: RiskLevel;
  overallScoreSnapshot: number;
  modelId: string;
  promptVersion: string;
  schemaVersion: string;
  cached?: boolean;
  promptInjectionDetected?: boolean;
}

export type AIExplanationErrorCode =
  | 'UNAUTHENTICATED'
  | 'PERMISSION_DENIED'
  | 'INVALID_REQUEST'
  | 'RATE_LIMITED'
  | 'QUOTA_EXHAUSTED'
  | 'AI_TIMEOUT'
  | 'AI_SERVICE_UNAVAILABLE'
  | 'INVALID_AI_OUTPUT';

export interface AIExplanationRequestPayload {
  actingUid: string | null;
  targetUid: string;
  assessmentId: string;
  assessment: RiskAssessment;
  vitals?: Partial<VitalReadings>;
  environment?: Partial<EnvironmentReadings>;
  sourceDataMode?: DataSourceMode;
  userNote?: string;
  forceRegenerate?: boolean;
  ingestionUncertainties?: string[];
  environmentalSourceMeta?: {
    providerId: string;
    observedAt: string;
  };
}

export interface SimulationPreset {
  id: string;
  name: string;
  subtitle: string;
  expectedRisk: RiskLevel;
  vitals: VitalReadings;
  environment: EnvironmentReadings;
}

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  simulationNoticeAccepted: boolean;
  createdAtIso: string;
  updatedAtIso: string;
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

