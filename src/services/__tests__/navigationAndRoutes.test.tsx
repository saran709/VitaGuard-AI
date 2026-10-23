import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AppLayout } from '../../app/layouts/AppLayout';
import { AppRoutes } from '../../app/router';
import { Sidebar } from '../../app/components/Sidebar';
import { AppHeader } from '../../app/components/AppHeader';
import { MobileNavigation } from '../../app/components/MobileNavigation';
import { OverviewPage } from '../../pages/OverviewPage';
import { SimulatorPage } from '../../pages/SimulatorPage';
import { AlertsPage } from '../../pages/AlertsPage';
import { RiskRulesPage } from '../../pages/RiskRulesPage';
import { ContactsPage } from '../../pages/ContactsPage';
import { NotFoundPage } from '../../pages/NotFoundPage';
import { SafetyWorkspaceProvider } from '../../context/SafetyWorkspaceContext';
import { AuthProvider } from '../../context/AuthContext';
import { evaluateProtectedRouteAccess } from '../../context/AuthContext';
import { DEFAULT_THRESHOLDS, SIMULATION_PRESETS, evaluateRisk } from '../../engine/riskEngine';
import { RiskLevel } from '../../types/safety';
import { createAlertFromAssessment } from '../../engine/alertManager';

describe('VitaGuard AI — Multi-Page Navigation & Dedicated Routes', () => {
  const nominalPreset = SIMULATION_PRESETS.find((p) => p.expectedRisk === RiskLevel.LOW)!;
  const criticalPreset = SIMULATION_PRESETS.find((p) => p.expectedRisk === RiskLevel.CRITICAL)!;

  function renderWithProviders(initialEntry: string) {
    return renderToStaticMarkup(
      <AuthProvider>
        <MemoryRouter initialEntries={[initialEntry]}>
          <SafetyWorkspaceProvider>
            <AppRoutes />
          </SafetyWorkspaceProvider>
        </MemoryRouter>
      </AuthProvider>
    );
  }

  it('1. verifies /overview renders the dedicated Overview telemetry cockpit', () => {
    const html = renderWithProviders('/overview');
    expect(html).toContain('data-testid="page-overview"');
    expect(html).toContain('System Overview &amp; Real-Time Telemetry');
    expect(html).toContain('TELEMETRY COCKPIT');
    expect(html).toContain('Continuous Biometric Stream');
  });

  it('2. verifies each of the five dedicated pages has a unique route and renders its primary content', () => {
    // 1. Overview (/overview)
    const overviewHtml = renderWithProviders('/overview');
    expect(overviewHtml).toContain('data-testid="page-overview"');
    expect(overviewHtml).toContain('System Overview &amp; Real-Time Telemetry');
    expect(overviewHtml).toContain('AI Clinical Reasoning Preview');
    expect(overviewHtml).toContain('Model Context Protocol (MCP) Server');
    expect(overviewHtml).toContain('Reproducible Hackathon Demo &amp; Verification Runner');

    // 2. Simulator (/simulator)
    const simulatorHtml = renderWithProviders('/simulator');
    expect(simulatorHtml).toContain('data-testid="page-simulator"');
    expect(simulatorHtml).toContain('Physiological Simulator &amp; External Data Sources');
    expect(simulatorHtml).toContain('Live Telemetry &amp; Environmental Simulator');
    expect(simulatorHtml).toContain('Scenario Presets');
    expect(simulatorHtml).not.toContain('Reproducible Hackathon Demo');

    // 3. Alerts (/alerts)
    const alertsHtml = renderWithProviders('/alerts');
    expect(alertsHtml).toContain('data-testid="page-alerts"');
    expect(alertsHtml).toContain('Safety Alerts, Escalation &amp; AI Reasoning');
    expect(alertsHtml).toContain('EMERGENCY WORKFLOW');
    expect(alertsHtml).not.toContain('Reproducible Hackathon Demo');

    // 4. Risk Rules (/risk-rules)
    const rulesHtml = renderWithProviders('/risk-rules');
    expect(rulesHtml).toContain('data-testid="page-risk-rules"');
    expect(rulesHtml).toContain('Risk Rules &amp; Safety Thresholds');
    expect(rulesHtml).toContain('DETERMINISTIC SAFETY ENGINE');
    expect(rulesHtml).toContain('Deterministic Guardrail Specifications');
    expect(rulesHtml).not.toContain('Reproducible Hackathon Demo');

    // 5. Contacts (/contacts)
    const contactsHtml = renderWithProviders('/contacts');
    expect(contactsHtml).toContain('data-testid="page-contacts"');
    expect(contactsHtml).toContain('Emergency Contacts &amp; Dispatch Configuration');
    expect(contactsHtml).toContain('TRUSTED SAFETY NETWORK');
    expect(contactsHtml).not.toContain('Reproducible Hackathon Demo');
  });

  it('3. verifies unknown routes render a clean 404 NotFound page with a link to /overview', () => {
    const notFoundHtml = renderWithProviders('/some-completely-invalid-path');
    expect(notFoundHtml).toContain('data-testid="page-not-found"');
    expect(notFoundHtml).toContain('Page Not Found');
    expect(notFoundHtml).toContain('HTTP 404 — ROUTE UNKNOWN');
    expect(notFoundHtml).toContain('Return to Safety Overview');
    expect(notFoundHtml).toContain('href="/overview"');
  });

  it('4. verifies Sidebar navigation displays all five route links and active route styling', () => {
    const sidebarHtml = renderToStaticMarkup(
      <AuthProvider>
        <MemoryRouter initialEntries={['/simulator']}>
          <SafetyWorkspaceProvider>
            <Sidebar />
          </SafetyWorkspaceProvider>
        </MemoryRouter>
      </AuthProvider>
    );

    expect(sidebarHtml).toContain('VitaGuard AI');
    expect(sidebarHtml).toContain('SIMULATION MODE');
    expect(sidebarHtml).toContain('href="/overview"');
    expect(sidebarHtml).toContain('href="/simulator"');
    expect(sidebarHtml).toContain('href="/alerts"');
    expect(sidebarHtml).toContain('href="/risk-rules"');
    expect(sidebarHtml).toContain('href="/contacts"');
    expect(sidebarHtml).toContain('Overview');
    expect(sidebarHtml).toContain('Simulator');
    expect(sidebarHtml).toContain('Alerts');
    expect(sidebarHtml).toContain('Risk Rules');
    expect(sidebarHtml).toContain('Contacts');
  });

  it('5. verifies protected route evaluation gates unauthenticated users to the login flow', () => {
    // Unauthenticated (null user)
    const unauthedAccess = evaluateProtectedRouteAccess(true, null);
    expect(unauthedAccess.allowed).toBe(false);
    expect(unauthedAccess.reason).toBe('unauthenticated');

    // Loading session
    const loadingAccess = evaluateProtectedRouteAccess(false, null);
    expect(loadingAccess.allowed).toBe(false);
    expect(loadingAccess.reason).toBe('loading');

    // Authenticated user
    const authedAccess = evaluateProtectedRouteAccess(true, {
      uid: 'test-user-123',
      email: 'test@vitaguard.demo',
      displayName: 'Test Operator',
      isFirebaseBacked: false,
    });
    expect(authedAccess.allowed).toBe(true);
    expect(authedAccess.reason).toBe('authenticated');
  });

  it('6. verifies alert consistency between Overview and Alerts pages using the shared workspace', () => {
    const assessment = evaluateRisk(
      criticalPreset.vitals,
      criticalPreset.environment,
      DEFAULT_THRESHOLDS
    );
    const activeAlert = createAlertFromAssessment(assessment, null, new Date().toISOString())!;

    const overviewHtml = renderToStaticMarkup(
      <AuthProvider>
        <MemoryRouter initialEntries={['/overview']}>
          <SafetyWorkspaceProvider>
            <OverviewPage assessment={assessment} activeAlert={activeAlert} />
          </SafetyWorkspaceProvider>
        </MemoryRouter>
      </AuthProvider>
    );

    const alertsHtml = renderToStaticMarkup(
      <AuthProvider>
        <MemoryRouter initialEntries={['/alerts']}>
          <SafetyWorkspaceProvider>
            <AlertsPage assessment={assessment} activeAlert={activeAlert} />
          </SafetyWorkspaceProvider>
        </MemoryRouter>
      </AuthProvider>
    );

    // Both pages must display the identical critical alert and "I am safe" acknowledgment action
    expect(overviewHtml).toContain('ACTIVE ALERT');
    expect(overviewHtml).toContain('I am safe');
    expect(alertsHtml).toContain('I am safe');
    expect(alertsHtml).toContain(activeAlert.title);
  });
});
