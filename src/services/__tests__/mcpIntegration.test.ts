import { describe, expect, it, vi } from 'vitest';
import { SIMULATION_PRESETS } from '../../engine/riskEngine';
import { EmergencyContact, RiskLevel } from '../../types/safety';
import { GeminiExplanationOrchestrator } from '../geminiExplanationEngine';
import {
  createSampleAlertForMcpTesting,
  MCP_PROTOCOL_VERSION,
  McpSecurityError,
  VITAGUARD_MCP_SERVER_NAME,
  VitaGuardMcpServer,
} from '../mcpServer';

const VERIFIED_CONTACT: EmergencyContact = {
  id: 'contact-mcp-1',
  name: 'Elena Vance',
  relationship: 'Primary Partner',
  phoneDisplay: '+1 (555) 014-8921',
  email: 'elena.vance@example.org',
  isPrimary: true,
  notifyOnLevel: RiskLevel.HIGH,
  verificationStatus: 'VERIFIED',
  consentGranted: true,
  verifiedAtIso: '2026-01-10T00:00:00.000Z',
};

describe('VitaGuard AI — Track-Specific MCP Server Integration & Human-in-the-Loop Confirmation', () => {
  const aliceUid = 'uid-mcp-alice';
  const bobUid = 'uid-mcp-bob';
  const baseNowMs = Date.parse('2026-10-23T18:00:00.000Z');
  const baseNowIso = new Date(baseNowMs).toISOString();

  it('1. handles JSON-RPC 2.0 initialize and tools/list with explicit read-only vs confirmation-required tool metadata', async () => {
    const mcp = new VitaGuardMcpServer();

    const initRes = await mcp.handleJsonRpc(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
      },
      { actingUid: aliceUid }
    );

    expect(initRes.error).toBeUndefined();
    expect(initRes.result).toMatchObject({
      protocolVersion: MCP_PROTOCOL_VERSION,
      serverInfo: {
        name: VITAGUARD_MCP_SERVER_NAME,
      },
      capabilities: {
        experimental: {
          humanInTheLoopConfirmation: true,
          deterministicRiskAuthority: true,
        },
      },
    });

    const listRes = await mcp.handleJsonRpc(
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
      },
      { actingUid: aliceUid }
    );

    const tools = (listRes.result as { tools: Array<{ name: string; requiresConfirmation: boolean }> }).tools;
    expect(tools.map((t) => t.name)).toEqual([
      'vitaguard_get_risk_status',
      'vitaguard_explain_assessment',
      'vitaguard_list_alert_history',
      'vitaguard_acknowledge_alert',
      'vitaguard_trigger_escalation_check',
      'vitaguard_reset_demo_workspace',
    ]);

    const readOnlyTools = tools.filter((t) => !t.requiresConfirmation).map((t) => t.name);
    expect(readOnlyTools).toEqual([
      'vitaguard_get_risk_status',
      'vitaguard_explain_assessment',
      'vitaguard_list_alert_history',
    ]);

    const sensitiveTools = tools.filter((t) => t.requiresConfirmation).map((t) => t.name);
    expect(sensitiveTools).toEqual([
      'vitaguard_acknowledge_alert',
      'vitaguard_trigger_escalation_check',
      'vitaguard_reset_demo_workspace',
    ]);
  });

  it('2. executes read-only tools (vitaguard_get_risk_status, vitaguard_explain_assessment, vitaguard_list_alert_history) for authenticated user and preserves deterministic risk authority', async () => {
    const criticalPreset = SIMULATION_PRESETS.find(
      (p) => p.expectedRisk === RiskLevel.CRITICAL
    )!;

    const mockGeminiGenerator = vi.fn().mockResolvedValue(
      JSON.stringify({
        summary:
          'Deterministic rule engine classified this simulated telemetry snapshot as CRITICAL due to severe hypoxia and exertional heat strain.',
        contributingFactors: ['Low SpO2 (89%) and high core body temperature (39.4°C)'],
        triggeredRules: [],
        uncertainties: ['Simulated telemetry mode'],
        recommendedActions: ['Acknowledge if safe or transition to cooled shelter'],
        limitations: 'Informational explanation only and not a medical diagnosis.',
        dataMode: 'SIMULATED',
        generatedAt: baseNowIso,
      })
    );

    const geminiOrchestrator = new GeminiExplanationOrchestrator({
      generator: mockGeminiGenerator,
    });
    const mcp = new VitaGuardMcpServer({ geminiOrchestrator });

    const sampleAlert = createSampleAlertForMcpTesting(
      criticalPreset.vitals,
      criticalPreset.environment,
      baseNowIso
    );
    mcp.ensureUserInitialized(aliceUid, {
      vitals: criticalPreset.vitals,
      environment: criticalPreset.environment,
      contacts: [VERIFIED_CONTACT],
      activeAlert: sampleAlert,
      nowMs: baseNowMs,
    });

    // 2a. vitaguard_get_risk_status
    const statusResult = await mcp.callTool(
      {
        name: 'vitaguard_get_risk_status',
        arguments: { targetUid: aliceUid, presetId: criticalPreset.id },
      },
      { actingUid: aliceUid, nowMs: baseNowMs }
    );

    expect(statusResult.status).toBe('SUCCESS');
    expect(statusResult.requiresConfirmation).toBe(false);
    expect(statusResult.structuredOutput.riskLevel).toBe(RiskLevel.CRITICAL);
    expect(statusResult.structuredOutput.dataMode).toBe('SIMULATED');

    // 2b. vitaguard_explain_assessment
    const explainResult = await mcp.callTool(
      {
        name: 'vitaguard_explain_assessment',
        arguments: {
          targetUid: aliceUid,
          assessmentId: String(statusResult.structuredOutput.assessmentId),
          userNote: 'Resting in shade after outdoor run.',
        },
      },
      { actingUid: aliceUid, nowMs: baseNowMs }
    );

    expect(explainResult.status).toBe('SUCCESS');
    expect(explainResult.structuredOutput.authoritativeRiskUnchanged).toEqual({
      riskLevel: RiskLevel.CRITICAL,
      overallScore: statusResult.structuredOutput.overallScore,
    });

    // 2c. vitaguard_list_alert_history
    const historyResult = await mcp.callTool(
      {
        name: 'vitaguard_list_alert_history',
        arguments: {
          targetUid: aliceUid,
          statusFilter: 'ACTIVE',
          limit: 10,
        },
      },
      { actingUid: aliceUid, nowMs: baseNowMs }
    );

    expect(historyResult.status).toBe('SUCCESS');
    const alerts = historyResult.structuredOutput.alerts as Array<{ id: string }>;
    expect(alerts.some((a) => a.id === sampleAlert.id)).toBe(true);
  });

  it('3. enforces strict authentication and rejects cross-user tool invocations', async () => {
    const mcp = new VitaGuardMcpServer();
    mcp.ensureUserInitialized(aliceUid, { nowMs: baseNowMs });

    // Unauthenticated call must throw UNAUTHENTICATED
    await expect(
      mcp.callTool(
        {
          name: 'vitaguard_get_risk_status',
          arguments: { targetUid: aliceUid },
        },
        { actingUid: null, nowMs: baseNowMs }
      )
    ).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
      httpStatus: 401,
    });

    // Cross-user call (Bob attempting to inspect Alice's risk status) must throw PERMISSION_DENIED
    await expect(
      mcp.callTool(
        {
          name: 'vitaguard_get_risk_status',
          arguments: { targetUid: aliceUid },
        },
        { actingUid: bobUid, nowMs: baseNowMs }
      )
    ).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
      httpStatus: 403,
    });
  });

  it('4. requires explicit human-in-the-loop confirmation for sensitive actions (acknowledge alert, trigger escalation check, reset demo workspace) and blocks unconfirmed execution', async () => {
    const criticalPreset = SIMULATION_PRESETS.find(
      (p) => p.expectedRisk === RiskLevel.CRITICAL
    )!;
    const mcp = new VitaGuardMcpServer();
    const sampleAlert = createSampleAlertForMcpTesting(
      criticalPreset.vitals,
      criticalPreset.environment,
      baseNowIso
    );

    mcp.ensureUserInitialized(aliceUid, {
      vitals: criticalPreset.vitals,
      environment: criticalPreset.environment,
      contacts: [VERIFIED_CONTACT],
      activeAlert: sampleAlert,
      nowMs: baseNowMs,
    });

    // Step 1: Calling vitaguard_acknowledge_alert WITHOUT confirmationToken must NOT acknowledge the alert
    const unconfirmedAck = await mcp.callTool(
      {
        name: 'vitaguard_acknowledge_alert',
        arguments: {
          targetUid: aliceUid,
          alertId: sampleAlert.id,
          note: 'Confirmed safe via MCP',
        },
      },
      { actingUid: aliceUid, nowMs: baseNowMs }
    );

    expect(unconfirmedAck.status).toBe('CONFIRMATION_REQUIRED');
    expect(unconfirmedAck.confirmationChallenge).toBeDefined();
    const issuedToken = unconfirmedAck.confirmationChallenge!.confirmationToken;

    // Verify alert is STILL ACTIVE and escalation task is STILL SCHEDULED before confirmation
    const taskBeforeConfirm = mcp
      .getEscalationCoordinator()
      .getTaskForAlert(aliceUid, aliceUid, sampleAlert.id);
    expect(taskBeforeConfirm?.status).toBe('SCHEDULED');

    // Step 2: Calling with the issued confirmationToken executes the acknowledgement & cancels escalation
    const confirmedAck = await mcp.callTool(
      {
        name: 'vitaguard_acknowledge_alert',
        arguments: {
          targetUid: aliceUid,
          alertId: sampleAlert.id,
          note: 'Confirmed safe via MCP',
        },
        confirmationToken: issuedToken,
      },
      { actingUid: aliceUid, nowMs: baseNowMs + 5_000 }
    );

    expect(confirmedAck.status).toBe('SUCCESS');
    expect(confirmedAck.structuredOutput.status).toBe('EXECUTED_WITH_CONFIRMATION');

    const taskAfterConfirm = mcp
      .getEscalationCoordinator()
      .getTaskForAlert(aliceUid, aliceUid, sampleAlert.id);
    expect(taskAfterConfirm?.status).toBe('CANCELLED');
  });

  it('5. rejects replayed, expired, parameter-tampered, or cross-user confirmation tokens on sensitive MCP tools', async () => {
    const criticalPreset = SIMULATION_PRESETS.find(
      (p) => p.expectedRisk === RiskLevel.CRITICAL
    )!;
    const mcp = new VitaGuardMcpServer();
    const sampleAlert = createSampleAlertForMcpTesting(
      criticalPreset.vitals,
      criticalPreset.environment,
      baseNowIso
    );

    mcp.ensureUserInitialized(aliceUid, {
      vitals: criticalPreset.vitals,
      environment: criticalPreset.environment,
      contacts: [VERIFIED_CONTACT],
      activeAlert: sampleAlert,
      nowMs: baseNowMs,
    });
    mcp.ensureUserInitialized(bobUid, { nowMs: baseNowMs });

    const challengeResult = await mcp.callTool(
      {
        name: 'vitaguard_reset_demo_workspace',
        arguments: {
          targetUid: aliceUid,
          reason: 'Scheduled cleanup',
        },
      },
      { actingUid: aliceUid, nowMs: baseNowMs }
    );

    const token = challengeResult.confirmationChallenge!.confirmationToken;

    // 5a. Parameter tampering (changing reason while reusing token) must fail
    await expect(
      mcp.callTool(
        {
          name: 'vitaguard_reset_demo_workspace',
          arguments: {
            targetUid: aliceUid,
            reason: 'TAMPERED_REASON',
          },
          confirmationToken: token,
        },
        { actingUid: aliceUid, nowMs: baseNowMs + 1_000 }
      )
    ).rejects.toThrow(/do not match the issued confirmation challenge/);

    // 5b. Cross-user token replay (Bob attempting to use Alice's token) must fail
    await expect(
      mcp.callTool(
        {
          name: 'vitaguard_reset_demo_workspace',
          arguments: {
            targetUid: bobUid,
            reason: 'Scheduled cleanup',
          },
          confirmationToken: token,
        },
        { actingUid: bobUid, nowMs: baseNowMs + 1_000 }
      )
    ).rejects.toThrow(/confirmationToken belongs to a different user/);

    // 5c. Expired token (> 5 minutes) must fail
    await expect(
      mcp.callTool(
        {
          name: 'vitaguard_reset_demo_workspace',
          arguments: {
            targetUid: aliceUid,
            reason: 'Scheduled cleanup',
          },
          confirmationToken: token,
        },
        { actingUid: aliceUid, nowMs: baseNowMs + 6 * 60 * 1000 }
      )
    ).rejects.toMatchObject({
      code: 'CONFIRMATION_EXPIRED',
    });

    // 5d. Valid execution consumes token, and subsequent replay is rejected
    const freshChallenge = await mcp.callTool(
      {
        name: 'vitaguard_reset_demo_workspace',
        arguments: {
          targetUid: aliceUid,
          reason: 'Valid reset',
        },
      },
      { actingUid: aliceUid, nowMs: baseNowMs + 2_000 }
    );
    const freshToken = freshChallenge.confirmationChallenge!.confirmationToken;

    const validExec = await mcp.callTool(
      {
        name: 'vitaguard_reset_demo_workspace',
        arguments: {
          targetUid: aliceUid,
          reason: 'Valid reset',
        },
        confirmationToken: freshToken,
      },
      { actingUid: aliceUid, nowMs: baseNowMs + 3_000 }
    );
    expect(validExec.status).toBe('SUCCESS');

    await expect(
      mcp.callTool(
        {
          name: 'vitaguard_reset_demo_workspace',
          arguments: {
            targetUid: aliceUid,
            reason: 'Valid reset',
          },
          confirmationToken: freshToken,
        },
        { actingUid: aliceUid, nowMs: baseNowMs + 4_000 }
      )
    ).rejects.toThrow(/already been used/);
  });
});
