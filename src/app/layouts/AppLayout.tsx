import React, { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { Sidebar } from '../components/Sidebar';
import { AppHeader } from '../components/AppHeader';
import { MobileNavigation } from '../components/MobileNavigation';
import { useSafetyWorkspace } from '../../context/SafetyWorkspaceContext';
import { RULE_ENGINE_VERSION } from '../../engine/riskEngine';

export const AppLayout: React.FC = () => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { syncWarning, setSyncWarning } = useSafetyWorkspace();

  return (
    <div className="min-h-screen flex bg-[#F3F6FA] text-[#0F172A] overflow-x-hidden">
      {/* Desktop Left Sidebar */}
      <div className="hidden lg:flex shrink-0">
        <Sidebar />
      </div>

      {/* Mobile Navigation Drawer */}
      <MobileNavigation
        isOpen={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
      />

      {/* Main App Column */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Header */}
        <AppHeader onToggleMobileMenu={() => setMobileMenuOpen(true)} />

        {/* Persistent Simulation Mode Safety Warning Banner */}
        <div
          role="region"
          aria-label="Simulation Mode Notice"
          className="bg-[#0D1F38] border-b border-[#1E3658] px-4 sm:px-6 py-2 text-slate-100"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" aria-hidden="true" />
              <span className="font-bold tracking-tight text-amber-300 font-mono">
                SIMULATION MODE
              </span>
              <span className="text-slate-500 hidden sm:inline" aria-hidden="true">·</span>
              <span className="text-slate-200">
                Sample physiological and environmental data only. No physical wearable is connected and no real SMS or emergency calls are sent.
              </span>
            </div>
            <div className="font-mono text-[11px] text-slate-400 shrink-0">
              Deterministic Rule Engine {RULE_ENGINE_VERSION}
            </div>
          </div>
        </div>

        {/* Page Content Body */}
        <main className="flex-1 w-full max-w-[1440px] mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
          {/* Sync / Offline Warning Notice */}
          {syncWarning && (
            <div
              role="status"
              className="p-3.5 rounded-xl bg-white border border-[#DCE4EE] text-xs text-[#334155] flex items-center justify-between gap-3 shadow-xs"
            >
              <span>{syncWarning}</span>
              <button
                type="button"
                onClick={() => setSyncWarning(null)}
                className="text-xs font-semibold text-[#155EEF] hover:text-[#114AC4] underline shrink-0"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Route Outlet */}
          <Outlet />
        </main>

        {/* Global Footer */}
        <footer className="border-t border-[#DCE4EE] bg-white mt-12">
          <div className="max-w-[1440px] mx-auto px-4 sm:px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-[#64748B]">
            <div className="font-medium text-[#334155]">
              VitaGuard AI — Intelligent Personal Safety and Risk Assistant (Wearable & Environmental Data Integration)
            </div>
            <div className="font-mono text-[11px] text-[#64748B]">
              Provenance-Isolated Telemetry · Rule Engine {RULE_ENGINE_VERSION} · Live SMS Disabled By Default
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
};
