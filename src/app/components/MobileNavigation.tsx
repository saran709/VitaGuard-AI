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
  X,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useSafetyWorkspace } from '../../context/SafetyWorkspaceContext';

interface MobileNavigationProps {
  isOpen: boolean;
  onClose: () => void;
}

export const MobileNavigation: React.FC<MobileNavigationProps> = ({ isOpen, onClose }) => {
  const { user, logout } = useAuth();
  const { activeAlert, handleAcknowledgeSafe } = useSafetyWorkspace();

  if (!isOpen) return null;

  const hasUnacknowledgedAlert = Boolean(
    activeAlert && !activeAlert.acknowledged && activeAlert.status !== 'RESOLVED'
  );

  const navItems = [
    { to: '/overview', label: 'Overview', icon: Activity },
    { to: '/simulator', label: 'Simulator', icon: Sliders },
    { to: '/alerts', label: 'Alerts', icon: Bell, badge: hasUnacknowledgedAlert ? 'Active' : null },
    { to: '/risk-rules', label: 'Risk Rules', icon: ShieldAlert },
    { to: '/contacts', label: 'Contacts', icon: Users },
  ];

  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer */}
      <div className="fixed inset-y-0 left-0 w-72 max-w-[85vw] bg-white shadow-xl flex flex-col justify-between z-10">
        <div>
          {/* Header */}
          <div className="p-4 border-b border-[#DCE4EE] flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-[#0D1F38] text-white flex items-center justify-center font-bold">
                <Shield className="w-4 h-4 text-white" />
              </div>
              <div>
                <div className="font-bold text-sm text-[#0F172A]">VitaGuard AI</div>
                <div className="text-[10px] font-mono text-[#64748B]">Navigation Menu</div>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close navigation menu"
              className="p-1.5 rounded-lg text-[#64748B] hover:bg-[#F3F6FA]"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Simulation Mode Tag */}
          <div className="p-3 bg-[#FFFBEB] border-b border-[#FDE68A] text-[11px] font-bold text-[#92400E] font-mono flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#D97706] animate-pulse" />
            <span>SIMULATION MODE ACTIVE</span>
          </div>

          {/* Alert Callout if Active */}
          {hasUnacknowledgedAlert && (
            <div className="p-3 m-3 rounded-lg bg-[#FEF2F2] border border-[#FECACA] space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-bold text-[#991B1B]">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                <span>Hazard Alert Active</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  handleAcknowledgeSafe('Confirmed safe via Mobile Drawer');
                  onClose();
                }}
                className="vg-btn-safe w-full py-1.5 text-xs font-bold inline-flex items-center justify-center gap-1.5"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>I am safe</span>
              </button>
            </div>
          )}

          {/* Navigation Links */}
          <nav aria-label="Mobile Drawer Navigation" className="p-3 space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={onClose}
                  className={({ isActive }) =>
                    `flex items-center justify-between px-3.5 py-2.5 rounded-lg text-xs font-semibold transition-colors ${
                      isActive
                        ? 'bg-[#EFF5FF] text-[#155EEF] border border-[#C2D8FF]'
                        : 'text-[#475569] hover:bg-[#F8FAFC]'
                    }`
                  }
                >
                  <div className="flex items-center gap-3">
                    <Icon className="w-4 h-4" />
                    <span>{item.label}</span>
                  </div>
                  {item.badge && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#DC2626] text-white">
                      {item.badge}
                    </span>
                  )}
                </NavLink>
              );
            })}
          </nav>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[#DCE4EE] bg-[#F8FAFC] space-y-2">
          <div className="text-xs font-bold text-[#0F172A] truncate">
            {user?.displayName || 'Safety Operator'}
          </div>
          <div className="text-[11px] font-mono text-[#64748B] truncate">
            {user?.email || 'operator@vitaguard.demo'}
          </div>
          {logout && (
            <button
              type="button"
              onClick={() => {
                logout();
                onClose();
              }}
              className="text-xs font-semibold text-[#DC2626] hover:underline inline-flex items-center gap-1.5 pt-2"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign Out</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
