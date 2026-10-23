import React from 'react';
import {
  EmergencyContact,
  EscalationPolicyConfig,
  SafetyAlert,
} from '../types/safety';
import { useSafetyWorkspace } from '../context/SafetyWorkspaceContext';
import { EmergencyContactsPanel } from '../components/EmergencyContactsPanel';

interface ContactsPageProps {
  contacts?: EmergencyContact[];
  escalationPolicy?: EscalationPolicyConfig;
  onUpdateEscalationPolicy?: (p: EscalationPolicyConfig) => void;
  onToggleContactVerification?: (id: string) => void;
  onAddContact?: (contact: Omit<EmergencyContact, 'id'>) => void;
  onRemoveContact?: (id: string) => void;
  onSetPrimary?: (id: string) => void;
  onSimulateDispatch?: (contact: EmergencyContact) => void;
  activeAlert?: SafetyAlert | null;
}

export const ContactsPage: React.FC<ContactsPageProps> = (props) => {
  const workspace = useSafetyWorkspace();

  const contacts = props.contacts ?? workspace.contacts;
  const escalationPolicy = props.escalationPolicy ?? workspace.escalationPolicy;
  const onUpdateEscalationPolicy = props.onUpdateEscalationPolicy ?? workspace.handleUpdateEscalationPolicy;
  const onToggleContactVerification = props.onToggleContactVerification ?? workspace.handleToggleContactVerification;
  const onAddContact = props.onAddContact ?? workspace.handleAddContact;
  const onRemoveContact = props.onRemoveContact ?? workspace.handleRemoveContact;
  const onSetPrimary = props.onSetPrimary ?? workspace.handleSetPrimaryContact;
  const onSimulateDispatch = props.onSimulateDispatch ?? workspace.handleSimulateDispatch;

  return (
    <div className="space-y-8" data-testid="page-contacts">
      {/* Page Header */}
      <div className="bg-white border border-[#DCE4EE] rounded-xl p-5 sm:p-6 shadow-[0_1px_3px_rgba(12,25,44,0.04)]">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold font-mono tracking-wider uppercase bg-[#EFF5FF] text-[#155EEF] border border-[#C2D8FF]">
              TRUSTED SAFETY NETWORK
            </span>
            <span className="text-xs font-mono text-[#64748B]">Emergency Responders & Escalation Policy</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[#0F172A]">
            Emergency Contacts & Dispatch Configuration
          </h1>
          <p className="text-xs sm:text-sm text-[#475569] max-w-3xl">
            Register and verify emergency contacts, designate primary escalation recipients, and configure automated notification delays. All communications require explicit user verification and consent.
          </p>
        </div>
      </div>

      {/* Emergency Contacts Management */}
      <EmergencyContactsPanel
        contacts={contacts}
        escalationPolicy={escalationPolicy}
        onUpdateEscalationPolicy={onUpdateEscalationPolicy}
        onToggleContactVerification={onToggleContactVerification}
        onAddContact={onAddContact}
        onRemoveContact={onRemoveContact}
        onSetPrimary={onSetPrimary}
        onSimulateDispatch={onSimulateDispatch}
      />
    </div>
  );
};
