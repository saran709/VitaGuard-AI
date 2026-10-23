import React from 'react';
import { NavLink } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  Bell,
  CheckCircle2,
  LogOut,
  Shield,
  ShieldAlert,
  Sliders,
  Users,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useSafetyWorkspace } from '../../context/SafetyWorkspaceContext';

interface SidebarProps {
  onLinkClick?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ onLinkClick }) => {
  const { user, logout } = useAuth();
  const { activeAlert, handleAcknowledgeSafe } = useSafetyWorkspace();

  const hasUnacknowledgedAlert = Boolean(
    activeAlert && !activeAlert.acknowledged && activeAlert.status !== 'RESOLVED'
  );

  const navItems = [
    {
      to: '/overview',
      label: 'Overview',
      icon: Activity,
      badge: null,
    },
    {
      to: '/simulator',
      label: 'Simulator',
      icon: Sliders,
      badge: null,
    },
    {
      to: '/alerts',
      label: 'Alerts',
      icon: Bell,
      badge: hasUnacknowledgedAlert ? '1' : null,
    },
    {
      to: '/risk-rules',
      label: 'Risk Rules',
      icon: ShieldAlert,
      badge: null,
    },
    {
      to: '/contacts',
      label: 'Contacts',
      icon: Users,
      badge: null,
    },
  ];

  return (
    <aside className="w-64 bg-white border-r border-[#DCE4EE] flex flex-col justify-between shrink-0 h-full">
      <div>
        {/* Brand Header */}
        <div className="p-5 border-b border-[#DCE4EE]">
          <NavLink
            to="/overview"
            onClick={onLinkClick}
            className="flex items-center gap-3 group focus-visible:outline-2 focus-visible:outline-[#155EEF]"
          >
            <div className="w-9 h-9 rounded-lg bg-[#0D1F38] text-white flex items-center justify-center font-bold text-base shadow-[0_1px_3px_rgba(12,25,44,0.12)] group-hover:bg-[#155EEF] transition-colors">
              <Shield className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="font-bold text-base tracking-tight text-[#0F172A] leading-tight">
                VitaGuard AI
              </div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-[#64748B]">
                Intelligent Risk Assistant
              </div>
            </div>
          </NavLink>

          {/* Persistent Simulation Mode Tag */}
          <div className="mt-3.5 px-2.5 py-1.5 rounded-md bg-[#FFFBEB] border border-[#FDE68A] flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#D97706] animate-pulse" />
            <span className="text-[11px] font-bold text-[#92400E] font-mono">
              SIMULATION MODE
            </span>
          </div>
        </div>

        {/* Quick Emergency Acknowledgement Action */}
        {hasUnacknowledgedAlert && (
          <div className="p-3 mx-3 mt-3 rounded-lg bg-[#FEF2F2] border border-[#FECACA] space-y-2">
            <div className="flex items-center gap-1.5 text-[11px] font-bold text-[#991B1B]">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span>Active Hazard Alert</span>
            </div>
            <button
              type="button"
              onClick={() => handleAcknowledgeSafe('Confirmed safe via Sidebar Quick Action')}
              className="vg-btn-safe w-full py-1.5 px-2.5 text-xs font-bold inline-flex items-center justify-center gap-1.5"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>I am safe</span>
            </button>
          </div>
        )}

        {/* Primary Navigation Links */}
        <nav aria-label="Sidebar Navigation" className="p-3 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={onLinkClick}
                className={({ isActive }) =>
                  `flex items-center justify-between px-3.5 py-2.5 rounded-lg text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-[#155EEF] ${
                    isActive
                      ? 'bg-[#EFF5FF] text-[#155EEF] border border-[#C2D8FF] shadow-xs'
                      : 'text-[#475569] hover:bg-[#F8FAFC] hover:text-[#0F172A] border border-transparent'
                  }`
                }
              >
                <div className="flex items-center gap-3">
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{item.label}</span>
                </div>
                {item.badge && (
                  <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold font-mono bg-[#DC2626] text-white">
                    {item.badge}
                  </span>
                )}
              </NavLink>
            );
          })}
        </nav>
      </div>

      {/* User Session & Sign Out Footer */}
      <div className="p-4 border-t border-[#DCE4EE] bg-[#F8FAFC] space-y-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-[#E2E8F0] border border-[#CBD5E1] text-[#334155] font-bold text-xs flex items-center justify-center shrink-0">
            {user?.displayName ? user.displayName.slice(0, 1).toUpperCase() : 'OP'}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-bold text-[#0F172A] truncate">
              {user?.displayName || 'Safety Operator'}
            </div>
            <div className="text-[11px] font-mono text-[#64748B] truncate">
              {user?.email || 'operator@vitaguard.demo'}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between pt-1">
          <span className="text-[10px] font-mono text-[#64748B]">
            {user?.isFirebaseBacked ? 'Cloud Storage' : 'Local Sandbox'}
          </span>
          {logout && (
            <button
              type="button"
              onClick={logout}
              className="text-xs font-semibold text-[#64748B] hover:text-[#DC2626] inline-flex items-center gap-1 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign Out</span>
            </button>
          )}
        </div>
      </div>
    </aside>
  );
};
