import React, { useState } from 'react';
import { LogOut, Menu, ShieldAlert, Sliders, X } from 'lucide-react';
import { RiskLevel } from '../types/safety';
import { AuthUserSession } from '../context/AuthContext';

export type NavTab = 'overview' | 'simulation' | 'alerts' | 'rules' | 'contacts';

interface NavbarProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  currentRisk: RiskLevel;
  hasUnacknowledgedAlert: boolean;
  onQuickAcknowledge: () => void;
  user?: AuthUserSession | null;
  onLogout?: () => void;
}

const NAV_ITEMS: { id: NavTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'simulation', label: 'Simulator' },
  { id: 'alerts', label: 'Alerts' },
  { id: 'rules', label: 'Risk Rules' },
  { id: 'contacts', label: 'Contacts' },
];

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  onSelectTab,
  hasUnacknowledgedAlert,
  onQuickAcknowledge,
  user,
  onLogout,
}) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleNavClick = (tab: NavTab) => {
    onSelectTab(tab);
    setMobileMenuOpen(false);
  };

  return (
    <>
      <div className="sticky top-0 z-30 bg-white/95 backdrop-blur-xs border-b border-[#DCE4EE] shadow-[0_1px_2px_rgba(12,25,44,0.03)]">
        {/* Top Bar Contract: 3 zones separated by gap-8 */}
        <header className="max-w-[1440px] mx-auto flex items-center justify-between gap-4 sm:gap-8 px-4 sm:px-6 py-3">
          {/* Zone 1: Single text element wordmark */}
          <a
            href="#overview"
            onClick={(e) => {
              e.preventDefault();
              handleNavClick('overview');
            }}
            className="text-lg font-bold tracking-tight text-[#0C192C] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#155EEF]"
          >
            VitaGuard AI
          </a>

          {/* Zone 2: 5 concise single-line text navigation links */}
          <nav
            aria-label="Primary Navigation"
            className="hidden md:flex items-center gap-7 text-sm font-medium text-[#5E738B]"
          >
            {NAV_ITEMS.map((item) => {
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleNavClick(item.id)}
                  className={`py-1.5 transition-colors whitespace-nowrap shrink-0 border-b-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#155EEF] ${
                    isActive
                      ? 'border-[#155EEF] text-[#0C192C] font-semibold'
                      : 'border-transparent text-[#5E738B] hover:text-[#0C192C] hover:border-[#C3D0E0]'
                  }`}
                >
                  {item.label}
                  {item.id === 'alerts' && hasUnacknowledgedAlert ? ' (Active)' : ''}
                </button>
              );
            })}
          </nav>

          {/* Zone 3: 1 primary action */}
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            {hasUnacknowledgedAlert ? (
              <button
                type="button"
                onClick={onQuickAcknowledge}
                className="vg-btn-safe px-4 py-2 text-xs whitespace-nowrap shrink-0"
              >
                I am safe
              </button>
            ) : (
              <button
                type="button"
                onClick={() => handleNavClick('simulation')}
                className="vg-btn-primary px-3.5 sm:px-4 py-2 text-xs whitespace-nowrap shrink-0 inline-flex items-center gap-1.5"
              >
                <Sliders className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Adjust Simulation</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setMobileMenuOpen((prev) => !prev)}
              aria-expanded={mobileMenuOpen}
              aria-label="Toggle navigation menu"
              className="md:hidden p-2 rounded-lg text-[#334760] hover:bg-[#F3F6FA] focus-visible:outline-2 focus-visible:outline-[#155EEF]"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </header>

        {/* Mobile Navigation Drawer */}
        {mobileMenuOpen && (
          <nav
            aria-label="Mobile Navigation"
            className="md:hidden border-t border-[#DCE4EE] bg-white px-4 py-3 grid grid-cols-2 sm:flex sm:flex-wrap gap-2"
          >
            {NAV_ITEMS.map((item) => {
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleNavClick(item.id)}
                  className={`px-3.5 py-2.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 text-left sm:text-center ${
                    isActive
                      ? 'bg-[#155EEF] text-white'
                      : 'bg-[#F3F6FA] text-[#334760] hover:bg-[#E3EAF2]'
                  }`}
                >
                  {item.label}
                  {item.id === 'alerts' && hasUnacknowledgedAlert ? ' (Active)' : ''}
                </button>
              );
            })}
          </nav>
        )}
      </div>

      {/* Mandatory Visible SIMULATION MODE Banner + Authenticated Session Context */}
      <div
        role="region"
        aria-label="Simulation Mode Notice"
        className="bg-[#0D1F38] border-b border-[#1E3658] px-4 sm:px-6 py-2.5 text-slate-100"
      >
        <div className="max-w-[1440px] mx-auto flex flex-col lg:flex-row lg:items-center justify-between gap-2 text-xs">
          <div className="flex items-start sm:items-center gap-2.5">
            <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5 sm:mt-0" aria-hidden="true" />
            <div className="text-slate-200">
              <span className="font-bold tracking-tight text-amber-300 font-mono">SIMULATION MODE</span>
              <span className="mx-1.5 text-slate-500" aria-hidden="true">·</span>
              <span>
                Sample physiological and environmental data only. No physical wearable is connected and no real SMS or emergency calls are sent.
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono text-slate-300 pl-6 lg:pl-0 shrink-0">
            {user ? (
              <>
                <span>
                  User: {user.email} ({user.isFirebaseBacked ? 'Firestore Synced' : 'Local Sandbox'})
                </span>
                {onLogout && (
                  <button
                    type="button"
                    onClick={onLogout}
                    className="inline-flex items-center gap-1 underline font-sans font-semibold text-sky-300 hover:text-white transition-colors"
                  >
                    <LogOut className="w-3 h-3" aria-hidden="true" />
                    <span>Sign Out</span>
                  </button>
                )}
              </>
            ) : (
              <span>Firebase Backend Ready · Rule Engine v1.2.0</span>
            )}
          </div>
        </div>
      </div>
    </>
  );
};
