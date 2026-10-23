import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import { SafetyWorkspaceProvider } from '../context/SafetyWorkspaceContext';
import { AppRoutes } from './router';

export default function App() {
  return (
    <BrowserRouter>
      <SafetyWorkspaceProvider>
        <AppRoutes />
      </SafetyWorkspaceProvider>
    </BrowserRouter>
  );
}
