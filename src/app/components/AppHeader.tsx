import React from 'react';
import { useLocation } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Menu, Shield } from 'lucide-react';
import { useSafetyWorkspace } from '../../context/SafetyWorkspaceContext';
import { RiskLevel } from '../../types/safety';

interface AppHeaderProps {
  onToggleMobileMenu: () => void;
}

const ROUTE_NAMES: Record<string, { title: string; category: string }> = {
  '/overview': { title: 'System Overview & Telemetry Cockpit', category: 'Live Monitoring' },
  '/simulator': { title: 'Physiological Simulator & Integrations', category: 'Synthetic Environment' },
  '/alerts': { title: 'Safety Alerts, Escalation & AI Explanations', category: 'Emergency Workflow' },
  '/risk-rules': { title: 'Deterministic Safety Engine & Risk Rules', category: 'Rule Engine' },
  '/contacts': { title: 'Emergency Contacts & Escalation Policy', category: 'Trusted Network' },
};

export const AppHeader: React.FC<AppHeaderProps> = ({ onToggleMobileMenu }) => {
  const location = useLocation();
  const { assessment, activeAlert, handleAcknowledgeSafe } = useSafetyWorkspace();

  const currentInfo = ROUTE_NAMES[location.pathname] || {
    title: 'VitaGuard AI Safety Cockpit',
    category: 'Workspace',
  };

  const hasUnacknowledgedAlert = Boolean(
    activeAlert && !activeAlert.acknowledged && activeAlert.status !== 'RESOLVED'
  );

  return (
    <header className="bg-white border-b border-[#DCE4EE] px-4 sm:px-6 py-3 sticky top-0 z-20 shadow-[0_1px_2px_rgba(12,25,44,0.02)]">
      <div className="flex items-center justify-between gap-4">
        {/* Left: Mobile Menu Trigger + Breadcrumb */}
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onToggleMobileMenu}
            aria-label="Toggle navigation menu"
            className="lg:hidden p-2 rounded-lg text-[#334760] hover:bg-[#F3F6FA] border border-[#DCE4EE] focus-visible:outline-2 focus-visible:outline-[#155EEF]"
          >
            <Menu className="w-5 h-5" />
          </button>

          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[11px] font-mono text-[#64748B]">
              <span>VitaGuard AI</span>
              <span>/</span>
              <span className="text-[#155EEF] font-semibold">{currentInfo.category}</span>
            </div>
            <h2 className="text-sm sm:text-base font-bold text-[#0F172A] truncate">
              {currentInfo.title}
            </h2>
          </div>
        </div>

        {/* Right: Risk Badge & Quick Acknowledge */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          {/* Real-time Deterministic Risk Badge */}
          <div
            className={`px-2.5 py-1 rounded-md text-[11px] font-bold font-mono tracking-wider uppercase border inline-flex items-center gap-1.5 ${
              assessment.riskLevel === RiskLevel.CRITICAL
                ? 'bg-[#FEF2F2] text-[#991B1B] border-[#FECACA]'
                : assessment.riskLevel === RiskLevel.HIGH
                ? 'bg-[#FFF7ED] text-[#9A3412] border-[#FDBA74]'
                : assessment.riskLevel === RiskLevel.MODERATE
                ? 'bg-[#FFFBEB] text-[#92400E] border-[#FDE68A]'
                : 'bg-[#ECFDF5] text-[#065F46] border-[#A7F3D0]'
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                assessment.riskLevel === RiskLevel.CRITICAL
                  ? 'bg-[#DC2626] animate-pulse'
                  : assessment.riskLevel === RiskLevel.HIGH
                  ? 'bg-[#EA580C]'
                  : assessment.riskLevel === RiskLevel.MODERATE
                  ? 'bg-[#D97706]'
                  : 'bg-[#059669]'
              }`}
            />
            <span>{assessment.riskLevel} RISK ({assessment.overallScore}/100)</span>
          </div>

          {/* Quick "I am safe" Button if Alert Active */}
          {hasUnacknowledgedAlert && (
            <button
              type="button"
              onClick={() => handleAcknowledgeSafe('Confirmed safe via Header Quick Action')}
              className="vg-btn-safe px-3 sm:px-4 py-1.5 text-xs font-bold inline-flex items-center gap-1.5"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>I am safe</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
