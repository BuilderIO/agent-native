import { randomUUID } from "node:crypto";

import {
  defineEventHandler,
  getMethod,
  readBody,
  setResponseHeader,
  setResponseStatus,
  type EventHandler,
  type H3Event,
} from "h3";

import { createAgentHarnessActionTools } from "../../agent/harness/chat-tools.js";
import {
  getLatestAgentHarnessSessionForThread,
  registerBuiltinAgentHarnesses,
  resolveAgentHarness,
  resolveAgentHarnessApproval,
  startAgentHarnessApprovalRun,
  startAgentHarnessRun,
  type AgentHarnessAdapter,
  type AgentHarnessCreateSessionOptions,
  type AgentHarnessPermissionMode,
} from "../../agent/harness/index.js";
import {
  createPlanModeActionRegistry,
  type ActionEntry,
} from "../../agent/production-agent.js";
import {
  getActiveRunForThread,
  subscribeToRun,
} from "../../agent/run-manager.js";
import { tryClaimRunSlot } from "../../agent/run-store.js";
import type {
  AgentChatAttachment,
  AgentChatReference,
  AgentChatRequest,
} from "../../agent/types.js";

export type AgentChatHarnessGuardDecision =
  | boolean
  | {
      allowed: boolean;
      status?: number;
      error?: string;
    };

export interface AgentChatHarnessConfig {
  /** A full harness adapter, or a registered adapter name/config. Never an AgentEngine. */
  adapter:
    | AgentHarnessAdapter
    | string
    | { name: string; config?: Record<string, unknown> };
  /** Per-request authorization boundary. A denial fails closed without engine fallback. */
  guard?: (
    event: H3Event,
  ) => AgentChatHarnessGuardDecision | Promise<AgentChatHarnessGuardDecision>;
  permissionMode?: AgentHarnessPermissionMode;
  cwd?: string | ((event: H3Event) => string | Promise<string>);
  createSession?: Omit<
    AgentHarnessCreateSessionOptions,
    "sessionId" | "threadId" | "runId" | "resumeState" | "signal"
  >;
  instructions?: string | ((event: H3Event) => string | Promise<string>);
  metadata?: Record<string, unknown>;
}

export interface AgentHarnessChatHandlerOptions {
  harness: AgentChatHarnessConfig;
  actions?: Record<string, ActionEntry>;
  resolveOwnerEmail: (event: H3Event) => string | null | Promise<string | null>;
  resolveOrgId?: (
    event: H3Event,
  ) => string | null | undefined | Promise<string | null | undefined>;
  systemPrompt?: string | ((event: H3Event) => string | Promise<string>);
  prepareRequest?: (details: {
    event: H3Event;
    ownerEmail: string;
    message: string;
    displayMessage?: string;
    attachments: AgentChatAttachment[];
    references: AgentChatReference[];
    threadId?: string;
    internalContinuation?: boolean;
    mode: "act" | "plan";
  }) =>
    | void
    | {
        message?: string;
        displayMessage?: string;
        attachments?: AgentChatAttachment[];
      }
    | Promise<void | {
        message?: string;
        displayMessage?: string;
        attachments?: AgentChatAttachment[];
      }>;
  onRunPrepared?: (details: {
    runId: string;
    threadId: string | undefined;
    message: string;
    attachments?: AgentChatAttachment[];
  }) => void | Promise<void>;
  onRunComplete?: (
    run: import("../../agent/run-manager.js").ActiveRun,
    threadId: string | undefined,
  ) => void | Promise<void>;
}

const ALLOWED_GUARD_STATUS = new Set([401, 403, 404, 409, 503]);

export function resolveAgentChatHarnessAdapter(
  config: Pick<AgentChatHarnessConfig, "adapter">,
  resolve: typeof resolveAgentHarness = resolveAgentHarness,
): AgentHarnessAdapter {
  if (typeof config.adapter === "object" && "createSession" in config.adapter) {
    return config.adapter;
  }
  registerBuiltinAgentHarnesses();
  if (typeof config.adapter === "string") return resolve(config.adapter);
  return resolve(config.adapter.name, config.adapter.config);
}

export async function evaluateAgentChatHarnessGuard(
  config: AgentChatHarnessConfig,
  event: H3Event,
): Promise<
  { allowed: true } | { allowed: false; status: number; error: string }
> {
  if (!config.guard) return { allowed: true };
  const decision = await config.guard(event);
  if (decision === true || (typeof decision === "object" && decision.allowed)) {
    return { allowed: true };
  }
  const requestedStatus =
    typeof decision === "object" ? decision.status : undefined;
  return {
    allowed: false,
    status:
      requestedStatus && ALLOWED_GUARD_STATUS.has(requestedStatus)
        ? requestedStatus
        : 403,
    error:
      typeof decision === "object" && decision.error
        ? decision.error
        : "Agent harness access denied",
  };
}

export function createAgentHarnessChatHandler(
  options: AgentHarnessChatHandlerOptions,
): EventHandler {
  return defineEventHandler(async (event) => {
    if (getMethod(event) !== "POST") {
      setResponseStatus(event, 405);
      return { error: "Method not allowed" };
    }

    const guard = await evaluateAgentChatHarnessGuard(options.harness, event);
    if (!guard.allowed) {
      setResponseStatus(event, guard.status);
      return { error: guard.error };
    }

    let body: AgentChatRequest;
    try {
      const parsed = await readBody<AgentChatRequest>(event);
      if (!parsed || typeof parsed !== "object")
        throw new Error("invalid body");
      body = parsed;
    } catch {
      setResponseStatus(event, 400);
      return { error: "Invalid request body" };
    }
    if (body.__backgroundRun) {
      setResponseStatus(event, 503);
      return {
        error: "Agent harness chat requires a foreground runtime",
      };
    }

    const ownerEmail = await options.resolveOwnerEmail(event);
    if (!ownerEmail) {
      setResponseStatus(event, 401);
      return { error: "Authentication required" };
    }
    const orgId = (await options.resolveOrgId?.(event)) ?? null;
    const threadId = body.threadId;
    const effectiveThreadId = threadId ?? randomUUID();
    const turnId = body.turnId ?? randomUUID();
    const runId = randomUUID();
    const requestMode = body.mode === "plan" ? "plan" : "act";
    const adapter = resolveAgentChatHarnessAdapter(options.harness);
    const latest = await getLatestAgentHarnessSessionForThread(
      effectiveThreadId,
      adapter.name,
      { ownerEmail, orgId },
    );
    const pendingApproval = pendingApprovalId(latest?.pendingApproval);
    const approved = body.approvedToolCalls?.find(
      (approvalKey) => approvalKey === pendingApproval,
    );

    if (approved && latest?.runId) {
      const activeRun = getActiveRunForThread(effectiveThreadId);
      if (activeRun?.runId === latest.runId) {
        const result = await resolveAgentHarnessApproval({
          runId: latest.runId,
          approval: { id: approved, approved: true },
          scope: { ownerEmail, orgId },
        });
        if (!result.ok) {
          setResponseStatus(event, 409);
          return { error: result.error ?? "Harness approval failed" };
        }
        return streamHarnessRun(event, activeRun.runId);
      }
      if (activeRun) {
        setResponseStatus(event, 409);
        return {
          error: "Run already in progress for this thread",
          activeRunId: activeRun.runId,
        };
      }
      const run = startAgentHarnessApprovalRun({
        runId,
        harnessRunId: latest.runId,
        threadId: effectiveThreadId,
        turnId,
        approval: { id: approved, approved: true },
        scope: { ownerEmail, orgId },
        onRunComplete: options.onRunComplete
          ? (completed) => options.onRunComplete!(completed, threadId)
          : undefined,
      });
      return streamHarnessRun(event, run.runId);
    }
    if (pendingApproval) {
      setResponseStatus(event, 409);
      return {
        error: "Resolve the pending harness approval before continuing",
        approvalKey: pendingApproval,
      };
    }

    const hasMessage =
      typeof body.message === "string" && body.message.trim().length > 0;
    const attachments = Array.isArray(body.attachments) ? body.attachments : [];
    if (attachments.length > 0) {
      setResponseStatus(event, 400);
      return {
        error: "This agent harness does not support chat attachments",
      };
    }
    if (!hasMessage) {
      setResponseStatus(event, 400);
      return { error: "message is required" };
    }

    let message = body.message;
    let preparedAttachments = attachments;
    const prepared = await options.prepareRequest?.({
      event,
      ownerEmail,
      message,
      displayMessage: body.displayMessage,
      attachments,
      references: Array.isArray(body.references) ? body.references : [],
      threadId,
      internalContinuation: Boolean(body.internalContinuation),
      mode: requestMode,
    });
    if (prepared?.message?.trim()) message = prepared.message;
    if (prepared?.attachments) preparedAttachments = prepared.attachments;
    if (preparedAttachments.length > 0) {
      setResponseStatus(event, 400);
      return {
        error: "This agent harness does not support chat attachments",
      };
    }
    if (!message.trim()) {
      setResponseStatus(event, 400);
      return { error: "message is required" };
    }

    const configuredInstructions = await resolveValue(
      options.harness.instructions,
      event,
    );
    const systemPrompt = await resolveValue(options.systemPrompt, event);
    const configuredCwd = await resolveValue(options.harness.cwd, event);
    const requestActions = options.actions
      ? requestMode === "plan"
        ? createPlanModeActionRegistry(options.actions)
        : options.actions
      : undefined;
    const actionTools = requestActions
      ? createAgentHarnessActionTools({
          actions: requestActions,
          ownerEmail,
          orgId,
          threadId: effectiveThreadId,
          turnId,
        })
      : {};
    const createSession: AgentHarnessCreateSessionOptions = {
      ...(options.harness.createSession ?? {}),
      sessionId: latest?.id ?? randomUUID(),
      resumeState: latest?.resumeState,
      ...(configuredCwd ? { cwd: configuredCwd } : {}),
      ...(systemPrompt || configuredInstructions
        ? {
            instructions: [systemPrompt, configuredInstructions]
              .filter(Boolean)
              .join("\n\n"),
          }
        : {}),
      tools: {
        ...(options.harness.createSession?.tools ?? {}),
        ...actionTools,
      },
      permissionMode:
        requestMode === "plan"
          ? "allow-reads"
          : (options.harness.permissionMode ??
            options.harness.createSession?.permissionMode ??
            "allow-reads"),
      metadata: {
        ...(options.harness.createSession?.metadata ?? {}),
        ...(options.harness.metadata ?? {}),
      },
    };

    if (threadId) {
      const activeRun = getActiveRunForThread(threadId);
      if (activeRun) {
        setResponseStatus(event, 409);
        return {
          error: "Run already in progress for this thread",
          activeRunId: activeRun.runId,
        };
      }
      const slot = await tryClaimRunSlot(threadId);
      if (!slot.claimed) {
        setResponseStatus(event, 409);
        return {
          error: "Run already in progress for this thread",
          activeRunId: slot.activeRunId,
        };
      }
    }

    await options.onRunPrepared?.({
      runId,
      threadId,
      message: body.displayMessage ?? message,
    });

    const run = startAgentHarnessRun({
      runId,
      threadId: effectiveThreadId,
      turnId,
      adapter,
      input: {
        prompt: message,
        metadata: options.harness.metadata,
      },
      createSession,
      ownerEmail,
      orgId,
      onRunComplete: options.onRunComplete
        ? (completed) => options.onRunComplete!(completed, threadId)
        : undefined,
    });
    return streamHarnessRun(event, run.runId);
  });
}

async function resolveValue(
  value: string | ((event: H3Event) => string | Promise<string>) | undefined,
  event: H3Event,
): Promise<string | undefined> {
  return typeof value === "function" ? value(event) : value;
}

function pendingApprovalId(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as { type?: unknown; id?: unknown };
  return record.type === "approval-request" && typeof record.id === "string"
    ? record.id
    : null;
}

function streamHarnessRun(event: H3Event, runId: string) {
  const stream = subscribeToRun(runId, 0);
  if (!stream) {
    setResponseStatus(event, 500);
    return { error: "Failed to start agent harness run" };
  }
  setResponseHeader(event, "Content-Type", "text/event-stream");
  setResponseHeader(event, "Cache-Control", "no-cache");
  setResponseHeader(event, "Connection", "keep-alive");
  setResponseHeader(event, "X-Run-Id", runId);
  setResponseHeader(event, "X-Dispatch-Mode", "foreground");
  return stream;
}
