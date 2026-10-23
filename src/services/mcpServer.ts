import crypto from 'crypto';
import {
  DEFAULT_THRESHOLDS,
  evaluateRisk,
  RULE_ENGINE_VERSION,
  SIMULATION_PRESETS,
} from '../engine/riskEngine';
import { createAlertFromAssessment } from '../engine/alertManager';
import { SecureSafetyRepositorySimulator } from '../repositories/safetyRepository';
import {
  DataSourceMode,
  EmergencyContact,
  EnvironmentReadings,
  EscalationPolicyConfig,
  NormalizedObservation,
  PersistedAIExplanation,
  RiskAssessment,
  RiskLevel,
  RiskThresholds,
  SafetyAlert,
  SafetyEvent,
  VitalReadings,
} from '../types/safety';
import {
  EnvironmentalDataProvider,
  SimulationDataProvider,
  TelemetryIngestionCoordinator,
  WearableDataProvider,
} from './dataIngestionEngine';
import { generateSafetyExplanation } from './explanationService';
import {
  AI_PROMPT_VERSION,
  AI_SCHEMA_VERSION,
  computeAssessmentFingerprint,
  GEMINI_EXPLANATION_MODEL,
  GeminiExplanationOrchestrator,
} from './geminiExplanationEngine';
import {
  DEFAULT_ESCALATION_POLICY,
  DurableEscalationCoordinator,
  SimulationNotificationProvider,
} from './notificationEngine';

export const MCP_PROTOCOL_VERSION = '2024-11-05';
export const VITAGUARD_MCP_SERVER_NAME = 'vitaguard-safety-mcp-server';
export const VITAGUARD_MCP_SERVER_VERSION = '1.0.0';

export type VitaGuardMcpToolName =
  | 'vitaguard_get_risk_status'
  | 'vitaguard_explain_assessment'
  | 'vitaguard_list_alert_history'
  | 'vitaguard_acknowledge_alert'
  | 'vitaguard_trigger_escalation_check'
  | 'vitaguard_reset_demo_workspace';

export interface McpToolDefinition {
  name: VitaGuardMcpToolName;
  description: string;
  sensitivity: 'READ_ONLY' | 'SENSITIVE_MUTATION';
  requiresConfirmation: boolean;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface PendingConfirmationChallenge {
  confirmationToken: string;
  toolName: VitaGuardMcpToolName;
  actingUid: string;
  targetUid: string;
  argumentsHash: string;
  sanitizedArguments: Record<string, unknown>;
  actionSummary: string;
  impactWarning: string;
  issuedAtIso: string;
  expiresAtIso: string;
  expiresAtMs: number;
  consumed: boolean;
}

export interface McpAuthContext {
  actingUid: string | null;
  authBearerVerified?: boolean;
  nowMs?: number;
}

export interface McpToolCallRequest {
  name: VitaGuardMcpToolName | string;
  arguments?: Record<string, unknown>;
  confirmationToken?: string;
}

export interface McpContentBlock {
  type: 'text';
  text: string;
}

export interface McpToolCallResult {
  isError?: boolean;
  status: 'SUCCESS' | 'CONFIRMATION_REQUIRED' | 'ERROR';
  toolName: string;
  requiresConfirmation: boolean;
  dataMode: DataSourceMode;
  confirmationChallenge?: Omit<PendingConfirmationChallenge, 'argumentsHash' | 'expiresAtMs' | 'consumed'>;
  structuredOutput: Record<string, unknown>;
  content: McpContentBlock[];
}

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export class McpSecurityError extends Error {
  public readonly code:
    | 'UNAUTHENTICATED'
    | 'PERMISSION_DENIED'
    | 'INVALID_TOOL'
    | 'INVALID_ARGUMENTS'
    | 'CONFIRMATION_INVALID'
    | 'CONFIRMATION_EXPIRED';
  public readonly httpStatus: number;

  constructor(
    code:
      | 'UNAUTHENTICATED'
      | 'PERMISSION_DENIED'
      | 'INVALID_TOOL'
      | 'INVALID_ARGUMENTS'
      | 'CONFIRMATION_INVALID'
      | 'CONFIRMATION_EXPIRED',
    message: string,
    httpStatus: number = 403
  ) {
    super(message);
    this.name = 'McpSecurityError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export const VITAGUARD_MCP_TOOLS: McpToolDefinition[] = [
  {
    name: 'vitaguard_get_risk_status',
    description:
      'Retrieves the authenticated user’s current authoritative deterministic risk classification (LOW, MODERATE, HIGH, CRITICAL), triggered physiological/environmental rules, data freshness, and source provenance (SIMULATED vs REAL). Read-only and safe to call without confirmation.',
    sensitivity: 'READ_ONLY',
    requiresConfirmation: false,
    inputSchema: {
      type: 'object',
      properties: {
        targetUid: {
          type: 'string',
          description: 'Authenticated user UID (must match the caller’s actingUid).',
        },
        presetId: {
          type: 'string',
          description: 'Optional simulation preset ID to evaluate or inspect current state.',
        },
      },
      required: ['targetUid'],
    },
  },
  {
    name: 'vitaguard_explain_assessment',
    description:
      'Generates or retrieves a structured, non-diagnostic explanation of the deterministic risk engine’s output and triggered rules. Never alters the deterministic risk score or alert state. Read-only and safe to call.',
    sensitivity: 'READ_ONLY',
    requiresConfirmation: false,
    inputSchema: {
      type: 'object',
      properties: {
        targetUid: {
          type: 'string',
          description: 'Authenticated user UID (must match caller actingUid).',
        },
        assessmentId: {
          type: 'string',
          description: 'Identifier of the deterministic risk assessment to explain.',
        },
        userNote: {
          type: 'string',
          description: 'Optional user context note (sanitized against prompt injection).',
        },
      },
      required: ['targetUid'],
    },
  },
  {
    name: 'vitaguard_list_alert_history',
    description:
      'Lists the authenticated user’s safety alerts, durable escalation tasks, notification delivery attempts, and immutable audit events. Read-only and safe to call.',
    sensitivity: 'READ_ONLY',
    requiresConfirmation: false,
    inputSchema: {
      type: 'object',
      properties: {
        targetUid: {
          type: 'string',
          description: 'Authenticated user UID (must match caller actingUid).',
        },
        statusFilter: {
          type: 'string',
          enum: ['ALL', 'ACTIVE', 'ACKNOWLEDGED', 'RESOLVED'],
          description: 'Optional filter by alert lifecycle status.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of records to return (1-50, default 20).',
        },
      },
      required: ['targetUid'],
    },
  },
  {
    name: 'vitaguard_acknowledge_alert',
    description:
      'SENSITIVE ACTION: Acknowledges an active safety alert ("I am safe") and cancels its pending emergency contact escalation timer. Requires an explicit human-in-the-loop confirmationToken.',
    sensitivity: 'SENSITIVE_MUTATION',
    requiresConfirmation: true,
    inputSchema: {
      type: 'object',
      properties: {
        targetUid: {
          type: 'string',
          description: 'Authenticated user UID (must match caller actingUid).',
        },
        alertId: {
          type: 'string',
          description: 'ID of the active safety alert to acknowledge.',
        },
        note: {
          type: 'string',
          description: 'Check-in note recorded in the immutable safety audit trail.',
        },
      },
      required: ['targetUid', 'alertId'],
    },
  },
  {
    name: 'vitaguard_trigger_escalation_check',
    description:
      'SENSITIVE ACTION: Immediately executes an overdue escalation sweep for the authenticated user’s active alert in SIMULATION mode (or configured policy mode). Requires an explicit human-in-the-loop confirmationToken.',
    sensitivity: 'SENSITIVE_MUTATION',
    requiresConfirmation: true,
    inputSchema: {
      type: 'object',
      properties: {
        targetUid: {
          type: 'string',
          description: 'Authenticated user UID (must match caller actingUid).',
        },
        alertId: {
          type: 'string',
          description: 'ID of the alert whose escalation task should be evaluated.',
        },
        simulateDeadlineExpired: {
          type: 'boolean',
          description:
            'If true in simulation mode, advances evaluation past the alert deadline to test contact dispatch.',
        },
      },
      required: ['targetUid', 'alertId'],
    },
  },
  {
    name: 'vitaguard_reset_demo_workspace',
    description:
      'SENSITIVE ACTION: Purges SIMULATED demonstration observations, alerts, and escalation tasks for the authenticated user while strictly preserving REAL wearable observations and user profile settings. Requires an explicit human-in-the-loop confirmationToken.',
    sensitivity: 'SENSITIVE_MUTATION',
    requiresConfirmation: true,
    inputSchema: {
      type: 'object',
      properties: {
        targetUid: {
          type: 'string',
          description: 'Authenticated user UID (must match caller actingUid).',
        },
        reason: {
          type: 'string',
          description: 'Optional reason for resetting simulated demo state.',
        },
      },
      required: ['targetUid'],
    },
  },
];

const VALID_ID_REGEX = /^[a-zA-Z0-9_-]{1,128}$/;
const CONFIRMATION_TTL_MS = 5 * 60 * 1000; // 5 minutes

export interface UserRuntimeContext {
  vitals: VitalReadings;
  environment: EnvironmentReadings;
  thresholds: RiskThresholds;
  dataMode: DataSourceMode;
  latestAssessment: RiskAssessment;
  latestAssessmentId: string;
}

export interface VitaGuardMcpServerOptions {
  repository?: SecureSafetyRepositorySimulator;
  escalationCoordinator?: DurableEscalationCoordinator;
  ingestionCoordinator?: TelemetryIngestionCoordinator;
  geminiOrchestrator?: GeminiExplanationOrchestrator;
}

function stableHashArguments(
  toolName: string,
  actingUid: string,
  targetUid: string,
  args: Record<string, unknown>
): string {
  const filteredEntries = Object.entries(args)
    .filter(([k]) => k !== 'confirmationToken')
    .sort(([a], [b]) => a.localeCompare(b));
  const canonical = JSON.stringify({
    toolName,
    actingUid,
    targetUid,
    args: Object.fromEntries(filteredEntries),
  });
  return crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 32);
}

export class VitaGuardMcpServer {
  private readonly repo: SecureSafetyRepositorySimulator;
  private readonly escalationCoordinator: DurableEscalationCoordinator;
  private readonly ingestionCoordinator: TelemetryIngestionCoordinator;
  private readonly geminiOrchestrator?: GeminiExplanationOrchestrator;
  private readonly userContexts = new Map<string, UserRuntimeContext>();
  private readonly pendingChallenges = new Map<string, PendingConfirmationChallenge>();
  private readonly mcpAuditLog = new Map<string, SafetyEvent[]>();

  constructor(options: VitaGuardMcpServerOptions = {}) {
    this.repo = options.repository ?? new SecureSafetyRepositorySimulator();
    this.escalationCoordinator =
      options.escalationCoordinator ??
      new DurableEscalationCoordinator({
        provider: new SimulationNotificationProvider(),
      });
    this.ingestionCoordinator =
      options.ingestionCoordinator ??
      new TelemetryIngestionCoordinator({
        providers: [
          new SimulationDataProvider(),
          new WearableDataProvider(),
          new EnvironmentalDataProvider(),
        ],
      });
    this.geminiOrchestrator = options.geminiOrchestrator;
  }

  public getRepository(): SecureSafetyRepositorySimulator {
    return this.repo;
  }

  public getEscalationCoordinator(): DurableEscalationCoordinator {
    return this.escalationCoordinator;
  }

  public getIngestionCoordinator(): TelemetryIngestionCoordinator {
    return this.ingestionCoordinator;
  }

  public listTools(): McpToolDefinition[] {
    return VITAGUARD_MCP_TOOLS.map((t) => structuredClone(t));
  }

  public getPendingChallengesForUser(actingUid: string, targetUid: string): PendingConfirmationChallenge[] {
    this.assertAuthenticatedOwner(actingUid, targetUid);
    const results: PendingConfirmationChallenge[] = [];
    for (const challenge of this.pendingChallenges.values()) {
      if (challenge.actingUid === actingUid && !challenge.consumed) {
        results.push(structuredClone(challenge));
      }
    }
    return results;
  }

  private assertAuthenticatedOwner(actingUid: string | null | undefined, targetUid: string): string {
    const cleanActing = (actingUid || '').trim();
    const cleanTarget = (targetUid || '').trim();
    if (!cleanActing) {
      throw new McpSecurityError(
        'UNAUTHENTICATED',
        'MCP request rejected: missing authenticated actingUid.',
        401
      );
    }
    if (!VALID_ID_REGEX.test(cleanActing) || !VALID_ID_REGEX.test(cleanTarget)) {
      throw new McpSecurityError(
        'INVALID_ARGUMENTS',
        'MCP request rejected: invalid UID format.',
        400
      );
    }
    if (cleanActing !== cleanTarget) {
      throw new McpSecurityError(
        'PERMISSION_DENIED',
        `MCP request rejected: user "${cleanActing}" cannot access or mutate records belonging to "${cleanTarget}".`,
        403
      );
    }
    return cleanActing;
  }

  public ensureUserInitialized(
    uid: string,
    options?: {
      vitals?: VitalReadings;
      environment?: EnvironmentReadings;
      thresholds?: RiskThresholds;
      contacts?: EmergencyContact[];
      policy?: Partial<EscalationPolicyConfig>;
      activeAlert?: SafetyAlert | null;
      nowMs?: number;
    }
  ): UserRuntimeContext {
    const nowIso = new Date(options?.nowMs ?? Date.now()).toISOString();
    try {
      this.repo.getSettings(uid, uid);
    } catch {
      // ignore
    }

    // Ensure profile exists in simulator repository
    try {
      this.repo.createProfile(uid, uid, {
        uid,
        email: `${uid}@vitaguard.local`,
        displayName: 'VitaGuard Operator',
        simulationNoticeAccepted: true,
        createdAt: nowIso,
        updatedAt: nowIso,
      });
    } catch {
      // Profile already exists
    }

    const existing = this.userContexts.get(uid);
    const vitals = options?.vitals ?? existing?.vitals ?? SIMULATION_PRESETS[0].vitals;
    const environment =
      options?.environment ?? existing?.environment ?? SIMULATION_PRESETS[0].environment;
    const thresholds = options?.thresholds ?? existing?.thresholds ?? DEFAULT_THRESHOLDS;
    const assessment = {
      ...evaluateRisk(vitals, environment, thresholds),
      evaluatedAt: nowIso,
    };
    const assessmentId =
      existing?.latestAssessmentId ??
      `risk-mcp-${computeAssessmentFingerprint(assessment, vitals, environment)}`;

    const ctx: UserRuntimeContext = {
      vitals: structuredClone(vitals),
      environment: structuredClone(environment),
      thresholds: structuredClone(thresholds),
      dataMode: existing?.dataMode ?? 'SIMULATED',
      latestAssessment: assessment,
      latestAssessmentId: assessmentId,
    };
    this.userContexts.set(uid, ctx);

    if (options?.contacts) {
      for (const c of options.contacts) {
        this.repo.saveContact(uid, uid, c);
      }
      this.escalationCoordinator.setContactsForUser(uid, uid, options.contacts);
    }

    if (options?.policy) {
      this.escalationCoordinator.setPolicyForUser(uid, uid, options.policy);
    }

    if (options?.activeAlert) {
      try {
        this.repo.createAlert(uid, uid, options.activeAlert);
      } catch {
        // Already exists
      }
      this.escalationCoordinator.scheduleAlertEscalation({
        actingUid: uid,
        targetUid: uid,
        alert: options.activeAlert,
        contacts: options?.contacts ?? this.repo.listContacts(uid, uid),
        policy: options?.policy ?? DEFAULT_ESCALATION_POLICY,
        nowMs: options?.nowMs ?? Date.now(),
      });
    }

    return ctx;
  }

  private recordMcpAuditEvent(uid: string, event: SafetyEvent): void {
    const existing = this.mcpAuditLog.get(uid) ?? [];
    existing.unshift(event);
    this.mcpAuditLog.set(uid, existing.slice(0, 100));
  }

  private createOrVerifyConfirmation(params: {
    toolDef: McpToolDefinition;
    actingUid: string;
    targetUid: string;
    args: Record<string, unknown>;
    confirmationToken?: string;
    actionSummary: string;
    impactWarning: string;
    nowMs: number;
  }): { verified: true } | { verified: false; challenge: PendingConfirmationChallenge } {
    const {
      toolDef,
      actingUid,
      targetUid,
      args,
      confirmationToken,
      actionSummary,
      impactWarning,
      nowMs,
    } = params;

    const argsHash = stableHashArguments(toolDef.name, actingUid, targetUid, args);

    if (!confirmationToken) {
      const token = `mcp-confirm-${crypto.randomBytes(12).toString('hex')}`;
      const issuedAtIso = new Date(nowMs).toISOString();
      const expiresAtMs = nowMs + CONFIRMATION_TTL_MS;
      const sanitizedArgs = { ...args };
      delete sanitizedArgs.confirmationToken;

      const challenge: PendingConfirmationChallenge = {
        confirmationToken: token,
        toolName: toolDef.name,
        actingUid,
        targetUid,
        argumentsHash: argsHash,
        sanitizedArguments: sanitizedArgs,
        actionSummary,
        impactWarning,
        issuedAtIso,
        expiresAtIso: new Date(expiresAtMs).toISOString(),
        expiresAtMs,
        consumed: false,
      };
      this.pendingChallenges.set(token, challenge);
      return { verified: false, challenge };
    }

    const stored = this.pendingChallenges.get(confirmationToken);
    if (!stored) {
      throw new McpSecurityError(
        'CONFIRMATION_INVALID',
        'Sensitive MCP action rejected: confirmationToken is unknown or invalid.',
        403
      );
    }
    if (stored.consumed) {
      throw new McpSecurityError(
        'CONFIRMATION_INVALID',
        'Sensitive MCP action rejected: confirmationToken has already been used.',
        403
      );
    }
    if (stored.actingUid !== actingUid || stored.targetUid !== targetUid) {
      throw new McpSecurityError(
        'PERMISSION_DENIED',
        'Sensitive MCP action rejected: confirmationToken belongs to a different user.',
        403
      );
    }
    if (stored.toolName !== toolDef.name || stored.argumentsHash !== argsHash) {
      throw new McpSecurityError(
        'CONFIRMATION_INVALID',
        'Sensitive MCP action rejected: tool arguments or tool name do not match the issued confirmation challenge.',
        403
      );
    }
    if (nowMs > stored.expiresAtMs) {
      throw new McpSecurityError(
        'CONFIRMATION_EXPIRED',
        'Sensitive MCP action rejected: confirmationToken has expired. Request a new confirmation challenge.',
        403
      );
    }

    stored.consumed = true;
    return { verified: true };
  }

  public async callTool(
    request: McpToolCallRequest,
    auth: McpAuthContext
  ): Promise<McpToolCallResult> {
    const nowMs = auth.nowMs ?? Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const toolDef = VITAGUARD_MCP_TOOLS.find((t) => t.name === request.name);

    if (!toolDef) {
      throw new McpSecurityError(
        'INVALID_TOOL',
        `Unknown MCP tool "${request.name}". Call tools/list to inspect supported VitaGuard MCP tools.`,
        400
      );
    }

    const args =
      request.arguments && typeof request.arguments === 'object'
        ? { ...request.arguments }
        : {};
    const rawTargetUid =
      typeof args.targetUid === 'string' && args.targetUid.trim()
        ? args.targetUid.trim()
        : (auth.actingUid || '').trim();

    const uid = this.assertAuthenticatedOwner(auth.actingUid, rawTargetUid);
    const userCtx = this.ensureUserInitialized(uid, { nowMs });

    const tokenFromArgs =
      typeof args.confirmationToken === 'string' && args.confirmationToken.trim()
        ? args.confirmationToken.trim()
        : undefined;
    const effectiveToken = request.confirmationToken || tokenFromArgs;

    // 1. vitaguard_get_risk_status (READ_ONLY)
    if (toolDef.name === 'vitaguard_get_risk_status') {
      const presetId = typeof args.presetId === 'string' ? args.presetId.trim() : undefined;
      let vitals = userCtx.vitals;
      let environment = userCtx.environment;

      if (presetId) {
        const foundPreset = SIMULATION_PRESETS.find((p) => p.id === presetId);
        if (!foundPreset) {
          throw new McpSecurityError(
            'INVALID_ARGUMENTS',
            `Unknown simulation presetId "${presetId}".`,
            400
          );
        }
        vitals = foundPreset.vitals;
        environment = foundPreset.environment;
      }

      const assessment: RiskAssessment = {
        ...evaluateRisk(vitals, environment, userCtx.thresholds),
        evaluatedAt: nowIso,
        ruleVersion: RULE_ENGINE_VERSION,
      };
      const assessmentId = `risk-mcp-${computeAssessmentFingerprint(
        assessment,
        vitals,
        environment
      )}`;

      userCtx.vitals = structuredClone(vitals);
      userCtx.environment = structuredClone(environment);
      userCtx.latestAssessment = assessment;
      userCtx.latestAssessmentId = assessmentId;

      const observations = this.repo.getNormalizedObservations(uid, uid);
      const activeTasks = this.escalationCoordinator.getTasksForUser(uid, uid);

      const structuredOutput = {
        userId: uid,
        assessmentId,
        authoritativeEngine: 'vitaguard-deterministic-rule-engine',
        ruleVersion: RULE_ENGINE_VERSION,
        dataMode: userCtx.dataMode,
        riskLevel: assessment.riskLevel,
        overallScore: assessment.overallScore,
        physiologicalRisk: assessment.physiologicalRisk,
        environmentalRisk: assessment.environmentalRisk,
        heatIndexCelsius: assessment.heatIndexCelsius,
        primaryConcern: assessment.primaryConcern,
        triggeredRules: assessment.triggeredRules,
        vitalsSnapshot: vitals,
        environmentSnapshot: environment,
        observationCount: observations.length,
        activeEscalationTaskCount: activeTasks.filter((t) => t.status === 'SCHEDULED').length,
        evaluatedAt: nowIso,
      };

      return {
        status: 'SUCCESS',
        toolName: toolDef.name,
        requiresConfirmation: false,
        dataMode: userCtx.dataMode,
        structuredOutput,
        content: [
          {
            type: 'text',
            text: JSON.stringify(structuredOutput, null, 2),
          },
        ],
      };
    }

    // 2. vitaguard_explain_assessment (READ_ONLY)
    if (toolDef.name === 'vitaguard_explain_assessment') {
      const requestedAssessmentId =
        typeof args.assessmentId === 'string' && args.assessmentId.trim()
          ? args.assessmentId.trim()
          : userCtx.latestAssessmentId;
      const userNote =
        typeof args.userNote === 'string' ? args.userNote.slice(0, 280) : undefined;

      const assessment = userCtx.latestAssessment;

      if (this.geminiOrchestrator) {
        const aiExp = await this.geminiOrchestrator.explainAssessment(
          {
            actingUid: uid,
            targetUid: uid,
            assessmentId: requestedAssessmentId,
            assessment,
            vitals: userCtx.vitals,
            environment: userCtx.environment,
            sourceDataMode: userCtx.dataMode,
            userNote,
          },
          nowMs
        );

        const structuredOutput = {
          explanation: aiExp,
          authoritativeRiskUnchanged: {
            riskLevel: assessment.riskLevel,
            overallScore: assessment.overallScore,
          },
        };

        return {
          status: 'SUCCESS',
          toolName: toolDef.name,
          requiresConfirmation: false,
          dataMode: aiExp.dataMode,
          structuredOutput,
          content: [
            {
              type: 'text',
              text: JSON.stringify(structuredOutput, null, 2),
            },
          ],
        };
      }

      // Deterministic structured fallback when live Gemini orchestrator is not injected
      const deterministicReport = generateSafetyExplanation(
        assessment,
        userCtx.vitals,
        userCtx.environment
      );

      const fallbackExplanation: PersistedAIExplanation = {
        explanationId: `exp-${requestedAssessmentId}`,
        assessmentId: requestedAssessmentId,
        assessmentFingerprint: computeAssessmentFingerprint(
          assessment,
          userCtx.vitals,
          userCtx.environment
        ),
        userId: uid,
        riskLevelSnapshot: assessment.riskLevel,
        overallScoreSnapshot: assessment.overallScore,
        modelId: `${GEMINI_EXPLANATION_MODEL} (deterministic-contract)`,
        promptVersion: AI_PROMPT_VERSION,
        schemaVersion: AI_SCHEMA_VERSION,
        summary: deterministicReport.executiveSummary,
        contributingFactors: [
          deterministicReport.physiologicalCorrelation,
          deterministicReport.environmentalContext,
        ],
        triggeredRules: assessment.triggeredRules.map((r) => ({
          id: r.id,
          explanation: `${r.title}: ${r.rationale} (Observed ${r.observedValue} vs ${r.thresholdReference})`,
        })),
        uncertainties: [
          `Source mode is ${userCtx.dataMode}; single-point snapshot without continuous clinical trend verification.`,
        ],
        recommendedActions: deterministicReport.recommendedActions,
        limitations:
          'Informational explanation of deterministic rules only; not a medical diagnosis or clinical advice.',
        dataMode: userCtx.dataMode,
        generatedAt: nowIso,
      };

      const structuredOutput = {
        explanation: fallbackExplanation,
        authoritativeRiskUnchanged: {
          riskLevel: assessment.riskLevel,
          overallScore: assessment.overallScore,
        },
      };

      return {
        status: 'SUCCESS',
        toolName: toolDef.name,
        requiresConfirmation: false,
        dataMode: userCtx.dataMode,
        structuredOutput,
        content: [
          {
            type: 'text',
            text: JSON.stringify(structuredOutput, null, 2),
          },
        ],
      };
    }

    // 3. vitaguard_list_alert_history (READ_ONLY)
    if (toolDef.name === 'vitaguard_list_alert_history') {
      const statusFilter =
        typeof args.statusFilter === 'string' ? args.statusFilter.toUpperCase() : 'ALL';
      const rawLimit = typeof args.limit === 'number' ? args.limit : 20;
      const limit = Math.max(1, Math.min(50, Math.floor(rawLimit)));

      const tasks = this.escalationCoordinator.getTasksForUser(uid, uid);
      const attempts = this.escalationCoordinator.getNotificationAttemptsForUser(uid, uid);
      const repoEvents = this.repo.getAuditEvents(uid, uid);
      const coordEvents = this.escalationCoordinator.getAuditEventsForUser(uid, uid);
      const mcpEvents = this.mcpAuditLog.get(uid) ?? [];

      const alertsFromCoordinator: SafetyAlert[] = [];
      for (const t of tasks) {
        const a = this.escalationCoordinator.getAlertForUser(uid, uid, t.alertId);
        if (a) alertsFromCoordinator.push(a);
      }

      const filteredAlerts = alertsFromCoordinator
        .filter((a) => {
          if (statusFilter === 'ALL') return true;
          return a.status === statusFilter;
        })
        .slice(0, limit);

      const combinedAuditEvents = [...mcpEvents, ...coordEvents, ...repoEvents].slice(
        0,
        limit
      );

      const structuredOutput = {
        userId: uid,
        dataMode: userCtx.dataMode,
        statusFilter,
        alerts: filteredAlerts,
        escalationTasks: tasks.slice(0, limit),
        notificationAttempts: attempts.slice(0, limit),
        auditEvents: combinedAuditEvents,
        retrievedAt: nowIso,
      };

      return {
        status: 'SUCCESS',
        toolName: toolDef.name,
        requiresConfirmation: false,
        dataMode: userCtx.dataMode,
        structuredOutput,
        content: [
          {
            type: 'text',
            text: JSON.stringify(structuredOutput, null, 2),
          },
        ],
      };
    }

    // 4. vitaguard_acknowledge_alert (SENSITIVE_MUTATION -> Requires Confirmation)
    if (toolDef.name === 'vitaguard_acknowledge_alert') {
      const alertId = typeof args.alertId === 'string' ? args.alertId.trim() : '';
      if (!alertId || !VALID_ID_REGEX.test(alertId)) {
        throw new McpSecurityError(
          'INVALID_ARGUMENTS',
          'vitaguard_acknowledge_alert requires a valid alertId.',
          400
        );
      }
      const note =
        typeof args.note === 'string' && args.note.trim()
          ? args.note.trim().slice(0, 240)
          : 'Confirmed "I am safe" via authenticated MCP tool with human confirmation.';

      const gate = this.createOrVerifyConfirmation({
        toolDef,
        actingUid: uid,
        targetUid: uid,
        args: { targetUid: uid, alertId, note },
        confirmationToken: effectiveToken,
        actionSummary: `Acknowledge active safety alert "${alertId}" ("I am safe") and cancel pending emergency contact escalation.`,
        impactWarning:
          'Confirming this action will immediately cancel the scheduled emergency contact notification countdown for this alert.',
        nowMs,
      });

      if (!gate.verified) {
        const { argumentsHash: _h, expiresAtMs: _e, consumed: _c, ...publicChallenge } =
          gate.challenge;
        return {
          status: 'CONFIRMATION_REQUIRED',
          toolName: toolDef.name,
          requiresConfirmation: true,
          dataMode: userCtx.dataMode,
          confirmationChallenge: publicChallenge,
          structuredOutput: {
            status: 'CONFIRMATION_REQUIRED',
            message:
              'Explicit human confirmation is required before acknowledging an active safety alert or cancelling escalation.',
            confirmationChallenge: publicChallenge,
          },
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  status: 'CONFIRMATION_REQUIRED',
                  confirmationChallenge: publicChallenge,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      const coordAck = this.escalationCoordinator.acknowledgeAlertAndCancelEscalation({
        actingUid: uid,
        targetUid: uid,
        alertId,
        note,
        nowMs,
      });

      try {
        this.repo.acknowledgeAlert(uid, uid, alertId, note, nowIso);
      } catch {
        // Alert may only exist in coordinator if created via coordinator
      }

      this.recordMcpAuditEvent(uid, {
        id: `evt-mcp-ack-${nowMs}`,
        timestamp: nowIso,
        type: 'user_acknowledged',
        riskLevel: coordAck.alert.riskLevel,
        title: 'MCP Confirmed Alert Acknowledgement ("I Am Safe")',
        detail: `Alert ${alertId} acknowledged via MCP with human confirmation token. Note: ${note}`,
        alertId,
      });

      const structuredOutput = {
        status: 'EXECUTED_WITH_CONFIRMATION',
        alert: coordAck.alert,
        cancelledTask: coordAck.task,
        alreadyAcknowledged: coordAck.alreadyAcknowledged,
        acknowledgedAt: nowIso,
      };

      return {
        status: 'SUCCESS',
        toolName: toolDef.name,
        requiresConfirmation: true,
        dataMode: userCtx.dataMode,
        structuredOutput,
        content: [
          {
            type: 'text',
            text: JSON.stringify(structuredOutput, null, 2),
          },
        ],
      };
    }

    // 5. vitaguard_trigger_escalation_check (SENSITIVE_MUTATION -> Requires Confirmation)
    if (toolDef.name === 'vitaguard_trigger_escalation_check') {
      const alertId = typeof args.alertId === 'string' ? args.alertId.trim() : '';
      if (!alertId || !VALID_ID_REGEX.test(alertId)) {
        throw new McpSecurityError(
          'INVALID_ARGUMENTS',
          'vitaguard_trigger_escalation_check requires a valid alertId.',
          400
        );
      }
      const simulateDeadlineExpired = Boolean(args.simulateDeadlineExpired);

      const gate = this.createOrVerifyConfirmation({
        toolDef,
        actingUid: uid,
        targetUid: uid,
        args: { targetUid: uid, alertId, simulateDeadlineExpired },
        confirmationToken: effectiveToken,
        actionSummary: `Execute overdue escalation check for alert "${alertId}" (deliveryMode: SIMULATION).`,
        impactWarning:
          'Confirming this action will evaluate the alert deadline and trigger configured emergency contact notification attempts if unacknowledged.',
        nowMs,
      });

      if (!gate.verified) {
        const { argumentsHash: _h, expiresAtMs: _e, consumed: _c, ...publicChallenge } =
          gate.challenge;
        return {
          status: 'CONFIRMATION_REQUIRED',
          toolName: toolDef.name,
          requiresConfirmation: true,
          dataMode: userCtx.dataMode,
          confirmationChallenge: publicChallenge,
          structuredOutput: {
            status: 'CONFIRMATION_REQUIRED',
            message:
              'Explicit human confirmation is required before triggering an emergency escalation sweep.',
            confirmationChallenge: publicChallenge,
          },
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  status: 'CONFIRMATION_REQUIRED',
                  confirmationChallenge: publicChallenge,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      const evaluationTimeMs = simulateDeadlineExpired ? nowMs + 600_000 : nowMs;
      const sweepSummary =
        await this.escalationCoordinator.processDueEscalations(evaluationTimeMs);
      const attempts = this.escalationCoordinator
        .getNotificationAttemptsForUser(uid, uid)
        .filter((a) => a.alertId === alertId);

      const structuredOutput = {
        status: 'EXECUTED_WITH_CONFIRMATION',
        alertId,
        deliveryMode: 'SIMULATION',
        sweepSummary,
        notificationAttempts: attempts,
        evaluatedAt: new Date(evaluationTimeMs).toISOString(),
      };

      return {
        status: 'SUCCESS',
        toolName: toolDef.name,
        requiresConfirmation: true,
        dataMode: userCtx.dataMode,
        structuredOutput,
        content: [
          {
            type: 'text',
            text: JSON.stringify(structuredOutput, null, 2),
          },
        ],
      };
    }

    // 6. vitaguard_reset_demo_workspace (SENSITIVE_MUTATION -> Requires Confirmation)
    if (toolDef.name === 'vitaguard_reset_demo_workspace') {
      const reason =
        typeof args.reason === 'string' && args.reason.trim()
          ? args.reason.trim().slice(0, 200)
          : 'Operator requested safe simulated demo reset via MCP.';

      const gate = this.createOrVerifyConfirmation({
        toolDef,
        actingUid: uid,
        targetUid: uid,
        args: { targetUid: uid, reason },
        confirmationToken: effectiveToken,
        actionSummary: `Reset SIMULATED demo telemetry, alerts, and escalation tasks for user "${uid}" while preserving REAL observations.`,
        impactWarning:
          'Confirming this action will clear all SIMULATED observations, active demo alerts, and escalation tasks in your workspace. REAL observations and profile settings will be preserved.',
        nowMs,
      });

      if (!gate.verified) {
        const { argumentsHash: _h, expiresAtMs: _e, consumed: _c, ...publicChallenge } =
          gate.challenge;
        return {
          status: 'CONFIRMATION_REQUIRED',
          toolName: toolDef.name,
          requiresConfirmation: true,
          dataMode: userCtx.dataMode,
          confirmationChallenge: publicChallenge,
          structuredOutput: {
            status: 'CONFIRMATION_REQUIRED',
            message:
              'Explicit human confirmation is required before resetting simulated workspace records.',
            confirmationChallenge: publicChallenge,
          },
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  status: 'CONFIRMATION_REQUIRED',
                  confirmationChallenge: publicChallenge,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      const repoReset = this.repo.resetDemoDataOnly(uid, uid);
      const ingestionReset = this.ingestionCoordinator.resetSimulatedDemoDataOnly(uid, uid);

      // Reset runtime context back to safe baseline
      const baselinePreset = SIMULATION_PRESETS[0];
      const baselineAssessment = {
        ...evaluateRisk(
          baselinePreset.vitals,
          baselinePreset.environment,
          userCtx.thresholds
        ),
        evaluatedAt: nowIso,
      };
      userCtx.vitals = structuredClone(baselinePreset.vitals);
      userCtx.environment = structuredClone(baselinePreset.environment);
      userCtx.latestAssessment = baselineAssessment;

      this.recordMcpAuditEvent(uid, {
        id: `evt-mcp-reset-${nowMs}`,
        timestamp: nowIso,
        type: 'assessment_change',
        riskLevel: RiskLevel.LOW,
        title: 'MCP Confirmed Safe Demo Reset',
        detail: `Purged ${repoReset.purgedSimulatedCount} repository and ${ingestionReset.purgedSimulatedCount} coordinator SIMULATED observations; preserved ${repoReset.preservedRealCount} REAL observations. Reason: ${reason}`,
      });

      const structuredOutput = {
        status: 'EXECUTED_WITH_CONFIRMATION',
        userId: uid,
        purgedSimulatedRepositoryCount: repoReset.purgedSimulatedCount,
        preservedRealRepositoryCount: repoReset.preservedRealCount,
        purgedSimulatedCoordinatorCount: ingestionReset.purgedSimulatedCount,
        preservedRealCoordinatorCount: ingestionReset.preservedRealCount,
        resetAt: nowIso,
      };

      return {
        status: 'SUCCESS',
        toolName: toolDef.name,
        requiresConfirmation: true,
        dataMode: userCtx.dataMode,
        structuredOutput,
        content: [
          {
            type: 'text',
            text: JSON.stringify(structuredOutput, null, 2),
          },
        ],
      };
    }

    throw new McpSecurityError('INVALID_TOOL', `Unhandled MCP tool "${toolDef.name}".`, 400);
  }

  /**
   * Standard JSON-RPC 2.0 MCP message handler supporting:
   * - initialize
   * - tools/list
   * - tools/call
   * - prompts/list
   * - resources/list
   */
  public async handleJsonRpc(
    rpcRequest: JsonRpcRequest,
    auth: McpAuthContext
  ): Promise<JsonRpcResponse> {
    const id = rpcRequest.id ?? null;

    try {
      if (rpcRequest.jsonrpc !== '2.0' || !rpcRequest.method) {
        return {
          jsonrpc: '2.0',
          id,
          error: {
            code: -32600,
            message: 'Invalid JSON-RPC 2.0 request.',
          },
        };
      }

      if (rpcRequest.method === 'initialize') {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: MCP_PROTOCOL_VERSION,
            serverInfo: {
              name: VITAGUARD_MCP_SERVER_NAME,
              version: VITAGUARD_MCP_SERVER_VERSION,
            },
            capabilities: {
              tools: { listChanged: false },
              prompts: { listChanged: false },
              resources: { subscribe: false, listChanged: false },
              experimental: {
                humanInTheLoopConfirmation: true,
                deterministicRiskAuthority: true,
              },
            },
          },
        };
      }

      if (rpcRequest.method === 'tools/list') {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            tools: this.listTools(),
          },
        };
      }

      if (rpcRequest.method === 'prompts/list') {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            prompts: [
              {
                name: 'vitaguard_safety_check',
                description:
                  'Inspect current deterministic risk classification, explain triggered rules, and review active alerts.',
              },
            ],
          },
        };
      }

      if (rpcRequest.method === 'resources/list') {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            resources: [
              {
                uri: 'vitaguard://policy/deterministic-authority',
                name: 'VitaGuard Deterministic Risk Authority & Non-Diagnostic Guardrails',
                mimeType: 'application/json',
              },
            ],
          },
        };
      }

      if (rpcRequest.method === 'tools/call') {
        const params = rpcRequest.params ?? {};
        const name = typeof params.name === 'string' ? params.name : '';
        const toolArgs =
          params.arguments && typeof params.arguments === 'object'
            ? (params.arguments as Record<string, unknown>)
            : {};
        const confirmationToken =
          typeof params.confirmationToken === 'string'
            ? params.confirmationToken
            : undefined;

        const callResult = await this.callTool(
          {
            name,
            arguments: toolArgs,
            confirmationToken,
          },
          auth
        );

        return {
          jsonrpc: '2.0',
          id,
          result: callResult,
        };
      }

      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32601,
          message: `Method not found: ${rpcRequest.method}`,
        },
      };
    } catch (err) {
      if (err instanceof McpSecurityError) {
        return {
          jsonrpc: '2.0',
          id,
          error: {
            code: err.httpStatus === 401 ? -32001 : err.httpStatus === 403 ? -32003 : -32602,
            message: err.message,
            data: {
              securityCode: err.code,
              httpStatus: err.httpStatus,
            },
          },
        };
      }
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32603,
          message: err instanceof Error ? err.message : 'Internal MCP server error',
        },
      };
    }
  }
}

export function createSampleAlertForMcpTesting(
  vitals: VitalReadings,
  environment: EnvironmentReadings,
  nowIso: string = new Date().toISOString()
): SafetyAlert {
  const assessment = evaluateRisk(vitals, environment, DEFAULT_THRESHOLDS);
  const alert = createAlertFromAssessment(assessment, null, nowIso);
  if (!alert) {
    throw new Error('Expected HIGH or CRITICAL assessment to create an alert.');
  }
  return alert;
}
