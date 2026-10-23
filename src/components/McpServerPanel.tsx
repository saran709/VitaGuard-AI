import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  KeyRound,
  Lock,
  Play,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  XCircle,
} from 'lucide-react';
import {
  MCP_PROTOCOL_VERSION,
  McpSecurityError,
  McpToolCallResult,
  VITAGUARD_MCP_SERVER_NAME,
  VITAGUARD_MCP_SERVER_VERSION,
  VITAGUARD_MCP_TOOLS,
  VitaGuardMcpServer,
  VitaGuardMcpToolName,
} from '../services/mcpServer';
import {
  EmergencyContact,
  EnvironmentReadings,
  RiskThresholds,
  SafetyAlert,
  VitalReadings,
} from '../types/safety';

interface McpServerPanelProps {
  actingUid: string;
  vitals: VitalReadings;
  environment: EnvironmentReadings;
  thresholds: RiskThresholds;
  contacts: EmergencyContact[];
  activeAlert: SafetyAlert | null;
  onAcknowledgeAlertFromMcp?: (note: string) => void;
  onResetDemoFromMcp?: () => void;
}

export const McpServerPanel: React.FC<McpServerPanelProps> = ({
  actingUid,
  vitals,
  environment,
  thresholds,
  contacts,
  activeAlert,
  onAcknowledgeAlertFromMcp,
  onResetDemoFromMcp,
}) => {
  const localMcpServer = useMemo(() => new VitaGuardMcpServer(), []);

  const [selectedTool, setSelectedTool] = useState<VitaGuardMcpToolName>(
    'vitaguard_get_risk_status'
  );
  const [lastResult, setLastResult] = useState<McpToolCallResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);

  const selectedToolDef = useMemo(
    () => VITAGUARD_MCP_TOOLS.find((t) => t.name === selectedTool)!,
    [selectedTool]
  );

  const syncContextAndInvoke = async (confirmationToken?: string) => {
    setIsExecuting(true);
    setErrorMessage(null);

    try {
      localMcpServer.ensureUserInitialized(actingUid, {
        vitals,
        environment,
        thresholds,
        contacts,
        activeAlert,
      });

      const alertIdForCall = activeAlert?.id || 'alert-demo-active-1';
      const args: Record<string, unknown> = {
        targetUid: actingUid,
      };

      if (
        selectedTool === 'vitaguard_acknowledge_alert' ||
        selectedTool === 'vitaguard_trigger_escalation_check'
      ) {
        args.alertId = alertIdForCall;
      }
      if (selectedTool === 'vitaguard_acknowledge_alert') {
        args.note = 'Confirmed "I am safe" via MCP Human-in-the-Loop confirmation.';
      }
      if (selectedTool === 'vitaguard_trigger_escalation_check') {
        args.simulateDeadlineExpired = true;
      }
      if (selectedTool === 'vitaguard_reset_demo_workspace') {
        args.reason = 'Judge triggered safe simulated reset via MCP Inspector.';
      }

      const result = await localMcpServer.callTool(
        {
          name: selectedTool,
          arguments: args,
          confirmationToken,
        },
        {
          actingUid,
          authBearerVerified: true,
        }
      );

      setLastResult(result);

      if (
        result.status === 'CONFIRMATION_REQUIRED' &&
        result.confirmationChallenge
      ) {
        setPendingToken(result.confirmationChallenge.confirmationToken);
      } else {
        setPendingToken(null);
        if (
          selectedTool === 'vitaguard_acknowledge_alert' &&
          result.status === 'SUCCESS' &&
          onAcknowledgeAlertFromMcp
        ) {
          onAcknowledgeAlertFromMcp(
            'Confirmed "I am safe" via MCP Human-in-the-Loop confirmation.'
          );
        }
        if (
          selectedTool === 'vitaguard_reset_demo_workspace' &&
          result.status === 'SUCCESS' &&
          onResetDemoFromMcp
        ) {
          onResetDemoFromMcp();
        }
      }
    } catch (err) {
      if (err instanceof McpSecurityError) {
        setErrorMessage(`[${err.code}] ${err.message}`);
      } else {
        setErrorMessage(err instanceof Error ? err.message : 'MCP execution error.');
      }
    } finally {
      setIsExecuting(false);
    }
  };

  return (
    <section
      aria-label="VitaGuard Model Context Protocol Server Console"
      className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 sm:p-5 space-y-4"
    >
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-lg bg-indigo-500/10 border border-indigo-500/30 text-indigo-400">
            <Terminal className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-semibold text-slate-100">
                VitaGuard MCP Server Integration
              </h3>
              <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
                MCP {MCP_PROTOCOL_VERSION}
              </span>
              <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                AUTH UID: {actingUid}
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Server: <span className="font-mono text-slate-300">{VITAGUARD_MCP_SERVER_NAME}@{VITAGUARD_MCP_SERVER_VERSION}</span> • JSON-RPC 2.0 (`/api/mcp/rpc`, `mcp-stdio-server.ts`) • Sensitive tools enforce two-step human confirmation
            </p>
          </div>
        </div>
      </div>

      {/* Tool Selector Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
        {VITAGUARD_MCP_TOOLS.map((tool) => {
          const isSelected = tool.name === selectedTool;
          const isSensitive = tool.requiresConfirmation;
          return (
            <button
              key={tool.name}
              type="button"
              onClick={() => {
                setSelectedTool(tool.name);
                setPendingToken(null);
                setErrorMessage(null);
              }}
              className={`text-left p-3 rounded-lg border transition-all ${
                isSelected
                  ? 'bg-slate-800/90 border-indigo-500/60 ring-1 ring-indigo-500/40'
                  : 'bg-slate-950/60 border-slate-800/80 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between gap-1.5 mb-1">
                <span className="text-xs font-mono font-semibold text-slate-100 truncate">
                  {tool.name}
                </span>
                {isSensitive ? (
                  <span className="inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 shrink-0">
                    <Lock className="w-2.5 h-2.5" />
                    CONFIRM REQ
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 shrink-0">
                    <ShieldCheck className="w-2.5 h-2.5" />
                    READ-ONLY
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-400 line-clamp-2">
                {tool.description}
              </p>
            </button>
          );
        })}
      </div>

      {/* Action Bar & Human-in-the-Loop Confirmation Gate */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-950/80 border border-slate-800 rounded-lg p-3">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-indigo-300">
              tools/call → {selectedToolDef.name}
            </span>
            {selectedToolDef.requiresConfirmation && (
              <span className="text-[11px] text-amber-300 font-medium">
                (Requires Confirmation Token)
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400">{selectedToolDef.description}</p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            disabled={isExecuting}
            onClick={() => syncContextAndInvoke(undefined)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white transition-colors cursor-pointer disabled:opacity-50"
          >
            <Play className="w-3.5 h-3.5" />
            {selectedToolDef.requiresConfirmation
              ? '1. Request Action (Unconfirmed)'
              : 'Execute Safe MCP Tool'}
          </button>

          {pendingToken && (
            <button
              type="button"
              disabled={isExecuting}
              onClick={() => syncContextAndInvoke(pendingToken)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-slate-950 transition-colors cursor-pointer"
            >
              <KeyRound className="w-3.5 h-3.5" />
              2. Confirm & Execute
            </button>
          )}
        </div>
      </div>

      {/* Pending Confirmation Banner */}
      {lastResult?.status === 'CONFIRMATION_REQUIRED' &&
        lastResult.confirmationChallenge && (
          <div className="bg-amber-950/40 border border-amber-500/40 rounded-lg p-3.5 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-amber-300 text-xs font-semibold">
                <ShieldAlert className="w-4 h-4 shrink-0" />
                <span>
                  Human-in-the-Loop Confirmation Required Before Executing{' '}
                  <code className="font-mono">{lastResult.toolName}</code>
                </span>
              </div>
              <button
                type="button"
                onClick={() => setPendingToken(null)}
                className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200"
              >
                <XCircle className="w-3.5 h-3.5" />
                Cancel
              </button>
            </div>
            <p className="text-xs text-amber-200/90">
              {lastResult.confirmationChallenge.actionSummary}
            </p>
            <p className="text-[11px] text-amber-300/80">
              {lastResult.confirmationChallenge.impactWarning}
            </p>
            <div className="flex items-center gap-3 text-[11px] font-mono text-slate-300 pt-1">
              <span>
                Token: {lastResult.confirmationChallenge.confirmationToken}
              </span>
              <span>
                Expires: {lastResult.confirmationChallenge.expiresAtIso}
              </span>
            </div>
          </div>
        )}

      {errorMessage && (
        <div className="bg-rose-950/40 border border-rose-500/40 rounded-lg p-3 text-xs text-rose-200 font-mono">
          {errorMessage}
        </div>
      )}

      {/* Structured MCP Response Output */}
      {lastResult && (
        <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-mono text-slate-400">
              MCP Response ({lastResult.toolName})
            </span>
            <span
              className={`inline-flex items-center gap-1 font-mono text-[11px] px-2 py-0.5 rounded ${
                lastResult.status === 'SUCCESS'
                  ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                  : 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
              }`}
            >
              <CheckCircle2 className="w-3 h-3" />
              {lastResult.status} • {lastResult.dataMode}
            </span>
          </div>
          <pre className="text-[11px] font-mono text-slate-300 overflow-x-auto max-h-56 leading-relaxed">
            {JSON.stringify(lastResult.structuredOutput, null, 2)}
          </pre>
        </div>
      )}
    </section>
  );
};
