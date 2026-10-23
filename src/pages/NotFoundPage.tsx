import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, FileQuestion, Shield } from 'lucide-react';

export const NotFoundPage: React.FC = () => {
  return (
    <div
      data-testid="page-not-found"
      className="min-h-[60vh] flex items-center justify-center p-6"
    >
      <div className="vg-card p-8 sm:p-10 max-w-md w-full text-center space-y-5">
        <div className="w-14 h-14 rounded-2xl bg-[#EFF5FF] border border-[#C2D8FF] text-[#155EEF] flex items-center justify-center mx-auto shadow-xs">
          <FileQuestion className="w-7 h-7" />
        </div>

        <div className="space-y-1.5">
          <div className="text-xs font-mono font-bold uppercase tracking-wider text-[#64748B]">
            HTTP 404 — ROUTE UNKNOWN
          </div>
          <h1 className="text-2xl font-bold text-[#0F172A]">Page Not Found</h1>
          <p className="text-xs sm:text-sm text-[#475569] leading-relaxed">
            The requested page does not exist in the VitaGuard AI safety workspace.
          </p>
        </div>

        <div className="pt-2">
          <Link
            to="/overview"
            className="vg-btn-primary py-2.5 px-5 text-xs font-semibold inline-flex items-center gap-2 shadow-sm"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Return to Safety Overview</span>
          </Link>
        </div>
      </div>
    </div>
  );
};
