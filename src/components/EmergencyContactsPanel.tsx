import React, { useState } from 'react';
import { CheckCircle2, Lock, Plus, Send, ShieldCheck, Star, Trash2, UserCheck } from 'lucide-react';
import {
  EmergencyContact,
  EscalationPolicyConfig,
  RiskLevel,
} from '../types/safety';
import {
  DEFAULT_ESCALATION_POLICY,
  ESCALATION_TIMEOUT_BOUNDS,
  validateEscalationPolicy,
} from '../services/notificationEngine';

interface EmergencyContactsPanelProps {
  contacts: EmergencyContact[];
  escalationPolicy?: EscalationPolicyConfig;
  onUpdateEscalationPolicy?: (nextPolicy: EscalationPolicyConfig) => void;
  onToggleContactVerification?: (contactId: string) => void;
  onAddContact: (contact: Omit<EmergencyContact, 'id'>) => void;
  onRemoveContact: (id: string) => void;
  onSetPrimary: (id: string) => void;
  onSimulateDispatch: (contact: EmergencyContact) => void;
}

export const EmergencyContactsPanel: React.FC<EmergencyContactsPanelProps> = ({
  contacts,
  escalationPolicy = DEFAULT_ESCALATION_POLICY,
  onUpdateEscalationPolicy,
  onToggleContactVerification,
  onAddContact,
  onRemoveContact,
  onSetPrimary,
  onSimulateDispatch,
}) => {
  const [name, setName] = useState('');
  const [relationship, setRelationship] = useState('');
  const [phoneDisplay, setPhoneDisplay] = useState('');
  const [email, setEmail] = useState('');
  const [notifyOnLevel, setNotifyOnLevel] = useState<RiskLevel.HIGH | RiskLevel.CRITICAL>(
    RiskLevel.CRITICAL
  );
  const [formError, setFormError] = useState<string | null>(null);
  const [simulatedNotice, setSimulatedNotice] = useState<string | null>(null);
  const [showLiveModeReviewModal, setShowLiveModeReviewModal] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!name.trim() || !relationship.trim() || !phoneDisplay.trim()) {
      setFormError('Please provide a contact name, relationship, and demo phone number.');
      return;
    }

    onAddContact({
      name: name.trim(),
      relationship: relationship.trim(),
      phoneDisplay: phoneDisplay.trim(),
      email: email.trim() || 'demo.contact@example.com',
      isPrimary: contacts.length === 0,
      notifyOnLevel,
      verificationStatus: 'PENDING_CODE',
      consentGranted: false,
    });

    setName('');
    setRelationship('');
    setPhoneDisplay('');
    setEmail('');
  };

  const handleTestDispatch = (contact: EmergencyContact) => {
    onSimulateDispatch(contact);
    setSimulatedNotice(
      `Simulated notification logged locally for ${contact.name} (${contact.phoneDisplay}). Reminder: Demo mode only — no actual SMS or external message was sent.`
    );
  };

  const handleTimeoutChange = (
    field: 'criticalTimeoutSeconds' | 'highTimeoutSeconds',
    rawValue: number
  ) => {
    if (!onUpdateEscalationPolicy) return;
    try {
      const next = validateEscalationPolicy({
        ...escalationPolicy,
        [field]: rawValue,
      });
      onUpdateEscalationPolicy(next);
    } catch (err) {
      setSimulatedNotice(
        err instanceof Error ? err.message : 'Invalid timeout bounds.'
      );
    }
  };

  const handleToggleConsent = (checked: boolean) => {
    if (!onUpdateEscalationPolicy) return;
    const next = validateEscalationPolicy({
      ...escalationPolicy,
      explicitLiveConsentGranted: checked,
      liveReviewCompleted: checked ? escalationPolicy.liveReviewCompleted : false,
      deliveryMode: checked ? escalationPolicy.deliveryMode : 'SIMULATION',
    });
    onUpdateEscalationPolicy(next);
  };

  const handleConfirmLiveGateway = () => {
    if (!onUpdateEscalationPolicy) return;
    const verifiedCount = contacts.filter(
      (c) => c.verificationStatus === 'VERIFIED' && c.consentGranted !== false
    ).length;
    if (!escalationPolicy.explicitLiveConsentGranted || verifiedCount === 0) {
      setSimulatedNotice(
        'Cannot enable Verified Gateway Mode: At least 1 contact must be VERIFIED and explicit user consent must be granted.'
      );
      setShowLiveModeReviewModal(false);
      return;
    }

    const next = validateEscalationPolicy({
      ...escalationPolicy,
      explicitLiveConsentGranted: true,
      liveReviewCompleted: true,
      deliveryMode: 'LIVE',
      liveConsentConfirmedAtIso: new Date().toISOString(),
    });
    onUpdateEscalationPolicy(next);
    setShowLiveModeReviewModal(false);
    setSimulatedNotice(
      'Escalation policy updated to Verified Gateway Mode. Note: Server-side VITAGUARD_ENABLE_LIVE_SMS remains disabled by default unless server secrets are provisioned.'
    );
  };

  const handleRevertToSimulation = () => {
    if (!onUpdateEscalationPolicy) return;
    const next = validateEscalationPolicy({
      ...escalationPolicy,
      deliveryMode: 'SIMULATION',
    });
    onUpdateEscalationPolicy(next);
    setSimulatedNotice('Reverted to safe Simulation Mode (no external SMS dispatches).');
  };

  return (
    <section
      aria-labelledby="contacts-heading"
      className="vg-card p-6 space-y-6"
    >
      <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-2 pb-4 border-b border-[#DCE4EE]">
        <div>
          <h2 id="contacts-heading" className="text-lg font-semibold text-[#0C192C]">
            Emergency Contacts & Escalation Consent Policy
          </h2>
          <p className="text-xs text-[#5E738B] mt-0.5">
            Configure verified escalation contacts, timeout deadlines, and explicit notification consent. Live mode is disabled by default.
          </p>
        </div>
        <span className="text-xs font-mono tabular-nums text-[#5E738B]">
          {contacts.length} contact(s) configured
        </span>
      </div>

      {/* Escalation Policy & Consent Governance */}
      {onUpdateEscalationPolicy && (
        <div className="p-4 vg-well space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-[#155EEF]" aria-hidden="true" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#0C192C]">
                Escalation Policy, Timeout Bounds & Consent Gate
              </h3>
            </div>
            <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded bg-[#EFF5FF] border border-[#C2D8FF] text-[#1042A8]">
              Mode: {escalationPolicy.deliveryMode}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div>
              <label
                htmlFor="critical-timeout-input"
                className="block font-medium text-[#334760] mb-1"
              >
                Critical Alert Deadline ({ESCALATION_TIMEOUT_BOUNDS.criticalMinSeconds}–
                {ESCALATION_TIMEOUT_BOUNDS.criticalMaxSeconds}s)
              </label>
              <input
                id="critical-timeout-input"
                type="number"
                min={ESCALATION_TIMEOUT_BOUNDS.criticalMinSeconds}
                max={ESCALATION_TIMEOUT_BOUNDS.criticalMaxSeconds}
                value={escalationPolicy.criticalTimeoutSeconds}
                onChange={(e) =>
                  handleTimeoutChange('criticalTimeoutSeconds', Number(e.target.value))
                }
                className="w-full rounded-lg border border-[#C3D0E0] bg-white px-3 py-1.5 font-mono tabular-nums text-[#0C192C]"
              />
            </div>

            <div>
              <label
                htmlFor="high-timeout-input"
                className="block font-medium text-[#334760] mb-1"
              >
                High Alert Deadline ({ESCALATION_TIMEOUT_BOUNDS.highMinSeconds}–
                {ESCALATION_TIMEOUT_BOUNDS.highMaxSeconds}s)
              </label>
              <input
                id="high-timeout-input"
                type="number"
                min={ESCALATION_TIMEOUT_BOUNDS.highMinSeconds}
                max={ESCALATION_TIMEOUT_BOUNDS.highMaxSeconds}
                value={escalationPolicy.highTimeoutSeconds}
                onChange={(e) =>
                  handleTimeoutChange('highTimeoutSeconds', Number(e.target.value))
                }
                className="w-full rounded-lg border border-[#C3D0E0] bg-white px-3 py-1.5 font-mono tabular-nums text-[#0C192C]"
              />
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-[#E3EAF2]">
            <label className="flex items-start gap-2.5 text-xs text-[#334760] cursor-pointer">
              <input
                type="checkbox"
                checked={escalationPolicy.explicitLiveConsentGranted}
                onChange={(e) => handleToggleConsent(e.target.checked)}
                className="mt-0.5 rounded border-[#C3D0E0]"
              />
              <span>
                <strong className="text-[#0C192C]">Explicit Escalation Consent:</strong> Authorize VitaGuard AI to notify verified emergency contacts with privacy-safe check-in prompts if an active High/Critical alert expires unacknowledged.
              </span>
            </label>

            <div className="shrink-0">
              {escalationPolicy.deliveryMode === 'LIVE' ? (
                <button
                  type="button"
                  onClick={handleRevertToSimulation}
                  className="vg-btn-secondary px-3 py-1.5 text-xs"
                >
                  Revert to Simulation Mode
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowLiveModeReviewModal(true)}
                  className="vg-btn-secondary px-3 py-1.5 text-xs inline-flex items-center gap-1.5"
                >
                  <Lock className="w-3 h-3" aria-hidden="true" />
                  <span>Review Live Gateway Mode</span>
                </button>
              )}
            </div>
          </div>

          {showLiveModeReviewModal && (
            <div className="p-4 rounded-lg bg-[#FFFBEB] border border-[#FDE68A] text-xs text-[#92400E] space-y-3">
              <div className="font-bold">
                Pre-Activation Review: Verified SMS Gateway Mode
              </div>
              <p>
                Enabling Verified Gateway Mode requires: (1) explicit user consent above, (2) at least one <strong>VERIFIED</strong> emergency contact, and (3) server-side <code>SMS_GATEWAY_API_KEY</code> and <code>VITAGUARD_ENABLE_LIVE_SMS=true</code> secrets. Raw vital readings (BPM, SpO2, body temperature) are never included in outbound messages.
              </p>
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowLiveModeReviewModal(false)}
                  className="vg-btn-secondary px-3 py-1.5 text-xs"
                >
                  Cancel (Keep Simulation)
                </button>
                <button
                  type="button"
                  onClick={handleConfirmLiveGateway}
                  className="vg-btn-primary px-3 py-1.5 text-xs"
                >
                  Confirm Review & Enable Policy
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {simulatedNotice && (
        <div
          role="status"
          className="p-3.5 rounded-lg bg-[#EFF5FF] border border-[#C2D8FF] text-xs text-[#1042A8] flex items-center justify-between gap-3"
        >
          <span>{simulatedNotice}</span>
          <button
            type="button"
            onClick={() => setSimulatedNotice(null)}
            className="text-xs font-bold text-[#1042A8] underline shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Contacts List or Empty State */}
      {contacts.length === 0 ? (
        <div className="p-8 vg-well text-center space-y-2">
          <UserCheck className="w-6 h-6 text-[#8295AC] mx-auto" aria-hidden="true" />
          <div className="text-sm font-semibold text-[#0C192C]">
            No Demo Emergency Contacts Configured
          </div>
          <p className="text-xs text-[#5E738B] max-w-md mx-auto">
            Add a demo contact below to test how VitaGuard AI stages escalation notifications when an alert goes unacknowledged.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {contacts.map((contact) => {
            const isVerified = contact.verificationStatus === 'VERIFIED';
            return (
              <article
                key={contact.id}
                className="p-4 rounded-xl border border-[#DCE4EE] bg-white flex flex-col justify-between gap-4"
              >
                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-bold text-[#0C192C]">
                      {contact.name}
                    </h3>
                    <div className="text-xs text-[#5E738B] flex items-center gap-1.5">
                      {contact.isPrimary ? (
                        <span className="font-bold text-[#155EEF]">Primary Contact</span>
                      ) : (
                        <span>Secondary</span>
                      )}
                      <span aria-hidden="true">·</span>
                      <span className="uppercase font-mono text-[#334760] font-semibold">{contact.notifyOnLevel}</span>
                      <span aria-hidden="true">·</span>
                      <span
                        className={`font-mono font-bold text-[11px] ${
                          isVerified ? 'text-[#065F46]' : 'text-[#92400E]'
                        }`}
                      >
                        {contact.verificationStatus || 'VERIFIED'}
                      </span>
                    </div>
                  </div>
                  <div className="text-xs text-[#334760]">
                    {contact.relationship} ·{' '}
                    <span className="font-mono tabular-nums">{contact.phoneDisplay}</span> ·{' '}
                    <span>{contact.email}</span>
                  </div>
                  {contact.lastSimulatedDispatchAt && (
                    <div className="text-[11px] font-mono tabular-nums text-[#5E738B] pt-1">
                      Last simulated log:{' '}
                      {new Date(contact.lastSimulatedDispatchAt).toLocaleTimeString()}
                    </div>
                  )}
                </div>

                <div className="pt-3 border-t border-[#E3EAF2] flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    {!contact.isPrimary && (
                      <button
                        type="button"
                        onClick={() => onSetPrimary(contact.id)}
                        className="vg-btn-secondary px-2.5 py-1.5 text-xs inline-flex items-center gap-1 whitespace-nowrap shrink-0"
                      >
                        <Star className="w-3 h-3" aria-hidden="true" />
                        <span>Set Primary</span>
                      </button>
                    )}
                    {onToggleContactVerification && (
                      <button
                        type="button"
                        onClick={() => onToggleContactVerification(contact.id)}
                        className="vg-btn-secondary px-2.5 py-1.5 text-xs inline-flex items-center gap-1 whitespace-nowrap shrink-0"
                      >
                        <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
                        <span>{isVerified ? 'Revoke Verify' : 'Verify Contact'}</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleTestDispatch(contact)}
                      className="vg-btn-secondary px-2.5 py-1.5 text-xs inline-flex items-center gap-1 whitespace-nowrap shrink-0"
                    >
                      <Send className="w-3 h-3" aria-hidden="true" />
                      <span>Simulate Alert Log</span>
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => onRemoveContact(contact.id)}
                    aria-label={`Remove ${contact.name}`}
                    className="px-2.5 py-1.5 text-xs font-semibold text-[#991B1B] hover:bg-[#FEF2F2] rounded-md transition-colors inline-flex items-center gap-1 whitespace-nowrap shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Remove</span>
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Add Demo Contact Form */}
      <form
        onSubmit={handleSubmit}
        className="pt-4 border-t border-[#DCE4EE] space-y-4"
      >
        <h3 className="text-sm font-semibold text-[#0C192C]">
          Add Demo Emergency Contact
        </h3>

        {formError && (
          <div
            role="alert"
            className="p-3 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-xs text-[#991B1B]"
          >
            {formError}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div>
            <label htmlFor="contact-name" className="block text-xs font-medium text-[#334760] mb-1">
              Full Name
            </label>
            <input
              id="contact-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Elena Vance"
              className="w-full rounded-lg border border-[#C3D0E0] bg-white px-3 py-2 text-xs text-[#0C192C]"
            />
          </div>

          <div>
            <label htmlFor="contact-rel" className="block text-xs font-medium text-[#334760] mb-1">
              Relationship
            </label>
            <input
              id="contact-rel"
              type="text"
              value={relationship}
              onChange={(e) => setRelationship(e.target.value)}
              placeholder="e.g., Partner / Medical Proxy"
              className="w-full rounded-lg border border-[#C3D0E0] bg-white px-3 py-2 text-xs text-[#0C192C]"
            />
          </div>

          <div>
            <label htmlFor="contact-phone" className="block text-xs font-medium text-[#334760] mb-1">
              Demo Phone Label
            </label>
            <input
              id="contact-phone"
              type="text"
              value={phoneDisplay}
              onChange={(e) => setPhoneDisplay(e.target.value)}
              placeholder="e.g., +1 (555) 019-2834"
              className="w-full rounded-lg border border-[#C3D0E0] bg-white px-3 py-2 text-xs font-mono tabular-nums text-[#0C192C]"
            />
          </div>

          <div>
            <label htmlFor="contact-email" className="block text-xs font-medium text-[#334760] mb-1">
              Demo Email
            </label>
            <input
              id="contact-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="elena.demo@example.org"
              className="w-full rounded-lg border border-[#C3D0E0] bg-white px-3 py-2 text-xs text-[#0C192C]"
            />
          </div>

          <div>
            <label htmlFor="contact-level" className="block text-xs font-medium text-[#334760] mb-1">
              Escalation Trigger
            </label>
            <select
              id="contact-level"
              value={notifyOnLevel}
              onChange={(e) =>
                setNotifyOnLevel(e.target.value as RiskLevel.HIGH | RiskLevel.CRITICAL)
              }
              className="w-full rounded-lg border border-[#C3D0E0] bg-white px-3 py-2 text-xs text-[#0C192C]"
            >
              <option value={RiskLevel.CRITICAL}>Critical Risk Only</option>
              <option value={RiskLevel.HIGH}>High & Critical Risk</option>
            </select>
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            className="vg-btn-primary px-4 py-2 text-xs inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Add Demo Contact</span>
          </button>
        </div>
      </form>
    </section>
  );
};

