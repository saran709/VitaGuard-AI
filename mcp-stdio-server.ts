/**
 * VitaGuard AI — Standalone Model Context Protocol (MCP) Stdio Server
 *
 * Exposes safe, authenticated VitaGuard tools over JSON-RPC 2.0 stdio transport:
 * - vitaguard_get_risk_status (READ_ONLY)
 * - vitaguard_explain_assessment (READ_ONLY)
 * - vitaguard_list_alert_history (READ_ONLY)
 * - vitaguard_acknowledge_alert (SENSITIVE_MUTATION — requires confirmationToken)
 * - vitaguard_trigger_escalation_check (SENSITIVE_MUTATION — requires confirmationToken)
 * - vitaguard_reset_demo_workspace (SENSITIVE_MUTATION — requires confirmationToken)
 */

import readline from 'readline';
import {
  JsonRpcRequest,
  VitaGuardMcpServer,
} from './src/services/mcpServer.ts';

const defaultOperatorUid =
  (process.env.VITAGUARD_MCP_UID || 'mcp-authenticated-operator').trim();

const mcpServer = new VitaGuardMcpServer();
mcpServer.ensureUserInitialized(defaultOperatorUid);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

rl.on('line', async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  try {
    const parsed = JSON.parse(trimmed) as JsonRpcRequest & {
      actingUid?: string;
    };
    const actingUid =
      typeof parsed.actingUid === 'string' && parsed.actingUid.trim()
        ? parsed.actingUid.trim()
        : defaultOperatorUid;

    const response = await mcpServer.handleJsonRpc(parsed, {
      actingUid,
      authBearerVerified: true,
    });

    process.stdout.write(JSON.stringify(response) + '\n');
  } catch (err) {
    process.stdout.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32700,
          message: err instanceof Error ? err.message : 'Parse error',
        },
      }) + '\n'
    );
  }
});
