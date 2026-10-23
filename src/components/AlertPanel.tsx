import React, { useState } from 'react';
import { CheckCircle2, Clock, Radio, ShieldAlert, Trash2, Zap } from 'lucide-react';
import {
  EmergencyContact,
  EscalationPolicyConfig,
  EscalationStage,
  EscalationTaskRecord,
  NotificationAttemptRecord,
  RiskLevel,
  SafetyAlert,
  SafetyEvent,
} from '../types/safety';
import { SimulatedProviderBehavior } from '../services/notificationEngine';

interface AlertPanelProps {
  activeAlert: SafetyAlert | null;
  alertHistory: SafetyAlert[];
  events: SafetyEvent[];
  primaryContact: EmergencyContact | undefined;
  escalationPolicy?: EscalationPolicyConfig;
  escalationTasks?: EscalationTaskRecord[];
  notificationAttempts?: NotificationAttemptRecord[];
  simulationFaultMode?: SimulatedProviderBehavior;
  onChangeFaultMode?: (mode: SimulatedProviderBehavior) => void;
  onTriggerDueEscalationNow?: () => void;
  onAcknowledgeSafe: (note: string, targetAlertId?: string) => void;
  onAdvanceEscalationDemo: () => void;
  onClearEventHistory: () => void;
}

const ESCALATION_STEPS: {
  stage: EscalationStage;
  label: string;
  description: string;
}[] = [
  {
    stage: EscalationStage.MONITORING,
    label: '1. Passive Monitoring',
    description: 'Continuous rule evaluation across vital and ambient sensors.',
  },
  {
    stage: EscalationStage.PROMPTED_USER,
    label: '2. Check-In Prompted',
    description: 'Durable escalation deadline persisted; user prompted to confirm "I am safe".',
  },
  {
    stage: EscalationStage.CHECK_IN_OVERDUE,
    label: '3. Check-In Overdue',
    description: 'Approaching server escalation deadline; awaiting authoritative recheck.',
  },
  {
    stage: EscalationStage.DEMO_CONTACT_READY,
    label: '4. Contact Notification Dispatched',
    description: 'Deadline expired; server rechecked alert state and executed notification policy.',
  },
];

const STAGE_ORDER: Record<EscalationStage, number> = {
  [EscalationStage.MONITORING]: 0,
  [EscalationStage.PROMPTED_USER]: 1,
  [EscalationStage.CHECK_IN_OVERDUE]: 2,
  [EscalationStage.DEMO_CONTACT_READY]: 3,
  [EscalationStage.ACKNOWLEDGED_SAFE]: 1,
};

export const AlertPanel: React.FC<AlertPanelProps> = ({
  activeAlert,
  alertHistory,
  events,
  primaryContact,
  escalationPolicy,
  escalationTasks = [],
  notificationAttempts = [],
  simulationFaultMode = 'normal_submitted',
  onChangeFaultMode,
  onTriggerDueEscalationNow,
  onAcknowledgeSafe,
  onAdvanceEscalationDemo,
  onClearEventHistory,
}) => {
  const [checkInNote, setCheckInNote] = useState('');
  const [eventFilter, setEventFilter] = useState<'all' | 'alerts' | 'acknowledgements'>('all');

  const handleConfirmSafe = (e: React.FormEvent) => {
    e.preventDefault();
    onAcknowledgeSafe(checkInNote);
    setCheckInNote('');
  };

  const filteredEvents = events.filter((evt) => {
    if (eventFilter === 'alerts') {
      return (
        evt.type === 'alert_triggered' ||
        evt.type === 'escalation_step' ||
        evt.type === 'escalation_scheduled' ||
        evt.type === 'escalation_cancelled' ||
        evt.type === 'notification_attempt'
      );
    }
    if (eventFilter === 'acknowledgements') {
      return evt.type === 'user_acknowledged';
    }
    return true;
  });

  const currentStage = activeAlert
    ? activeAlert.escalationStage
    : EscalationStage.MONITORING;

  const activeTask = activeAlert
    ? escalationTasks.find((t) => t.alertId === activeAlert.id)
    : undefined;

  const deliveryModeLabel =
    escalationPolicy?.deliveryMode === 'LIVE' && escalationPolicy?.explicitLiveConsentGranted
      ? 'VERIFIED GATEWAY MODE'
      : 'SIMULATION MODE — NO REAL SMS';

  return (
    <section aria-labelledby="alert-panel-heading" className="space-y-6">
      {/* Active Alert & Escalation Card */}
      <div className="vg-card p-5 sm:p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[#DCE4EE]">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="alert-panel-heading" className="text-lg font-semibold text-[#0C192C]">
                Active Alert & Durable Escalation Status
              </h2>
              <span className="px-2 py-0.5 text-[11px] font-mono font-semibold uppercase rounded bg-[#EFF5FF] text-[#1042A8] border border-[#C2D8FF]">
                {deliveryModeLabel}
              </span>
            </div>
            <p className="text-xs text-[#5E738B] mt-0.5">
              Server-persisted deadline workflow · Confirm safety to cancel scheduled escalation
            </p>
          </div>
          <div className="text-xs font-mono tabular-nums text-[#334760]">
            Escalation State:{' '}
            <span className="font-bold text-[#0C192C] uppercase">
              {currentStage.replace(/_/g, ' ')}
            </span>
          </div>
        </div>

        {/* Escalation Stage Progression */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {ESCALATION_STEPS.map((step, idx) => {
            const isAcked = currentStage === EscalationStage.ACKNOWLEDGED_SAFE;
            const currentIdx = STAGE_ORDER[currentStage];
            const isCurrent = !isAcked && currentStage === step.stage;
            const isPassed = !isAcked && currentIdx > idx;

            return (
              <div
                key={step.stage}
                className={`p-3.5 rounded-lg border text-xs transition-colors ${
                  isCurrent
                    ? 'border-[#155EEF] bg-[#EFF5FF]/80 ring-1 ring-[#155EEF]/30'
                    : isPassed
                    ? 'border-[#C3D0E0] bg-[#F7F9FC]'
                    : 'border-[#E3EAF2] bg-white'
                }`}
              >
                <div className="font-bold text-[#0C192C] flex items-center justify-between">
                  <span>{step.label}</span>
                  {isCurrent && (
                    <span className="text-[11px] font-mono font-bold text-[#155EEF]">Active</span>
                  )}
                </div>
                <p className="text-[#334760] mt-1 leading-relaxed">{step.description}</p>
              </div>
            );
          })}
        </div>

        {/* Active Alert Body or Empty Safe State */}
        {!activeAlert ? (
          <div className="p-5 sm:p-6 rounded-xl bg-[#ECFDF5]/60 border border-[#A7F3D0] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-sm font-bold text-[#065F46]">
                <CheckCircle2 className="w-4 h-4 text-[#059669] shrink-0" aria-hidden="true" />
                <span>No Active Safety Alerts — Status Nominal</span>
              </div>
              <p className="text-xs text-[#334760]">
                All simulated vital signs and environmental readings are within low-risk boundaries. Select a high-risk scenario preset or raise heart rate / ambient temperature in the simulator to trigger an alert and test the durable escalation & "I am safe" check-in workflow.
              </p>
            </div>
          </div>
        ) : (
          <div
            className={`p-5 rounded-xl border space-y-4 ${
              activeAlert.acknowledged
                ? 'bg-[#ECFDF5]/80 border-[#A7F3D0]'
                : activeAlert.riskLevel === RiskLevel.CRITICAL
                ? 'bg-[#FEF2F2] border-[#FECACA]'
                : activeAlert.riskLevel === RiskLevel.HIGH
                ? 'bg-[#FFF7ED] border-[#FDBA74]'
                : 'bg-[#FFFBEB] border-[#FDE68A]'
            }`}
          >
            <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-2 text-xs text-[#334760] font-mono tabular-nums">
                  <span>Alert ID: {activeAlert.id}</span>
                  <span aria-hidden="true">·</span>
                  <span>Elapsed: {activeAlert.secondsSinceTriggered}s</span>
                  {activeAlert.escalationDeadlineIso && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>
                        Deadline:{' '}
                        {new Date(activeAlert.escalationDeadlineIso).toLocaleTimeString()}
                      </span>
                    </>
                  )}
                  <span aria-hidden="true">·</span>
                  <span className="font-bold text-[#0C192C]">
                    Task:{' '}
                    {activeTask?.status ||
                      activeAlert.escalationTaskStatus ||
                      (activeAlert.acknowledged ? 'CANCELLED' : 'SCHEDULED')}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="font-bold text-[#0C192C]">
                    Status:{' '}
                    {activeAlert.acknowledged
                      ? 'ACKNOWLEDGED ("I am safe")'
                      : 'ACTIVE — AWAITING CHECK-IN'}
                  </span>
                </div>

                <h3 className="text-base font-bold text-[#0C192C]">
                  {activeAlert.title}
                </h3>
                <p className="text-xs text-[#334760] leading-relaxed max-w-3xl">
                  {activeAlert.summary}
                </p>

                {primaryContact && !activeAlert.acknowledged && (
                  <p className="text-xs text-[#334760] pt-1">
                    Designated Contact:{' '}
                    <span className="font-bold text-[#0C192C]">
                      {primaryContact.name} ({primaryContact.relationship})
                    </span>{' '}
                    · Verification:{' '}
                    <span className="font-mono font-bold text-[#065F46]">
                      {primaryContact.verificationStatus || 'VERIFIED'}
                    </span>{' '}
                    — {deliveryModeLabel}.
                  </p>
                )}

                {activeAlert.acknowledged && (
                  <div className="pt-2 text-xs text-[#065F46] font-semibold">
                    Confirmed "I am safe" at{' '}
                    <span className="font-mono tabular-nums">
                      {new Date(activeAlert.acknowledgedAt!).toLocaleTimeString()}
                    </span>{' '}
                    — Pending escalation task cancelled. Note: "{activeAlert.acknowledgementNote}"
                  </div>
                )}
              </div>

              {!activeAlert.acknowledged && (
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={onAdvanceEscalationDemo}
                    className="vg-btn-secondary px-3.5 py-2.5 text-xs whitespace-nowrap shrink-0 inline-flex items-center justify-center gap-1.5"
                  >
                    <Clock className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Simulate +15s Escalation</span>
                  </button>
                  {onTriggerDueEscalationNow && (
                    <button
                      type="button"
                      onClick={onTriggerDueEscalationNow}
                      className="px-3.5 py-2.5 text-xs font-bold text-[#92400E] bg-[#FFFBEB] border border-[#FDE68A] rounded-lg hover:bg-[#FEF3C7] transition-colors whitespace-nowrap shrink-0 inline-flex items-center justify-center gap-1.5"
                    >
                      <Zap className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Execute Deadline Recheck</span>
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Acknowledgement Form with "I am safe" button */}
            {!activeAlert.acknowledged && (
              <form
                onSubmit={handleConfirmSafe}
                className="pt-3 border-t border-[#C3D0E0]/60 flex flex-col sm:flex-row items-stretch sm:items-center gap-3"
              >
                <label htmlFor="safe-checkin-note" className="sr-only">
                  Optional check-in note
                </label>
                <input
                  id="safe-checkin-note"
                  type="text"
                  value={checkInNote}
                  onChange={(e) => setCheckInNote(e.target.value)}
                  placeholder="Optional check-in note (e.g., Taking a rest break indoors, feeling fine)..."
                  className="flex-1 rounded-lg border border-[#C3D0E0] bg-white px-3.5 py-2.5 text-xs text-[#0C192C] placeholder:text-[#8295AC]"
                />
                <button
                  type="submit"
                  className="vg-btn-safe px-5 py-2.5 text-xs whitespace-nowrap shrink-0"
                >
                  I am safe
                </button>
              </form>
            )}
          </div>
        )}
      </div>

      {/* Notification Attempt Ledger & Provider Fault Injection */}
      <div className="vg-card p-5 sm:p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#DCE4EE]">
          <div>
            <div className="flex items-center gap-2">
              <Radio className="w-4 h-4 text-[#155EEF]" aria-hidden="true" />
              <h3 className="text-base font-semibold text-[#0C192C]">
                Notification Delivery & Attempt Ledger
              </h3>
            </div>
            <p className="text-xs text-[#5E738B] mt-0.5">
              Tracks idempotent notification attempts, provider response classifications, and privacy-safe message payloads
            </p>
          </div>

          {onChangeFaultMode && (
            <div className="flex items-center gap-2 text-xs">
              <label htmlFor="provider-fault-mode" className="font-medium text-[#334760] whitespace-nowrap">
                Sim Provider Fault:
              </label>
              <select
                id="provider-fault-mode"
                value={simulationFaultMode}
                onChange={(e) => onChangeFaultMode(e.target.value as SimulatedProviderBehavior)}
                className="rounded-lg border border-[#C3D0E0] bg-white px-2.5 py-1.5 text-xs text-[#0C192C] font-mono"
              >
                <option value="normal_submitted">NORMAL (Submitted)</option>
                <option value="normal_delivered">DELIVERED_CONFIRMED</option>
                <option value="transient_failure">TRANSIENT_FAILURE (503)</option>
                <option value="permanent_failure">INVALID_RECIPIENT (400)</option>
                <option value="timeout_unknown">TIMEOUT_UNKNOWN (504)</option>
              </select>
            </div>
          )}
        </div>

        {notificationAttempts.length === 0 ? (
          <div className="py-6 text-center text-xs text-[#5E738B]">
            No notification attempts recorded yet. When an alert deadline expires while still ACTIVE (and policy/consent requirements are met), attempts appear here.
          </div>
        ) : (
          <div className="overflow-x-auto border border-[#DCE4EE] rounded-lg">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="vg-table-header">
                  <th className="py-2.5 px-3">Recipient & Mode</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3">Provider Classification</th>
                  <th className="py-2.5 px-3">Privacy-Safe Payload Preview</th>
                  <th className="py-2.5 px-3">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E3EAF2]">
                {notificationAttempts.map((att) => (
                  <tr key={att.attemptId} className="hover:bg-[#F7F9FC]">
                    <td className="py-2.5 px-3">
                      <div className="font-semibold text-[#0C192C]">{att.recipientRef}</div>
                      <div className="text-[11px] font-mono text-[#5E738B]">
                        {att.recipientRole} · {att.deliveryMode}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 font-mono font-bold whitespace-nowrap">
                      <span
                        className={
                          att.deliveryStatus === 'DELIVERED'
                            ? 'text-[#065F46]'
                            : att.deliveryStatus === 'SUBMITTED'
                            ? 'text-[#155EEF]'
                            : att.deliveryStatus === 'FAILED'
                            ? 'text-[#991B1B]'
                            : 'text-[#92400E]'
                        }
                      >
                        {att.deliveryStatus}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 font-mono text-[11px] text-[#334760]">
                      <div>{att.responseClassification || 'NONE'}</div>
                      {att.sanitizedError && (
                        <div className="text-[#991B1B] font-sans">{att.sanitizedError}</div>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-[#334760] max-w-md">
                      <div className="line-clamp-2 font-mono text-[11px]">
                        {att.messagePreview}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 font-mono tabular-nums text-[#5E738B] whitespace-nowrap">
                      {new Date(att.attemptedAtIso).toLocaleTimeString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Alert History & Status Log */}
      <div className="vg-card p-5 sm:p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-2 pb-3 border-b border-[#DCE4EE]">
          <div>
            <h3 className="text-base font-semibold text-[#0C192C]">
              Alert History & Status Log
            </h3>
            <p className="text-xs text-[#5E738B]">
              Tracks every triggered safety alert and its real-time acknowledgement status
            </p>
          </div>
          <span className="text-xs font-mono tabular-nums text-[#5E738B]">
            {alertHistory.length} alert(s) recorded
          </span>
        </div>

        {alertHistory.length === 0 ? (
          <div className="py-6 text-center text-xs text-[#5E738B]">
            No alerts have been triggered in this session yet. Select a Moderate, High, or Critical scenario preset to generate an alert.
          </div>
        ) : (
          <div className="overflow-x-auto border border-[#DCE4EE] rounded-lg">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="vg-table-header">
                  <th className="py-2.5 px-3">Alert Summary</th>
                  <th className="py-2.5 px-3">Risk Level</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3">Triggered At</th>
                  <th className="py-2.5 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E3EAF2]">
                {alertHistory.map((item) => {
                  const isCurrentActive = activeAlert?.id === item.id;
                  const resolvedLifecycleStatus =
                    item.status ||
                    (item.acknowledged
                      ? 'ACKNOWLEDGED'
                      : isCurrentActive
                      ? 'ACTIVE'
                      : 'RESOLVED');

                  const statusLabel =
                    resolvedLifecycleStatus === 'ACKNOWLEDGED' || item.acknowledged
                      ? 'ACKNOWLEDGED — "I am safe"'
                      : resolvedLifecycleStatus === 'CANCELLED'
                      ? 'CANCELLED'
                      : resolvedLifecycleStatus === 'ACTIVE' && isCurrentActive
                      ? `ACTIVE (${item.escalationStage.replace(/_/g, ' ')})`
                      : 'RESOLVED — Readings Nominal';

                  return (
                    <tr key={item.id} className="hover:bg-[#F7F9FC]">
                      <td className="py-2.5 px-3">
                        <div className="font-semibold text-[#0C192C]">{item.title}</div>
                        {item.acknowledgementNote && (
                          <div className="text-[11px] text-[#065F46] mt-0.5">
                            Check-in note: "{item.acknowledgementNote}"
                          </div>
                        )}
                      </td>
                      <td
                        className={`py-2.5 px-3 font-mono uppercase font-bold whitespace-nowrap ${
                          item.riskLevel === RiskLevel.CRITICAL
                            ? 'text-[#991B1B]'
                            : item.riskLevel === RiskLevel.HIGH
                            ? 'text-[#9A3412]'
                            : 'text-[#92400E]'
                        }`}
                      >
                        {item.riskLevel}
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <span
                          className={`font-semibold ${
                            item.acknowledged || resolvedLifecycleStatus === 'ACKNOWLEDGED'
                              ? 'text-[#065F46]'
                              : resolvedLifecycleStatus === 'ACTIVE' && isCurrentActive
                              ? 'text-[#92400E]'
                              : 'text-[#5E738B]'
                          }`}
                        >
                          {statusLabel}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-mono tabular-nums text-[#5E738B] whitespace-nowrap">
                        {new Date(item.createdAt).toLocaleTimeString()}
                      </td>
                      <td className="py-2.5 px-3 text-right whitespace-nowrap">
                        {!item.acknowledged ? (
                          <button
                            type="button"
                            onClick={() =>
                              onAcknowledgeSafe(
                                'Confirmed "I am safe" from Alert History.',
                                item.id
                              )
                            }
                            className="vg-btn-safe px-3 py-1.5 text-xs whitespace-nowrap shrink-0"
                          >
                            I am safe
                          </button>
                        ) : (
                          <span className="text-[#065F46] font-mono font-semibold text-[11px]">
                            Verified Safe
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Alert & Safety Event Timeline */}
      <div className="vg-card p-5 sm:p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#DCE4EE]">
          <div>
            <h3 className="text-base font-semibold text-[#0C192C]">
              Chronological Event Timeline
            </h3>
            <p className="text-xs text-[#5E738B]">
              Audit trail of risk changes, durable escalations, notification attempts, and "I am safe" acknowledgements
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Interactive Filter Controls */}
            <div className="flex items-center gap-1 p-1 bg-[#F3F6FA] border border-[#DCE4EE] rounded-lg">
              <button
                type="button"
                onClick={() => setEventFilter('all')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  eventFilter === 'all'
                    ? 'bg-[#155EEF] text-white shadow-2xs'
                    : 'text-[#334760] hover:text-[#0C192C]'
                }`}
              >
                All ({events.length})
              </button>
              <button
                type="button"
                onClick={() => setEventFilter('alerts')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  eventFilter === 'alerts'
                    ? 'bg-[#155EEF] text-white shadow-2xs'
                    : 'text-[#334760] hover:text-[#0C192C]'
                }`}
              >
                Alerts
              </button>
              <button
                type="button"
                onClick={() => setEventFilter('acknowledgements')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  eventFilter === 'acknowledgements'
                    ? 'bg-[#155EEF] text-white shadow-2xs'
                    : 'text-[#334760] hover:text-[#0C192C]'
                }`}
              >
                Acknowledgements
              </button>
            </div>

            {events.length > 0 && (
              <button
                type="button"
                onClick={onClearEventHistory}
                className="vg-btn-secondary px-3 py-1.5 text-xs inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Clear Log</span>
              </button>
            )}
          </div>
        </div>

        {filteredEvents.length === 0 ? (
          <div className="py-10 text-center space-y-2">
            <ShieldAlert className="w-6 h-6 text-[#8295AC] mx-auto" aria-hidden="true" />
            <div className="text-sm font-semibold text-[#0C192C]">
              No matching timeline events recorded
            </div>
            <p className="text-xs text-[#5E738B] max-w-md mx-auto">
              Trigger a scenario in the Live Simulator or acknowledge an active alert to populate the chronological safety log.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-[#E3EAF2] max-h-80 overflow-y-auto pr-1">
            {filteredEvents.map((evt) => (
              <div
                key={evt.id}
                className="py-3 flex flex-col sm:flex-row sm:items-baseline justify-between gap-2 text-xs"
              >
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-[#0C192C]">{evt.title}</span>
                    <span aria-hidden="true" className="text-[#C3D0E0]">·</span>
                    <span
                      className={`font-mono uppercase font-bold ${
                        evt.riskLevel === RiskLevel.CRITICAL
                          ? 'text-[#991B1B]'
                          : evt.riskLevel === RiskLevel.HIGH
                          ? 'text-[#9A3412]'
                          : evt.riskLevel === RiskLevel.MODERATE
                          ? 'text-[#92400E]'
                          : 'text-[#065F46]'
                      }`}
                    >
                      {evt.riskLevel}
                    </span>
                  </div>
                  <p className="text-[#334760]">{evt.detail}</p>
                </div>
                <time
                  dateTime={evt.timestamp}
                  className="font-mono tabular-nums text-[#5E738B] shrink-0"
                >
                  {new Date(evt.timestamp).toLocaleTimeString()}
                </time>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
};

