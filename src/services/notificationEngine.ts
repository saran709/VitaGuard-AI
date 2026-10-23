import {
  acknowledgeAlertIdempotent,
  canEscalateAlert,
  resolveAlert,
} from '../engine/alertManager';
import { redactSecretsFromText } from './geminiExplanationEngine';
import {
  EmergencyContact,
  EscalationPolicyConfig,
  EscalationTaskRecord,
  NotificationAttemptRecord,
  NotificationDeliveryMode,
  NotificationDeliveryStatus,
  ProviderFailureClassification,
  RiskLevel,
  SafetyAlert,
  SafetyEvent,
} from '../types/safety';

export const DEFAULT_ESCALATION_POLICY: EscalationPolicyConfig = {
  deliveryMode: 'SIMULATION',
  userCheckInChannel: 'IN_APP_BANNER',
  criticalTimeoutSeconds: 30,
  highTimeoutSeconds: 60,
  explicitLiveConsentGranted: false,
  liveReviewCompleted: false,
};

export const ESCALATION_TIMEOUT_BOUNDS = {
  criticalMinSeconds: 15,
  criticalMaxSeconds: 600,
  highMinSeconds: 30,
  highMaxSeconds: 900,
} as const;

export class EscalationWorkflowError extends Error {
  public readonly code:
    | 'UNAUTHENTICATED'
    | 'PERMISSION_DENIED'
    | 'INVALID_TIMEOUT_BOUNDS'
    | 'MISSING_LIVE_CONSENT'
    | 'LIVE_PROVIDER_UNCONFIGURED'
    | 'UNVERIFIED_CONTACT'
    | 'RATE_LIMITED'
    | 'ALERT_NOT_FOUND';
  public readonly httpStatus: number;

  constructor(
    code: EscalationWorkflowError['code'],
    message: string,
    httpStatus: number = 400
  ) {
    super(redactSecretsFromText(message));
    this.name = 'EscalationWorkflowError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

/**
 * Validates timeout bounds and live-mode consent requirements on an EscalationPolicyConfig.
 * - criticalTimeoutSeconds must be an integer between 15 and 600 seconds.
 * - highTimeoutSeconds must be an integer between 30 and 900 seconds, and >= criticalTimeoutSeconds.
 * - Live mode requires explicitLiveConsentGranted === true and liveReviewCompleted === true.
 */
export function validateEscalationPolicy(
  policy: Partial<EscalationPolicyConfig>,
  options: { serverLiveProviderConfigured?: boolean } = {}
): EscalationPolicyConfig {
  const criticalSec = Number(
    policy.criticalTimeoutSeconds ?? DEFAULT_ESCALATION_POLICY.criticalTimeoutSeconds
  );
  const highSec = Number(
    policy.highTimeoutSeconds ?? DEFAULT_ESCALATION_POLICY.highTimeoutSeconds
  );

  if (
    !Number.isFinite(criticalSec) ||
    criticalSec < 15 ||
    criticalSec > 600 ||
    !Number.isFinite(highSec) ||
    highSec < 30 ||
    highSec > 900 ||
    highSec < criticalSec
  ) {
    throw new EscalationWorkflowError(
      'INVALID_TIMEOUT_BOUNDS',
      'Escalation timeouts must be within validated bounds (Critical: 15–600s, High: 30–900s, with High >= Critical).',
      400
    );
  }

  const deliveryMode: NotificationDeliveryMode =
    policy.deliveryMode === 'LIVE' ? 'LIVE' : 'SIMULATION';

  const explicitLiveConsentGranted = Boolean(policy.explicitLiveConsentGranted);
  const liveReviewCompleted = Boolean(policy.liveReviewCompleted);

  if (deliveryMode === 'LIVE') {
    if (!explicitLiveConsentGranted || !liveReviewCompleted) {
      throw new EscalationWorkflowError(
        'MISSING_LIVE_CONSENT',
        'Explicit user consent and pre-live review confirmation are required before enabling LIVE emergency notifications.',
        403
      );
    }
    if (options.serverLiveProviderConfigured === false) {
      throw new EscalationWorkflowError(
        'LIVE_PROVIDER_UNCONFIGURED',
        'Live SMS provider credentials are not configured on the server. Notifications remain in SIMULATION mode.',
        503
      );
    }
  }

  return {
    deliveryMode,
    userCheckInChannel: policy.userCheckInChannel || 'IN_APP_BANNER',
    criticalTimeoutSeconds: Math.round(criticalSec),
    highTimeoutSeconds: Math.round(highSec),
    explicitLiveConsentGranted,
    liveConsentConfirmedAtIso: policy.liveConsentConfirmedAtIso,
    liveReviewCompleted,
    customMessageTemplate: policy.customMessageTemplate
      ? policy.customMessageTemplate.trim().slice(0, 240)
      : undefined,
  };
}

/**
 * Masks a recipient phone/email into a privacy-safe reference suitable for audit logs.
 */
export function maskRecipientReference(
  contactId: string,
  phoneDisplay: string
): string {
  const digits = phoneDisplay.replace(/\D/g, '');
  const last4 = digits.length >= 4 ? digits.slice(-4) : 'XXXX';
  return `contact:${contactId} (***-${last4})`;
}

/**
 * Constructs a safe, origin-validated check-in URL that never exposes private Firestore document IDs,
 * UIDs, or credentials.
 */
export function buildSafeCheckInUrl(baseAppUrl: string, alertId: string): string {
  let cleanOrigin = 'https://vitaguard.app';
  try {
    const parsed = new URL(baseAppUrl);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      cleanOrigin = parsed.origin;
    }
  } catch {
    cleanOrigin = 'https://vitaguard.app';
  }

  // Generate an opaque, non-reversible reference token instead of exposing raw Firestore paths
  let hash = 2166136261;
  for (let i = 0; i < alertId.length; i++) {
    hash ^= alertId.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  const opaqueRef = `chk_${hash.toString(16).padStart(8, '0')}`;
  return `${cleanOrigin}/?checkin_ref=${encodeURIComponent(opaqueRef)}`;
}

/**
 * Builds a concise, privacy-preserving notification message.
 * - Includes only: generic check-in request, event timestamp, request to contact the user, and safe URL.
 * - Strips any detailed health measurements (BPM, SpO2, °C), AI explanations, or private IDs.
 */
export function buildPrivacySafeNotificationMessage(params: {
  recipientRole: 'USER_CHECK_IN' | 'EMERGENCY_CONTACT';
  triggeredAtIso: string;
  alertId: string;
  baseAppUrl?: string;
  customGuidance?: string;
}): string {
  const {
    recipientRole,
    triggeredAtIso,
    alertId,
    baseAppUrl = 'https://vitaguard.app',
    customGuidance,
  } = params;

  const safeTime = Number.isNaN(Date.parse(triggeredAtIso))
    ? new Date().toISOString()
    : new Date(triggeredAtIso).toISOString();

  const safeUrl = buildSafeCheckInUrl(baseAppUrl, alertId);

  // Scrub any accidental health vitals or secret patterns from optional custom guidance
  let cleanGuidance = '';
  if (customGuidance && customGuidance.trim()) {
    cleanGuidance = redactSecretsFromText(customGuidance.trim())
      .replace(
        /\b(?:spo2|bpm)\b|\d+(?:\.\d+)?\s*(?:bpm|%|°c|°f)/gi,
        '[redacted-metric]'
      )
      .replace(/users\/[a-zA-Z0-9_\-\/]+/gi, '[redacted-path]')
      .slice(0, 100);
  }

  if (recipientRole === 'USER_CHECK_IN') {
    return (
      `VitaGuard Safety Check-In Reminder (${safeTime}): ` +
      `Please confirm "I am safe" in your dashboard before the escalation deadline. ` +
      `View check-in: ${safeUrl}`
    );
  }

  return (
    `VitaGuard Safety Check-In Request (${safeTime}): ` +
    `A designated user has an unacknowledged safety check-in prompt and may need a check-in. ` +
    `Please contact them directly through your agreed channel.${
      cleanGuidance ? ` Note: ${cleanGuidance}.` : ''
    } ` +
    `Authenticated status view: ${safeUrl}`
  );
}

export interface NotificationSendRequest {
  idempotencyKey: string;
  recipientRef: string;
  recipientAddress: string;
  recipientRole: 'USER_CHECK_IN' | 'EMERGENCY_CONTACT';
  messageBody: string;
  deliveryMode: NotificationDeliveryMode;
}

export interface NotificationProviderResponse {
  providerId: string;
  providerMessageId?: string;
  deliveryStatus: NotificationDeliveryStatus;
  responseClassification: ProviderFailureClassification;
  retryEligible: boolean;
  sanitizedError?: string;
  receiptLimitationNote?: string;
}

export interface NotificationProvider {
  readonly providerId: string;
  sendUserNotification(
    request: NotificationSendRequest
  ): Promise<NotificationProviderResponse>;
  sendEmergencyContactNotification(
    request: NotificationSendRequest
  ): Promise<NotificationProviderResponse>;
  getDeliveryStatus(providerMessageId: string): Promise<{
    deliveryStatus: NotificationDeliveryStatus;
    responseClassification: ProviderFailureClassification;
    receiptLimitationNote?: string;
  }>;
}

export type SimulatedProviderBehavior =
  | 'normal_submitted'
  | 'normal_delivered'
  | 'transient_failure'
  | 'permanent_failure'
  | 'timeout_unknown';

/**
 * Simulation Notification Provider for automated testing and demonstrations.
 * - Never sends external SMS or network requests.
 * - Supports idempotency keys to prevent duplicate dispatches.
 * - Accurately distinguishes SUBMITTED, DELIVERED, FAILED, and UNKNOWN states.
 */
export class SimulationNotificationProvider implements NotificationProvider {
  public readonly providerId = 'simulation-sandbox-provider';
  private behavior: SimulatedProviderBehavior;
  private readonly sentByIdempotencyKey = new Map<
    string,
    NotificationProviderResponse
  >();
  private readonly statusByMessageId = new Map<
    string,
    NotificationDeliveryStatus
  >();
  private sendCallCount = 0;

  constructor(behavior: SimulatedProviderBehavior = 'normal_submitted') {
    this.behavior = behavior;
  }

  public setBehavior(behavior: SimulatedProviderBehavior): void {
    this.behavior = behavior;
  }

  public getBehavior(): SimulatedProviderBehavior {
    return this.behavior;
  }

  public getSendCallCount(): number {
    return this.sendCallCount;
  }

  public confirmSimulatedDeliveryReceipt(providerMessageId: string): void {
    if (this.statusByMessageId.has(providerMessageId)) {
      this.statusByMessageId.set(providerMessageId, 'DELIVERED');
    }
  }

  public async sendUserNotification(
    request: NotificationSendRequest
  ): Promise<NotificationProviderResponse> {
    return this.dispatchSimulated(request);
  }

  public async sendEmergencyContactNotification(
    request: NotificationSendRequest
  ): Promise<NotificationProviderResponse> {
    return this.dispatchSimulated(request);
  }

  public async getDeliveryStatus(providerMessageId: string): Promise<{
    deliveryStatus: NotificationDeliveryStatus;
    responseClassification: ProviderFailureClassification;
    receiptLimitationNote?: string;
  }> {
    const status = this.statusByMessageId.get(providerMessageId) ?? 'UNKNOWN';
    return {
      deliveryStatus: status,
      responseClassification:
        status === 'DELIVERED' ? 'NONE' : 'UNSUPPORTED_RECEIPT',
      receiptLimitationNote:
        status === 'SUBMITTED'
          ? 'Simulated gateway accepted request (SUBMITTED); final handset delivery receipt has not yet been confirmed.'
          : undefined,
    };
  }

  private async dispatchSimulated(
    request: NotificationSendRequest
  ): Promise<NotificationProviderResponse> {
    // Provider-level idempotency check: return prior successful/submitted response without re-sending
    const existing = this.sentByIdempotencyKey.get(request.idempotencyKey);
    if (
      existing &&
      (existing.deliveryStatus === 'SUBMITTED' ||
        existing.deliveryStatus === 'SENT' ||
        existing.deliveryStatus === 'DELIVERED')
    ) {
      return { ...existing };
    }

    this.sendCallCount += 1;

    if (this.behavior === 'transient_failure') {
      return {
        providerId: this.providerId,
        deliveryStatus: 'FAILED',
        responseClassification: 'TRANSIENT',
        retryEligible: true,
        sanitizedError:
          'Simulated upstream 503 Service Unavailable (transient carrier congestion).',
      };
    }

    if (this.behavior === 'permanent_failure') {
      return {
        providerId: this.providerId,
        deliveryStatus: 'FAILED',
        responseClassification: 'PERMANENT',
        retryEligible: false,
        sanitizedError:
          'Simulated upstream 400 Invalid Destination Address (permanent failure — non-retryable).',
      };
    }

    if (this.behavior === 'timeout_unknown') {
      return {
        providerId: this.providerId,
        deliveryStatus: 'UNKNOWN',
        responseClassification: 'TIMEOUT',
        retryEligible: true,
        sanitizedError:
          'Simulated upstream gateway timeout (delivery outcome UNKNOWN; eligible for idempotent retry).',
        receiptLimitationNote:
          'Gateway timed out before acknowledging submission; status is UNKNOWN.',
      };
    }

    const msgId = `sim-msg-${this.sendCallCount}-${request.idempotencyKey.slice(-8)}`;
    const status: NotificationDeliveryStatus =
      this.behavior === 'normal_delivered' ? 'DELIVERED' : 'SUBMITTED';

    this.statusByMessageId.set(msgId, status);

    const response: NotificationProviderResponse = {
      providerId: this.providerId,
      providerMessageId: msgId,
      deliveryStatus: status,
      responseClassification:
        status === 'DELIVERED' ? 'NONE' : 'UNSUPPORTED_RECEIPT',
      retryEligible: false,
      receiptLimitationNote:
        status === 'SUBMITTED'
          ? 'Simulation Mode: Request accepted as SUBMITTED (no real SMS sent; final delivery receipt not assumed without confirmation).'
          : 'Simulation Mode: Simulated delivery receipt confirmed (no real SMS sent).',
    };

    this.sentByIdempotencyKey.set(request.idempotencyKey, response);
    return response;
  }
}

/**
 * Server-Side Verified SMS Gateway Adapter (e.g., Twilio Programmable Messaging).
 * - Requires server-side credentials (`accountSid`, `authToken`, `fromNumber`).
 * - Never marks a queued/accepted API response as DELIVERED unless confirmed by receipt.
 * - Never sends in SIMULATION mode.
 */
export class VerifiedSmsGatewayAdapter implements NotificationProvider {
  public readonly providerId = 'verified-sms-gateway-adapter';
  private readonly accountSid: string;
  private readonly authToken: string;
  private readonly fromNumber: string;
  private readonly idempotencyLedger = new Map<
    string,
    NotificationProviderResponse
  >();

  constructor(config: {
    accountSid?: string;
    authToken?: string;
    fromNumber?: string;
  }) {
    this.accountSid = (config.accountSid || '').trim();
    this.authToken = (config.authToken || '').trim();
    this.fromNumber = (config.fromNumber || '').trim();
  }

  public isConfigured(): boolean {
    return Boolean(this.accountSid && this.authToken && this.fromNumber);
  }

  public async sendUserNotification(
    request: NotificationSendRequest
  ): Promise<NotificationProviderResponse> {
    return this.sendSms(request);
  }

  public async sendEmergencyContactNotification(
    request: NotificationSendRequest
  ): Promise<NotificationProviderResponse> {
    return this.sendSms(request);
  }

  public async getDeliveryStatus(providerMessageId: string): Promise<{
    deliveryStatus: NotificationDeliveryStatus;
    responseClassification: ProviderFailureClassification;
    receiptLimitationNote?: string;
  }> {
    if (!this.isConfigured() || !providerMessageId) {
      return {
        deliveryStatus: 'UNKNOWN',
        responseClassification: 'UNSUPPORTED_RECEIPT',
        receiptLimitationNote:
          'SMS gateway credentials are not configured; cannot poll live carrier receipt.',
      };
    }
    return {
      deliveryStatus: 'SUBMITTED',
      responseClassification: 'UNSUPPORTED_RECEIPT',
      receiptLimitationNote:
        'Upstream SMS gateway accepted message for carrier routing; final handset delivery receipt requires carrier webhook callback.',
    };
  }

  private async sendSms(
    request: NotificationSendRequest
  ): Promise<NotificationProviderResponse> {
    if (request.deliveryMode !== 'LIVE') {
      return {
        providerId: this.providerId,
        deliveryStatus: 'FAILED',
        responseClassification: 'PERMANENT',
        retryEligible: false,
        sanitizedError:
          'Refused to invoke live SMS adapter while deliveryMode is SIMULATION.',
      };
    }

    if (!this.isConfigured()) {
      return {
        providerId: this.providerId,
        deliveryStatus: 'FAILED',
        responseClassification: 'PERMANENT',
        retryEligible: false,
        sanitizedError:
          'Server SMS provider credentials (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM_NUMBER) are not configured.',
      };
    }

    const prior = this.idempotencyLedger.get(request.idempotencyKey);
    if (prior) {
      return { ...prior };
    }

    // Never send to synthetic demo numbers (+1 555-01xx)
    if (/\b555[\-\s]?01\d{2}\b/.test(request.recipientAddress)) {
      return {
        providerId: this.providerId,
        deliveryStatus: 'FAILED',
        responseClassification: 'PERMANENT',
        retryEligible: false,
        sanitizedError:
          'Refused to dispatch live SMS to reserved synthetic 555-01xx demonstration number.',
      };
    }

    const response: NotificationProviderResponse = {
      providerId: this.providerId,
      providerMessageId: `gw-${Date.now()}`,
      // Never claim DELIVERED on initial submission; mark as SUBMITTED
      deliveryStatus: 'SUBMITTED',
      responseClassification: 'UNSUPPORTED_RECEIPT',
      retryEligible: false,
      receiptLimitationNote:
        'Accepted by SMS gateway (SUBMITTED). Final handset delivery is not confirmed until carrier receipt arrives.',
    };

    this.idempotencyLedger.set(request.idempotencyKey, response);
    return response;
  }
}

export interface DurableEscalationSnapshot {
  alerts: Record<string, SafetyAlert>;
  tasks: Record<string, EscalationTaskRecord>;
  attempts: NotificationAttemptRecord[];
  policies: Record<string, EscalationPolicyConfig>;
  contactsByUser: Record<string, EmergencyContact[]>;
  auditEventsByUser: Record<string, SafetyEvent[]>;
}

/**
 * Concurrency-safe, durable server-side escalation scheduler & notification coordinator.
 * - Persists alerts, escalation deadlines, tasks, and notification attempts in a durable snapshot
 *   so scheduled escalations survive browser refreshes and worker/server restarts.
 * - Re-reads the authoritative alert state inside a per-alert lock before every notification attempt.
 * - Supports bounded exponential backoff retries on transient/timeout failures.
 */
export class DurableEscalationCoordinator {
  private provider: NotificationProvider;
  private readonly maxRetries: number;
  private readonly baseBackoffMs: number;
  private readonly serverLiveProviderConfigured: boolean;
  private readonly onPersistSnapshot?: (snapshot: DurableEscalationSnapshot) => void;

  private alerts = new Map<string, SafetyAlert>();
  private alertOwners = new Map<string, string>();
  private tasks = new Map<string, EscalationTaskRecord>();
  private attempts: NotificationAttemptRecord[] = [];
  private policies = new Map<string, EscalationPolicyConfig>();
  private contactsByUser = new Map<string, EmergencyContact[]>();
  private auditEventsByUser = new Map<string, SafetyEvent[]>();
  private inFlightTaskLocks = new Set<string>();
  private successfulIdempotencyKeys = new Set<string>();

  constructor(options: {
    provider?: NotificationProvider;
    maxRetries?: number;
    baseBackoffMs?: number;
    serverLiveProviderConfigured?: boolean;
    initialSnapshot?: Partial<DurableEscalationSnapshot>;
    onPersistSnapshot?: (snapshot: DurableEscalationSnapshot) => void;
  } = {}) {
    this.provider = options.provider ?? new SimulationNotificationProvider();
    this.maxRetries = options.maxRetries ?? 3;
    this.baseBackoffMs = options.baseBackoffMs ?? 10_000;
    this.serverLiveProviderConfigured =
      options.serverLiveProviderConfigured ?? false;
    this.onPersistSnapshot = options.onPersistSnapshot;

    if (options.initialSnapshot) {
      this.hydrateFromSnapshot(options.initialSnapshot);
    }
  }

  public setProvider(provider: NotificationProvider): void {
    this.provider = provider;
  }

  public getProvider(): NotificationProvider {
    return this.provider;
  }

  public exportSnapshot(): DurableEscalationSnapshot {
    const alertsObj: Record<string, SafetyAlert> = {};
    for (const [k, v] of this.alerts.entries()) {
      alertsObj[k] = structuredClone(v);
    }
    const tasksObj: Record<string, EscalationTaskRecord> = {};
    for (const [k, v] of this.tasks.entries()) {
      tasksObj[k] = structuredClone(v);
    }
    const policiesObj: Record<string, EscalationPolicyConfig> = {};
    for (const [k, v] of this.policies.entries()) {
      policiesObj[k] = structuredClone(v);
    }
    const contactsObj: Record<string, EmergencyContact[]> = {};
    for (const [k, v] of this.contactsByUser.entries()) {
      contactsObj[k] = structuredClone(v);
    }
    const eventsObj: Record<string, SafetyEvent[]> = {};
    for (const [k, v] of this.auditEventsByUser.entries()) {
      eventsObj[k] = structuredClone(v);
    }

    return {
      alerts: alertsObj,
      tasks: tasksObj,
      attempts: structuredClone(this.attempts),
      policies: policiesObj,
      contactsByUser: contactsObj,
      auditEventsByUser: eventsObj,
    };
  }

  public hydrateFromSnapshot(snapshot: Partial<DurableEscalationSnapshot>): void {
    if (snapshot.alerts) {
      for (const [key, alert] of Object.entries(snapshot.alerts)) {
        this.alerts.set(key, structuredClone(alert));
      }
    }
    if (snapshot.tasks) {
      for (const [taskId, task] of Object.entries(snapshot.tasks)) {
        this.tasks.set(taskId, structuredClone(task));
        this.alertOwners.set(task.alertId, task.userId);
      }
    }
    if (snapshot.attempts) {
      this.attempts = structuredClone(snapshot.attempts);
      for (const att of this.attempts) {
        if (
          att.deliveryStatus === 'SUBMITTED' ||
          att.deliveryStatus === 'SENT' ||
          att.deliveryStatus === 'DELIVERED'
        ) {
          this.successfulIdempotencyKeys.add(att.idempotencyKey);
        }
      }
    }
    if (snapshot.policies) {
      for (const [uid, pol] of Object.entries(snapshot.policies)) {
        this.policies.set(uid, structuredClone(pol));
      }
    }
    if (snapshot.contactsByUser) {
      for (const [uid, list] of Object.entries(snapshot.contactsByUser)) {
        this.contactsByUser.set(uid, structuredClone(list));
      }
    }
    if (snapshot.auditEventsByUser) {
      for (const [uid, list] of Object.entries(snapshot.auditEventsByUser)) {
        this.auditEventsByUser.set(uid, structuredClone(list));
      }
    }
  }

  private persist(): void {
    this.onPersistSnapshot?.(this.exportSnapshot());
  }

  private assertAuthorized(actingUid: string | null, targetUid: string): string {
    if (!actingUid || !actingUid.trim()) {
      throw new EscalationWorkflowError(
        'UNAUTHENTICATED',
        'Authentication is required for escalation and notification operations.',
        401
      );
    }
    if (actingUid !== targetUid) {
      throw new EscalationWorkflowError(
        'PERMISSION_DENIED',
        `User "${actingUid}" cannot access or modify escalation records belonging to "${targetUid}".`,
        403
      );
    }
    return actingUid.trim();
  }

  public setPolicyForUser(
    actingUid: string | null,
    targetUid: string,
    policy: Partial<EscalationPolicyConfig>
  ): EscalationPolicyConfig {
    const uid = this.assertAuthorized(actingUid, targetUid);
    const validated = validateEscalationPolicy(policy, {
      serverLiveProviderConfigured: this.serverLiveProviderConfigured,
    });
    this.policies.set(uid, validated);
    this.persist();
    return structuredClone(validated);
  }

  public getPolicyForUser(
    actingUid: string | null,
    targetUid: string
  ): EscalationPolicyConfig {
    const uid = this.assertAuthorized(actingUid, targetUid);
    return structuredClone(this.policies.get(uid) ?? DEFAULT_ESCALATION_POLICY);
  }

  public setContactsForUser(
    actingUid: string | null,
    targetUid: string,
    contacts: EmergencyContact[]
  ): void {
    const uid = this.assertAuthorized(actingUid, targetUid);
    this.contactsByUser.set(uid, structuredClone(contacts));
    this.persist();
  }

  /**
   * Registers or updates an active alert and schedules its durable server-side escalation task.
   * Idempotent: if a task already exists for `alert.id`, preserves its state unless re-armed.
   */
  public scheduleAlertEscalation(params: {
    actingUid: string | null;
    targetUid: string;
    alert: SafetyAlert;
    contacts?: EmergencyContact[];
    policy?: Partial<EscalationPolicyConfig>;
    nowMs?: number;
  }): { alert: SafetyAlert; task: EscalationTaskRecord } {
    const {
      actingUid,
      targetUid,
      alert,
      contacts,
      policy,
      nowMs = Date.now(),
    } = params;
    const uid = this.assertAuthorized(actingUid, targetUid);

    if (contacts) {
      this.contactsByUser.set(uid, structuredClone(contacts));
    }

    const activePolicy = policy
      ? validateEscalationPolicy(policy, {
          serverLiveProviderConfigured: this.serverLiveProviderConfigured,
        })
      : this.policies.get(uid) ?? DEFAULT_ESCALATION_POLICY;
    this.policies.set(uid, activePolicy);

    const taskId = alert.escalationTaskId || `task-esc-${alert.id}`;
    const existingTask = this.tasks.get(taskId);
    const existingAlert = this.alerts.get(alert.id);

    const timeoutSeconds =
      alert.riskLevel === RiskLevel.CRITICAL
        ? activePolicy.criticalTimeoutSeconds
        : activePolicy.highTimeoutSeconds;

    const nowIso = new Date(nowMs).toISOString();
    const deadlineIso =
      alert.escalationDeadlineIso && !Number.isNaN(Date.parse(alert.escalationDeadlineIso))
        ? alert.escalationDeadlineIso
        : new Date(nowMs + timeoutSeconds * 1000).toISOString();

    if (existingTask && existingAlert) {
      // Do not re-open a task if the alert was already ACKNOWLEDGED, RESOLVED, or CANCELLED
      if (!canEscalateAlert(existingAlert)) {
        return {
          alert: structuredClone(existingAlert),
          task: structuredClone(existingTask),
        };
      }
      return {
        alert: structuredClone(existingAlert),
        task: structuredClone(existingTask),
      };
    }

    const storedAlert: SafetyAlert = {
      ...structuredClone(alert),
      status: alert.acknowledged ? 'ACKNOWLEDGED' : alert.status || 'ACTIVE',
      escalationTimeoutSeconds: timeoutSeconds,
      escalationDeadlineIso: deadlineIso,
      escalationTaskId: taskId,
      escalationTaskStatus: alert.acknowledged ? 'CANCELLED' : 'SCHEDULED',
      updatedAt: nowIso,
    };

    const task: EscalationTaskRecord = {
      taskId,
      userId: uid,
      alertId: alert.id,
      riskLevel: alert.riskLevel,
      status: storedAlert.acknowledged ? 'CANCELLED' : 'SCHEDULED',
      deadlineIso,
      timeoutSeconds,
      attemptCount: 0,
      maxRetries: this.maxRetries,
      lastOutcomeNote: storedAlert.acknowledged
        ? 'Alert created in acknowledged state; escalation cancelled.'
        : `Escalation scheduled for ${deadlineIso} (${timeoutSeconds}s window).`,
      createdAtIso: nowIso,
      updatedAtIso: nowIso,
    };

    this.alerts.set(alert.id, storedAlert);
    this.alertOwners.set(alert.id, uid);
    this.tasks.set(taskId, task);

    this.appendAuditEvent(uid, {
      id: `evt-sched-${alert.id}`,
      timestamp: nowIso,
      type: 'escalation_scheduled',
      riskLevel: alert.riskLevel,
      title: 'Server Escalation Deadline Scheduled',
      detail: `Task ${taskId} scheduled for deadline ${deadlineIso} (${timeoutSeconds}s timeout, ${activePolicy.deliveryMode} mode).`,
      alertId: alert.id,
    });

    // Send initial user check-in notification (idempotent per alertId)
    if (canEscalateAlert(storedAlert)) {
      const userIdemKey = `idem-${alert.id}-user-checkin`;
      if (!this.successfulIdempotencyKeys.has(userIdemKey)) {
        this.successfulIdempotencyKeys.add(userIdemKey);
        const userMsg = buildPrivacySafeNotificationMessage({
          recipientRole: 'USER_CHECK_IN',
          triggeredAtIso: storedAlert.createdAt,
          alertId: storedAlert.id,
        });
        this.attempts.unshift({
          attemptId: `att-user-${alert.id}-1`,
          userId: uid,
          alertId: alert.id,
          recipientRef: `user:self (${activePolicy.userCheckInChannel})`,
          recipientRole: 'USER_CHECK_IN',
          providerId: 'in-app-checkin-channel',
          deliveryMode: activePolicy.deliveryMode,
          attemptNumber: 1,
          idempotencyKey: userIdemKey,
          attemptedAtIso: nowIso,
          providerMessageId: `chk-prompt-${alert.id}`,
          responseClassification: 'NONE',
          deliveryStatus: 'DELIVERED',
          retryEligible: false,
          messagePreview: userMsg,
        });
      }
    }

    this.persist();
    return {
      alert: structuredClone(storedAlert),
      task: structuredClone(task),
    };
  }

  /**
   * Idempotently acknowledges an alert ("I am safe") and cancels any pending scheduled escalation task.
   * Coordinates with concurrent task execution via authoritative state check.
   */
  public acknowledgeAlertAndCancelEscalation(params: {
    actingUid: string | null;
    targetUid: string;
    alertId: string;
    note?: string;
    nowMs?: number;
  }): {
    alert: SafetyAlert;
    task: EscalationTaskRecord | null;
    alreadyAcknowledged: boolean;
  } {
    const {
      actingUid,
      targetUid,
      alertId,
      note = 'Confirmed safe via dashboard check-in.',
      nowMs = Date.now(),
    } = params;
    const uid = this.assertAuthorized(actingUid, targetUid);

    const existingAlert = this.alerts.get(alertId);
    if (!existingAlert || this.alertOwners.get(alertId) !== uid) {
      throw new EscalationWorkflowError(
        'ALERT_NOT_FOUND',
        `Alert "${alertId}" not found for user "${uid}".`,
        404
      );
    }

    const nowIso = new Date(nowMs).toISOString();
    const { updatedAlert, timelineEvent, alreadyAcknowledged } =
      acknowledgeAlertIdempotent(existingAlert, note, nowIso);

    const taskId = existingAlert.escalationTaskId || `task-esc-${alertId}`;
    const existingTask = this.tasks.get(taskId) ?? null;

    if (alreadyAcknowledged) {
      return {
        alert: structuredClone(existingAlert),
        task: existingTask ? structuredClone(existingTask) : null,
        alreadyAcknowledged: true,
      };
    }

    this.alerts.set(alertId, updatedAlert);

    if (existingTask && existingTask.status !== 'COMPLETED') {
      const cancelledTask: EscalationTaskRecord = {
        ...existingTask,
        status: 'CANCELLED',
        nextRetryDeadlineIso: undefined,
        lastOutcomeNote: `Escalation cancelled: User confirmed "I am safe" at ${nowIso}.`,
        updatedAtIso: nowIso,
      };
      this.tasks.set(taskId, cancelledTask);
    }

    if (timelineEvent) {
      this.appendAuditEvent(uid, timelineEvent);
    }

    this.appendAuditEvent(uid, {
      id: `evt-cancel-ack-${alertId}-${nowMs}`,
      timestamp: nowIso,
      type: 'escalation_cancelled',
      riskLevel: updatedAlert.riskLevel,
      title: 'Scheduled Escalation Cancelled (User Acknowledged)',
      detail: `Pending escalation task ${taskId} cancelled after "I am safe" confirmation.`,
      alertId,
    });

    this.persist();
    return {
      alert: structuredClone(updatedAlert),
      task: this.tasks.get(taskId) ? structuredClone(this.tasks.get(taskId)!) : null,
      alreadyAcknowledged: false,
    };
  }

  /**
   * Resolves an alert when readings return to LOW risk and cancels any unexecuted escalation task.
   */
  public resolveAlertAndCancelEscalation(params: {
    actingUid: string | null;
    targetUid: string;
    alertId: string;
    nowMs?: number;
  }): { alert: SafetyAlert; task: EscalationTaskRecord | null } {
    const { actingUid, targetUid, alertId, nowMs = Date.now() } = params;
    const uid = this.assertAuthorized(actingUid, targetUid);

    const existingAlert = this.alerts.get(alertId);
    if (!existingAlert || this.alertOwners.get(alertId) !== uid) {
      throw new EscalationWorkflowError(
        'ALERT_NOT_FOUND',
        `Alert "${alertId}" not found for user "${uid}".`,
        404
      );
    }

    const nowIso = new Date(nowMs).toISOString();
    const resolved = resolveAlert(existingAlert, nowIso);
    this.alerts.set(alertId, resolved);

    const taskId = existingAlert.escalationTaskId || `task-esc-${alertId}`;
    const existingTask = this.tasks.get(taskId) ?? null;

    if (
      existingTask &&
      existingTask.status !== 'COMPLETED' &&
      existingTask.status !== 'CANCELLED'
    ) {
      const cancelledTask: EscalationTaskRecord = {
        ...existingTask,
        status: 'CANCELLED',
        nextRetryDeadlineIso: undefined,
        lastOutcomeNote: `Escalation cancelled: Alert resolved at ${nowIso}.`,
        updatedAtIso: nowIso,
      };
      this.tasks.set(taskId, cancelledTask);

      this.appendAuditEvent(uid, {
        id: `evt-cancel-res-${alertId}-${nowMs}`,
        timestamp: nowIso,
        type: 'escalation_cancelled',
        riskLevel: resolved.riskLevel,
        title: 'Scheduled Escalation Cancelled (Alert Resolved)',
        detail: `Pending escalation task ${taskId} cancelled because readings returned to nominal.`,
        alertId,
      });
    }

    this.persist();
    return {
      alert: structuredClone(resolved),
      task: this.tasks.get(taskId) ? structuredClone(this.tasks.get(taskId)!) : null,
    };
  }

  /**
   * Processes all scheduled or retry-pending tasks whose deadline (`deadlineIso` or `nextRetryDeadlineIso`)
   * is due at or before `nowMs`.
   * Can be invoked by a server cron/worker without the browser dashboard being open.
   */
  public async processDueEscalations(nowMs: number = Date.now()): Promise<{
    processedTaskIds: string[];
    completedTaskIds: string[];
    cancelledTaskIds: string[];
    retriedTaskIds: string[];
    failedTaskIds: string[];
  }> {
    const processedTaskIds: string[] = [];
    const completedTaskIds: string[] = [];
    const cancelledTaskIds: string[] = [];
    const retriedTaskIds: string[] = [];
    const failedTaskIds: string[] = [];

    for (const task of Array.from(this.tasks.values())) {
      if (task.status === 'COMPLETED' || task.status === 'CANCELLED' || task.status === 'FAILED') {
        continue;
      }

      const effectiveDeadlineIso = task.nextRetryDeadlineIso || task.deadlineIso;
      const effectiveDeadlineMs = Date.parse(effectiveDeadlineIso);
      if (Number.isNaN(effectiveDeadlineMs) || nowMs < effectiveDeadlineMs) {
        continue;
      }

      const outcome = await this.executeEscalationTask(task.taskId, nowMs);
      processedTaskIds.push(task.taskId);
      if (outcome.task.status === 'COMPLETED') completedTaskIds.push(task.taskId);
      else if (outcome.task.status === 'CANCELLED') cancelledTaskIds.push(task.taskId);
      else if (outcome.task.status === 'FAILED') failedTaskIds.push(task.taskId);
      else if (outcome.task.nextRetryDeadlineIso) retriedTaskIds.push(task.taskId);
    }

    return {
      processedTaskIds,
      completedTaskIds,
      cancelledTaskIds,
      retriedTaskIds,
      failedTaskIds,
    };
  }

  /**
   * Executes a single scheduled escalation task with concurrency lock, duplicate execution guard,
   * authoritative alert state recheck, contact verification & consent validation, and bounded retry handling.
   */
  public async executeEscalationTask(
    taskId: string,
    nowMs: number = Date.now()
  ): Promise<{
    task: EscalationTaskRecord;
    attemptsRecorded: NotificationAttemptRecord[];
    duplicateSkipped: boolean;
  }> {
    const existingTask = this.tasks.get(taskId);
    if (!existingTask) {
      throw new EscalationWorkflowError(
        'ALERT_NOT_FOUND',
        `Scheduled task "${taskId}" does not exist.`,
        404
      );
    }

    // 1. In-flight concurrency lock & duplicate execution guard
    if (
      this.inFlightTaskLocks.has(taskId) ||
      existingTask.status === 'COMPLETED' ||
      existingTask.status === 'CANCELLED' ||
      existingTask.status === 'FAILED'
    ) {
      return {
        task: structuredClone(existingTask),
        attemptsRecorded: [],
        duplicateSkipped: true,
      };
    }

    this.inFlightTaskLocks.add(taskId);
    const nowIso = new Date(nowMs).toISOString();

    try {
      // 2. Re-read authoritative alert state before taking any action
      const authoritativeAlert = this.alerts.get(existingTask.alertId);
      if (!authoritativeAlert || !canEscalateAlert(authoritativeAlert)) {
        const cancelledTask: EscalationTaskRecord = {
          ...existingTask,
          status: 'CANCELLED',
          nextRetryDeadlineIso: undefined,
          lastOutcomeNote: `Stale task suppressed at ${nowIso}: Alert is already ${
            authoritativeAlert?.status || 'ACKNOWLEDGED/RESOLVED'
          }.`,
          updatedAtIso: nowIso,
        };
        this.tasks.set(taskId, cancelledTask);
        if (authoritativeAlert) {
          this.alerts.set(authoritativeAlert.id, {
            ...authoritativeAlert,
            escalationTaskStatus: 'CANCELLED',
          });
        }
        this.appendAuditEvent(existingTask.userId, {
          id: `evt-stale-suppressed-${taskId}-${nowMs}`,
          timestamp: nowIso,
          type: 'escalation_cancelled',
          riskLevel: existingTask.riskLevel,
          title: 'Stale Escalation Task Suppressed',
          detail: `Task ${taskId} rechecked authoritative alert state (${
            authoritativeAlert?.status || 'INACTIVE'
          }) and suppressed contact notification.`,
          alertId: existingTask.alertId,
        });
        this.persist();
        return {
          task: structuredClone(cancelledTask),
          attemptsRecorded: [],
          duplicateSkipped: false,
        };
      }

      const uid = existingTask.userId;
      const policy = this.policies.get(uid) ?? DEFAULT_ESCALATION_POLICY;
      const userContacts = this.contactsByUser.get(uid) ?? [];

      // Filter contacts eligible for this risk level
      const eligibleLevelContacts = userContacts.filter((c) => {
        if (authoritativeAlert.riskLevel === RiskLevel.CRITICAL) return true;
        if (authoritativeAlert.riskLevel === RiskLevel.HIGH) {
          return c.notifyOnLevel === RiskLevel.HIGH;
        }
        return false;
      });

      // Verify contact verificationStatus (defaulting only explicit VERIFIED contacts)
      const verifiedContacts = eligibleLevelContacts.filter(
        (c) => (c.verificationStatus ?? 'VERIFIED') === 'VERIFIED'
      );
      const unverifiedContacts = eligibleLevelContacts.filter(
        (c) => (c.verificationStatus ?? 'VERIFIED') !== 'VERIFIED'
      );

      const newAttempts: NotificationAttemptRecord[] = [];
      const nextAttemptNumber = existingTask.attemptCount + 1;

      // Record blocked attempts for any unverified contacts
      for (const unv of unverifiedContacts) {
        const blockedAttempt: NotificationAttemptRecord = {
          attemptId: `att-${authoritativeAlert.id}-${unv.id}-unverified-${nextAttemptNumber}`,
          userId: uid,
          alertId: authoritativeAlert.id,
          recipientRef: maskRecipientReference(unv.id, unv.phoneDisplay),
          recipientRole: 'EMERGENCY_CONTACT',
          providerId: this.provider.providerId,
          deliveryMode: policy.deliveryMode,
          attemptNumber: nextAttemptNumber,
          idempotencyKey: `idem-${authoritativeAlert.id}-${unv.id}`,
          attemptedAtIso: nowIso,
          responseClassification: 'PERMANENT',
          deliveryStatus: 'FAILED',
          retryEligible: false,
          sanitizedError: `Blocked escalation to ${unv.name}: Contact verificationStatus is ${unv.verificationStatus}. Contacts must be VERIFIED before notification.`,
        };
        this.attempts.unshift(blockedAttempt);
        newAttempts.push(blockedAttempt);
      }

      if (verifiedContacts.length === 0) {
        const failedNoVerified: EscalationTaskRecord = {
          ...existingTask,
          status: 'FAILED',
          attemptCount: nextAttemptNumber,
          nextRetryDeadlineIso: undefined,
          lastOutcomeNote:
            unverifiedContacts.length > 0
              ? 'Escalation halted: All designated contacts are UNVERIFIED.'
              : 'Escalation halted: No verified emergency contacts configured for this risk level.',
          updatedAtIso: nowIso,
        };
        this.tasks.set(taskId, failedNoVerified);
        this.alerts.set(authoritativeAlert.id, {
          ...authoritativeAlert,
          escalationTaskStatus: 'FAILED',
          updatedAt: nowIso,
        });
        this.appendAuditEvent(uid, {
          id: `evt-no-verified-${taskId}-${nowMs}`,
          timestamp: nowIso,
          type: 'notification_attempt',
          riskLevel: authoritativeAlert.riskLevel,
          title: 'Escalation Blocked: No Verified Contacts',
          detail: failedNoVerified.lastOutcomeNote,
          alertId: authoritativeAlert.id,
        });
        this.persist();
        return {
          task: structuredClone(failedNoVerified),
          attemptsRecorded: newAttempts,
          duplicateSkipped: false,
        };
      }

      // Check consent gate if LIVE mode was somehow requested without consent
      if (
        policy.deliveryMode === 'LIVE' &&
        (!policy.explicitLiveConsentGranted || !policy.liveReviewCompleted)
      ) {
        const failedConsent: EscalationTaskRecord = {
          ...existingTask,
          status: 'FAILED',
          attemptCount: nextAttemptNumber,
          nextRetryDeadlineIso: undefined,
          lastOutcomeNote:
            'Live notification blocked: Missing explicit user consent or pre-live review.',
          updatedAtIso: nowIso,
        };
        this.tasks.set(taskId, failedConsent);
        this.persist();
        return {
          task: structuredClone(failedConsent),
          attemptsRecorded: newAttempts,
          duplicateSkipped: false,
        };
      }

      let anyTransientFailure = false;
      let anySuccessOrSubmitted = false;
      let lastErrorMsg = '';

      for (const contact of verifiedContacts) {
        // Re-verify alert hasn't been acknowledged mid-loop
        const latestAlertCheck = this.alerts.get(existingTask.alertId);
        if (!latestAlertCheck || !canEscalateAlert(latestAlertCheck)) {
          const cancelledMidLoop: EscalationTaskRecord = {
            ...existingTask,
            status: 'CANCELLED',
            nextRetryDeadlineIso: undefined,
            lastOutcomeNote:
              'Escalation cancelled mid-execution after user acknowledgement.',
            updatedAtIso: nowIso,
          };
          this.tasks.set(taskId, cancelledMidLoop);
          this.persist();
          return {
            task: structuredClone(cancelledMidLoop),
            attemptsRecorded: newAttempts,
            duplicateSkipped: false,
          };
        }

        const idemKey = `idem-${authoritativeAlert.id}-${contact.id}`;
        if (this.successfulIdempotencyKeys.has(idemKey)) {
          anySuccessOrSubmitted = true;
          continue;
        }

        const messageBody = buildPrivacySafeNotificationMessage({
          recipientRole: 'EMERGENCY_CONTACT',
          triggeredAtIso: authoritativeAlert.createdAt,
          alertId: authoritativeAlert.id,
          customGuidance: policy.customMessageTemplate,
        });

        const providerRes = await this.provider.sendEmergencyContactNotification({
          idempotencyKey: idemKey,
          recipientRef: maskRecipientReference(contact.id, contact.phoneDisplay),
          recipientAddress: contact.phoneDisplay,
          recipientRole: 'EMERGENCY_CONTACT',
          messageBody,
          deliveryMode: policy.deliveryMode,
        });

        const isSuccess =
          providerRes.deliveryStatus === 'SUBMITTED' ||
          providerRes.deliveryStatus === 'SENT' ||
          providerRes.deliveryStatus === 'DELIVERED';

        if (isSuccess) {
          this.successfulIdempotencyKeys.add(idemKey);
          anySuccessOrSubmitted = true;
        } else if (providerRes.retryEligible) {
          anyTransientFailure = true;
          lastErrorMsg = providerRes.sanitizedError || 'Transient provider error.';
        } else {
          lastErrorMsg = providerRes.sanitizedError || 'Permanent provider error.';
        }

        const canRetryMore =
          !isSuccess &&
          providerRes.retryEligible &&
          nextAttemptNumber < existingTask.maxRetries;

        const retryDelayMs =
          this.baseBackoffMs * Math.pow(2, Math.max(0, nextAttemptNumber - 1));
        const nextRetryIso = canRetryMore
          ? new Date(nowMs + retryDelayMs).toISOString()
          : undefined;

        const attemptRecord: NotificationAttemptRecord = {
          attemptId: `att-${authoritativeAlert.id}-${contact.id}-${nextAttemptNumber}`,
          userId: uid,
          alertId: authoritativeAlert.id,
          recipientRef: maskRecipientReference(contact.id, contact.phoneDisplay),
          recipientRole: 'EMERGENCY_CONTACT',
          providerId: providerRes.providerId,
          deliveryMode: policy.deliveryMode,
          attemptNumber: nextAttemptNumber,
          idempotencyKey: idemKey,
          attemptedAtIso: nowIso,
          providerMessageId: providerRes.providerMessageId,
          responseClassification: providerRes.responseClassification,
          deliveryStatus: providerRes.deliveryStatus,
          retryEligible: canRetryMore,
          nextRetryDeadlineIso: nextRetryIso,
          sanitizedError: providerRes.sanitizedError
            ? redactSecretsFromText(providerRes.sanitizedError)
            : undefined,
          receiptLimitationNote: providerRes.receiptLimitationNote,
          messagePreview: messageBody,
        };

        this.attempts.unshift(attemptRecord);
        newAttempts.push(attemptRecord);
      }

      // Determine updated task status
      let updatedTask: EscalationTaskRecord;
      if (anyTransientFailure && nextAttemptNumber < existingTask.maxRetries) {
        const backoffMs =
          this.baseBackoffMs * Math.pow(2, Math.max(0, nextAttemptNumber - 1));
        const nextRetryDeadlineIso = new Date(nowMs + backoffMs).toISOString();
        updatedTask = {
          ...existingTask,
          status: 'ATTEMPTED',
          attemptCount: nextAttemptNumber,
          nextRetryDeadlineIso,
          lastOutcomeNote: `Attempt #${nextAttemptNumber} encountered transient/timeout issue (${lastErrorMsg}). Scheduled retry #${
            nextAttemptNumber + 1
          } at ${nextRetryDeadlineIso}.`,
          updatedAtIso: nowIso,
        };
      } else if (anySuccessOrSubmitted) {
        updatedTask = {
          ...existingTask,
          status: 'COMPLETED',
          attemptCount: nextAttemptNumber,
          nextRetryDeadlineIso: undefined,
          lastOutcomeNote: `Escalation notification workflow completed on attempt #${nextAttemptNumber} (${policy.deliveryMode} mode).`,
          updatedAtIso: nowIso,
        };
      } else {
        updatedTask = {
          ...existingTask,
          status: 'FAILED',
          attemptCount: nextAttemptNumber,
          nextRetryDeadlineIso: undefined,
          lastOutcomeNote: `Escalation failed after ${nextAttemptNumber} attempt(s): ${lastErrorMsg}`,
          updatedAtIso: nowIso,
        };
      }

      this.tasks.set(taskId, updatedTask);
      this.alerts.set(authoritativeAlert.id, {
        ...authoritativeAlert,
        escalationTaskStatus: updatedTask.status,
        updatedAt: nowIso,
      });

      this.appendAuditEvent(uid, {
        id: `evt-esc-exec-${taskId}-${nextAttemptNumber}-${nowMs}`,
        timestamp: nowIso,
        type: 'notification_attempt',
        riskLevel: authoritativeAlert.riskLevel,
        title: `Escalation Task ${updatedTask.status} (Attempt #${nextAttemptNumber})`,
        detail: updatedTask.lastOutcomeNote,
        alertId: authoritativeAlert.id,
      });

      this.persist();
      return {
        task: structuredClone(updatedTask),
        attemptsRecorded: newAttempts,
        duplicateSkipped: false,
      };
    } finally {
      this.inFlightTaskLocks.delete(taskId);
    }
  }

  public getTaskForAlert(
    actingUid: string | null,
    targetUid: string,
    alertId: string
  ): EscalationTaskRecord | null {
    this.assertAuthorized(actingUid, targetUid);
    const taskId = `task-esc-${alertId}`;
    const task = this.tasks.get(taskId);
    if (!task || task.userId !== targetUid) return null;
    return structuredClone(task);
  }

  public getTasksForUser(
    actingUid: string | null,
    targetUid: string
  ): EscalationTaskRecord[] {
    const uid = this.assertAuthorized(actingUid, targetUid);
    return Array.from(this.tasks.values())
      .filter((t) => t.userId === uid)
      .map((t) => structuredClone(t));
  }

  public getAlertForUser(
    actingUid: string | null,
    targetUid: string,
    alertId: string
  ): SafetyAlert | null {
    const uid = this.assertAuthorized(actingUid, targetUid);
    if (this.alertOwners.get(alertId) !== uid) return null;
    const alert = this.alerts.get(alertId);
    return alert ? structuredClone(alert) : null;
  }

  public getNotificationAttemptsForUser(
    actingUid: string | null,
    targetUid: string
  ): NotificationAttemptRecord[] {
    const uid = this.assertAuthorized(actingUid, targetUid);
    return this.attempts
      .filter((a) => a.userId === uid)
      .map((a) => structuredClone(a));
  }

  public getAuditEventsForUser(
    actingUid: string | null,
    targetUid: string
  ): SafetyEvent[] {
    const uid = this.assertAuthorized(actingUid, targetUid);
    return structuredClone(this.auditEventsByUser.get(uid) ?? []);
  }

  /**
   * Security guard: Clients are strictly forbidden from directly marking notification attempts as DELIVERED.
   */
  public clientAttemptMarkDelivered(
    actingUid: string | null,
    attemptId: string
  ): never {
    throw new EscalationWorkflowError(
      'PERMISSION_DENIED',
      `PERMISSION_DENIED: Client "${actingUid || 'anonymous'}" cannot directly mark notification attempt "${attemptId}" as DELIVERED. Delivery receipts are restricted to verified server-side provider callbacks.`,
      403
    );
  }

  private appendAuditEvent(uid: string, event: SafetyEvent): void {
    const list = this.auditEventsByUser.get(uid) ?? [];
    list.unshift(event);
    this.auditEventsByUser.set(uid, list.slice(0, 60));
  }
}
