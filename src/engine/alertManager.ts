import {
  EscalationStage,
  RiskAssessment,
  RiskLevel,
  SafetyAlert,
  SafetyEvent,
} from '../types/safety';
import { RULE_ENGINE_VERSION } from './riskEngine';

const SEVERITY_RANK: Record<RiskLevel, number> = {
  [RiskLevel.LOW]: 0,
  [RiskLevel.MODERATE]: 1,
  [RiskLevel.HIGH]: 2,
  [RiskLevel.CRITICAL]: 3,
};

/**
 * Determines whether a risk assessment warrants creating or updating an active safety alert.
 * Alerts are generated for MODERATE, HIGH, and CRITICAL assessments.
 * Persists a server/authoritative escalation deadline (`escalationDeadlineIso`) and deterministic task ID (`escalationTaskId`).
 */
export function createAlertFromAssessment(
  assessment: RiskAssessment,
  existingAlert: SafetyAlert | null,
  nowIso: string = new Date().toISOString(),
  forceNewIfAcknowledged: boolean = false,
  customTimeoutSeconds?: number
): SafetyAlert | null {
  if (assessment.riskLevel === RiskLevel.LOW) {
    return null;
  }

  const ruleTitles = assessment.triggeredRules.map((r) => r.title).join('; ');
  const summary =
    assessment.triggeredRules.length > 0
      ? `${assessment.primaryConcern}. Triggered factors: ${ruleTitles}.`
      : assessment.primaryConcern;

  const defaultTimeoutSec = assessment.riskLevel === RiskLevel.CRITICAL ? 30 : 60;
  const timeoutSeconds =
    typeof customTimeoutSeconds === 'number' && customTimeoutSeconds >= 15 && customTimeoutSeconds <= 900
      ? customTimeoutSeconds
      : defaultTimeoutSec;

  const baseNowMs = Number.isNaN(Date.parse(nowIso)) ? Date.now() : Date.parse(nowIso);
  const computedDeadlineIso = new Date(baseNowMs + timeoutSeconds * 1000).toISOString();

  if (existingAlert) {
    const severityIncreased =
      SEVERITY_RANK[assessment.riskLevel] > SEVERITY_RANK[existingAlert.riskLevel];
    const currentRuleKey = assessment.triggeredRules.map((r) => r.id).sort().join(',');
    const existingRuleKey = [...existingAlert.triggeredRuleIds].sort().join(',');
    const rulesChanged = currentRuleKey !== existingRuleKey;

    // If already acknowledged ("I am safe"), keep it acknowledged unless severity increased, new rules triggered, or forced
    if (
      (existingAlert.acknowledged ||
        existingAlert.status === 'ACKNOWLEDGED' ||
        existingAlert.status === 'CANCELLED') &&
      !severityIncreased &&
      !rulesChanged &&
      !forceNewIfAcknowledged
    ) {
      return existingAlert;
    }

    // If unacknowledged and ACTIVE, update in place so the user's timer/alert ID stays stable
    if (
      !existingAlert.acknowledged &&
      existingAlert.status !== 'RESOLVED' &&
      existingAlert.status !== 'CANCELLED'
    ) {
      return {
        ...existingAlert,
        status: 'ACTIVE',
        ruleVersion: assessment.ruleVersion || RULE_ENGINE_VERSION,
        updatedAt: nowIso,
        riskLevel: assessment.riskLevel,
        title: `${assessment.riskLevel.toUpperCase()} RISK: ${assessment.primaryConcern}`,
        summary,
        triggeredRuleIds: assessment.triggeredRules.map((r) => r.id),
        escalationStage: severityIncreased
          ? EscalationStage.PROMPTED_USER
          : existingAlert.escalationStage,
        escalationTimeoutSeconds: severityIncreased
          ? timeoutSeconds
          : existingAlert.escalationTimeoutSeconds ?? timeoutSeconds,
        escalationDeadlineIso: severityIncreased
          ? computedDeadlineIso
          : existingAlert.escalationDeadlineIso ?? computedDeadlineIso,
        escalationTaskId: existingAlert.escalationTaskId ?? `task-esc-${existingAlert.id}`,
        escalationTaskStatus:
          existingAlert.escalationTaskStatus ?? 'SCHEDULED',
      };
    }
  }

  const alertId = `alert-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  return {
    id: alertId,
    createdAt: nowIso,
    updatedAt: nowIso,
    status: 'ACTIVE',
    ruleVersion: assessment.ruleVersion || RULE_ENGINE_VERSION,
    riskLevel: assessment.riskLevel,
    title: `${assessment.riskLevel.toUpperCase()} RISK: ${assessment.primaryConcern}`,
    summary,
    triggeredRuleIds: assessment.triggeredRules.map((r) => r.id),
    acknowledged: false,
    escalationStage: EscalationStage.PROMPTED_USER,
    secondsSinceTriggered: 0,
    escalationTimeoutSeconds: timeoutSeconds,
    escalationDeadlineIso: computedDeadlineIso,
    escalationTaskId: `task-esc-${alertId}`,
    escalationTaskStatus: 'SCHEDULED',
  };
}

/**
 * Marks an active safety alert as acknowledged ("I am safe") and cancels any pending escalation task.
 */
export function acknowledgeAlert(
  alert: SafetyAlert,
  note: string = 'Confirmed safe via dashboard check-in.',
  acknowledgedAt: string = new Date().toISOString()
): { updatedAlert: SafetyAlert; timelineEvent: SafetyEvent } {
  const cleanNote = note.trim().slice(0, 300) || 'Confirmed safe via dashboard check-in.';
  const updatedAlert: SafetyAlert = {
    ...alert,
    status: 'ACKNOWLEDGED',
    acknowledged: true,
    acknowledgedAt,
    acknowledgementNote: cleanNote,
    updatedAt: acknowledgedAt,
    escalationStage: EscalationStage.ACKNOWLEDGED_SAFE,
    escalationTaskStatus:
      alert.escalationTaskStatus === 'COMPLETED' ? 'COMPLETED' : 'CANCELLED',
  };

  const timelineEvent: SafetyEvent = {
    id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: acknowledgedAt,
    type: 'user_acknowledged',
    riskLevel: alert.riskLevel,
    title: 'User Confirmed "I am safe"',
    detail: `Alert "${alert.title}" acknowledged. Pending escalation cancelled. Note: ${cleanNote}`,
    alertId: alert.id,
  };

  return { updatedAlert, timelineEvent };
}

/**
 * Idempotent acknowledgement helper.
 * If the alert is already ACKNOWLEDGED, RESOLVED, or CANCELLED, suppresses duplicate mutations and audit events.
 */
export function acknowledgeAlertIdempotent(
  alert: SafetyAlert,
  note: string = 'Confirmed safe via dashboard check-in.',
  acknowledgedAt: string = new Date().toISOString()
): {
  updatedAlert: SafetyAlert;
  timelineEvent: SafetyEvent | null;
  alreadyAcknowledged: boolean;
} {
  if (
    alert.acknowledged ||
    alert.status === 'ACKNOWLEDGED' ||
    alert.status === 'RESOLVED' ||
    alert.status === 'CANCELLED'
  ) {
    return {
      updatedAlert: alert,
      timelineEvent: null,
      alreadyAcknowledged: true,
    };
  }

  const { updatedAlert, timelineEvent } = acknowledgeAlert(alert, note, acknowledgedAt);
  return {
    updatedAlert,
    timelineEvent,
    alreadyAcknowledged: false,
  };
}

/**
 * Transitions an alert to RESOLVED when physiological/environmental readings return to nominal,
 * cancelling any pending unexecuted escalation task.
 */
export function resolveAlert(
  alert: SafetyAlert,
  resolvedAt: string = new Date().toISOString()
): SafetyAlert {
  if (alert.status === 'RESOLVED') {
    return alert;
  }
  return {
    ...alert,
    status: 'RESOLVED',
    updatedAt: resolvedAt,
    escalationTaskStatus:
      alert.escalationTaskStatus === 'COMPLETED' ? 'COMPLETED' : 'CANCELLED',
  };
}

/**
 * Transitions an alert to CANCELLED and cancels any pending escalation task.
 */
export function cancelAlert(
  alert: SafetyAlert,
  reason: string = 'Cancelled by operator policy.',
  cancelledAt: string = new Date().toISOString()
): SafetyAlert {
  if (alert.status === 'CANCELLED' || alert.status === 'RESOLVED') {
    return alert;
  }
  return {
    ...alert,
    status: 'CANCELLED',
    cancelledAt,
    cancellationReason: reason.trim().slice(0, 240),
    updatedAt: cancelledAt,
    escalationTaskStatus:
      alert.escalationTaskStatus === 'COMPLETED' ? 'COMPLETED' : 'CANCELLED',
  };
}

/**
 * Guards against stale escalation timers or tasks firing after an alert has been ACKNOWLEDGED, RESOLVED, or CANCELLED.
 */
export function canEscalateAlert(alert: SafetyAlert | null | undefined): boolean {
  if (!alert) return false;
  if (alert.acknowledged) return false;
  if (
    alert.status === 'ACKNOWLEDGED' ||
    alert.status === 'RESOLVED' ||
    alert.status === 'CANCELLED'
  ) {
    return false;
  }
  return true;
}

/**
 * Synchronizes an updated or newly created alert into the persistent alert history list.
 */
export function upsertAlertHistory(
  history: SafetyAlert[],
  alert: SafetyAlert
): SafetyAlert[] {
  const existingIndex = history.findIndex((item) => item.id === alert.id);
  if (existingIndex === -1) {
    return [alert, ...history].slice(0, 30);
  }
  const updated = [...history];
  updated[existingIndex] = alert;
  return updated;
}

/**
 * Advances escalation stage based on unacknowledged elapsed seconds and alert severity.
 * Note: Never sends real SMS messages directly; caps at DEMO_CONTACT_READY in simulation mode.
 */
export function computeEscalationStage(
  alert: SafetyAlert,
  elapsedSeconds: number
): EscalationStage {
  if (alert.acknowledged || alert.status === 'ACKNOWLEDGED') {
    return EscalationStage.ACKNOWLEDGED_SAFE;
  }
  if (alert.status === 'RESOLVED' || alert.status === 'CANCELLED') {
    return alert.escalationStage;
  }

  const contactReadyThreshold =
    typeof alert.escalationTimeoutSeconds === 'number' && alert.escalationTimeoutSeconds >= 15
      ? alert.escalationTimeoutSeconds
      : alert.riskLevel === RiskLevel.CRITICAL
      ? 30
      : 60;
  const overdueThreshold = Math.max(10, Math.floor(contactReadyThreshold / 2));

  if (elapsedSeconds >= contactReadyThreshold) {
    return EscalationStage.DEMO_CONTACT_READY;
  }
  if (elapsedSeconds >= overdueThreshold) {
    return EscalationStage.CHECK_IN_OVERDUE;
  }
  return EscalationStage.PROMPTED_USER;
}

