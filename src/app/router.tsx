import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from './layouts/AppLayout';
import { OverviewPage } from '../pages/OverviewPage';
import { SimulatorPage } from '../pages/SimulatorPage';
import { AlertsPage } from '../pages/AlertsPage';
import { RiskRulesPage } from '../pages/RiskRulesPage';
import { ContactsPage } from '../pages/ContactsPage';
import { NotFoundPage } from '../pages/NotFoundPage';

export const AppRoutes: React.FC = () => {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<Navigate to="/overview" replace />} />
        <Route path="/overview" element={<OverviewPage />} />
        <Route path="/simulator" element={<SimulatorPage />} />
        <Route path="/alerts" element={<AlertsPage />} />
        <Route path="/risk-rules" element={<RiskRulesPage />} />
        <Route path="/contacts" element={<ContactsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
};
