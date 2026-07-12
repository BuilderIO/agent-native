import type {
  BackgroundAgentControlInput,
  BackgroundAgentControlResult,
  BackgroundAgentController,
  BackgroundAgentFollowUpInput,
} from "../../code-agents/background-controller.js";
import type {
  BackgroundAgentRun,
  BackgroundAgentTranscriptEvent,
  ListBackgroundAgentRunsOptions,
} from "../../code-agents/background-run.js";
import { abortRun } from "../run-manager.js";
import { getRunEventsSince } from "../run-store.js";
import type { AgentChatEvent, RunEvent } from "../types.js";
import {
  resolveAgentHarnessApproval,
  sendAgentHarnessFollowUp,
  stopLiveAgentHarnessSession,
  type AgentHarnessOwnerScope,
} from "./lifecycle.js";
import {
  getAgentHarnessSessionByRunId,
  listAgentHarnessSessions,
  markAgentHarnessSessionStopped,
  type AgentHarnessSessionStatus,
  type StoredAgentHarnessSession,
} from "./store.js";

export function createAgentHarnessBackgroundAgentController(
  scope: AgentHarnessOwnerScope = { ownerEmail: null },
): BackgroundAgentController {
  return {
    list: (options) =>
      listAgentHarnessBackgroundRuns({
        ...options,
        ownerEmail: scope.ownerEmail,
        orgId: scope.orgId,
      }),
    get: (runId) => getAgentHarnessBackgroundRun(runId, scope),
    transcript: (runId) =>
      listAgentHarnessBackgroundTranscriptEvents(runId, scope),
    sendFollowUp: (input) => sendAgentHarnessBackgroundFollowUp(input, scope),
    control: (input) => controlAgentHarnessBackgroundRun(input, scope),
  };
}

export const agentHarnessBackgroundAgentController =
  createAgentHarnessBackgroundAgentController();

export async function listAgentHarnessBackgroundRuns(
  options: ListBackgroundAgentRunsOptions & { orgId?: string | null } = {},
): Promise<BackgroundAgentRun[]> {
  if (options.goalId && options.goalId !== "agent-harness") return [];
  const sessions = await listAgentHarnessSessions({
    ownerEmail: options.ownerEmail,
    orgId: options.orgId,
  });
  return sessions
    .filter((session) => session.ownerEmail === (options.ownerEmail ?? null))
    .filter(
      (session) =>
        options.orgId === undefined || session.orgId === options.orgId,
    )
    .filter((session) => session.runId)
    .map(toAgentHarnessBackgroundRun);
}

export async function getAgentHarnessBackgroundRun(
  runId: string,
  options: AgentHarnessOwnerScope = { ownerEmail: null },
): Promise<BackgroundAgentRun | null> {
  const session = await getAgentHarnessSessionByRunId(runId);
  if (
    session?.ownerEmail !== options.ownerEmail ||
    (options.orgId !== undefined && session.orgId !== options.orgId)
  ) {
    return null;
  }
  return session ? toAgentHarnessBackgroundRun(session) : null;
}

export async function listAgentHarnessBackgroundTranscriptEvents(
  runId: string,
  options: AgentHarnessOwnerScope = { ownerEmail: null },
): Promise<BackgroundAgentTranscriptEvent[]> {
  const session = await getAgentHarnessSessionByRunId(runId);
  if (
    session?.ownerEmail !== options.ownerEmail ||
    (options.orgId !== undefined && session.orgId !== options.orgId)
  ) {
    return [];
  }
  if (!session?.runId) return [];
  const events = await getRunEventsSince(session.runId, 0);
  return events
    .map((event) => parseRunEvent(event))
    .filter((event): event is RunEvent => Boolean(event))
    .map((event) => toAgentHarnessBackgroundTranscriptEvent(session, event))
    .filter((event): event is BackgroundAgentTranscriptEvent => Boolean(event));
}

export async function stopAgentHarnessBackgroundRun(
  runId: string,
  options: { ownerEmail: string | null; orgId?: string | null } = {
    ownerEmail: null,
  },
): Promise<BackgroundAgentControlResult> {
  const session = await getAgentHarnessSessionByRunId(runId);
  if (!session) return missingHarnessRunResult(runId);
  if (
    session.ownerEmail !== options.ownerEmail ||
    (options.orgId !== undefined && session.orgId !== options.orgId)
  ) {
    return missingHarnessRunResult(runId);
  }
  if (session.runId) {
    abortRun(session.runId, "user");
  }
  await stopLiveAgentHarnessSession({
    sessionId: session.id,
    scope: options,
  });
  await markAgentHarnessSessionStopped(session.id, "stopped");
  return {
    ok: true,
    runId,
    run: toAgentHarnessBackgroundRun({
      ...session,
      status: "stopped",
      stoppedAt: Date.now(),
    }),
  };
}

function toAgentHarnessBackgroundRun(
  session: StoredAgentHarnessSession,
): BackgroundAgentRun {
  const updatedAt = new Date(session.updatedAt).toISOString();
  const createdAt = new Date(session.createdAt).toISOString();
  return {
    schemaVersion: 1,
    id: session.runId ?? session.id,
    kind: "harness",
    source: "agent-harness",
    sourceLabel: "Agent Harness",
    sourceRecord: {
      type: "agent-harness-session",
      id: session.id,
      threadId: session.threadId,
      name: session.harnessName,
    },
    title: `${session.harnessName} harness`,
    subtitle: session.status === "running" ? "Running" : undefined,
    status: backgroundStatus(session.status),
    phase: session.status,
    createdAt,
    updatedAt,
    goalId: "agent-harness",
    needsInput: Boolean(session.pendingApproval),
    needsApproval: Boolean(session.pendingApproval),
    details: [
      { label: "Harness", value: session.harnessName },
      { label: "Session", value: session.id },
      { label: "Thread", value: session.threadId },
      ...(session.providerSessionId
        ? [{ label: "Provider session", value: session.providerSessionId }]
        : []),
    ],
    surfaceUrl: `agent-native://threads/${session.threadId}`,
    metadata: {
      harnessName: session.harnessName,
      sessionId: session.id,
      providerSessionId: session.providerSessionId,
      threadId: session.threadId,
      runId: session.runId,
      status: session.status,
      pendingApproval: session.pendingApproval,
      workspaceRef: session.workspaceRef,
    },
  };
}

function toAgentHarnessBackgroundTranscriptEvent(
  session: StoredAgentHarnessSession,
  runEvent: RunEvent,
): BackgroundAgentTranscriptEvent | null {
  const summary = summarizeAgentChatEvent(runEvent.event);
  if (!summary) return null;
  const eventId = `${session.runId ?? session.id}:${runEvent.seq}`;
  return {
    schemaVersion: 1,
    id: eventId,
    runId: session.runId ?? session.id,
    kind: summary.kind,
    source: "agent-harness",
    sourceRecord: {
      type: "agent-harness-run-event",
      id: eventId,
      seq: runEvent.seq,
    },
    message: summary.message,
    createdAt: new Date(session.updatedAt).toISOString(),
    metadata: {
      ...(summary.metadata ?? {}),
      seq: runEvent.seq,
      harnessName: session.harnessName,
      sessionId: session.id,
    },
  };
}

function summarizeAgentChatEvent(event: AgentChatEvent): {
  kind: BackgroundAgentTranscriptEvent["kind"];
  message: string;
  metadata?: Record<string, unknown>;
} | null {
  switch (event.type) {
    case "text":
      return { kind: "note", message: event.text };
    case "thinking":
      return {
        kind: "status",
        message: event.text,
        metadata: { type: "thinking" },
      };
    case "activity":
      return {
        kind: "status",
        message: event.label,
        metadata: event.tool ? { tool: event.tool } : undefined,
      };
    case "tool_start":
      return {
        kind: "status",
        message: `Running ${event.tool}`,
        metadata: { type: "tool_start", tool: event.tool, input: event.input },
      };
    case "tool_done":
      return {
        kind: "artifact",
        message: event.result,
        metadata: { type: "tool_done", tool: event.tool },
      };
    case "error":
      return {
        kind: "status",
        message: event.error,
        metadata: { errorCode: event.errorCode },
      };
    case "done":
      return { kind: "status", message: "Run completed" };
    case "auto_continue":
      return {
        kind: "status",
        message: "Run reached its continuation boundary",
        metadata: { reason: event.reason },
      };
    case "clear":
      return null;
    default:
      return null;
  }
}

function parseRunEvent(row: {
  seq: number;
  eventData: string;
}): RunEvent | null {
  try {
    const event = JSON.parse(row.eventData) as AgentChatEvent;
    return { seq: Number(row.seq), event };
  } catch {
    return null;
  }
}

function backgroundStatus(
  status: AgentHarnessSessionStatus,
): BackgroundAgentRun["status"] {
  if (status === "running") return "running";
  if (status === "errored") return "errored";
  if (status === "idle" || status === "stopped" || status === "destroyed") {
    return "completed";
  }
  return "unknown";
}

async function sendAgentHarnessBackgroundFollowUp(
  input: BackgroundAgentFollowUpInput,
  scope: AgentHarnessOwnerScope,
): Promise<BackgroundAgentControlResult> {
  const result = await sendAgentHarnessFollowUp({
    runId: input.runId,
    prompt: input.prompt,
    metadata: input.metadata,
    scope,
  });
  const run = await getAgentHarnessBackgroundRun(input.runId, scope);
  return {
    ok: result.ok,
    runId: input.runId,
    run,
    queued: false,
    message: result.ok
      ? "Follow-up executed for the harness session."
      : undefined,
    error: result.error,
  };
}

async function controlAgentHarnessBackgroundRun(
  input: BackgroundAgentControlInput,
  scope: AgentHarnessOwnerScope,
): Promise<BackgroundAgentControlResult> {
  if (input.command === "stop") {
    return stopAgentHarnessBackgroundRun(input.runId, scope);
  }
  if (input.command === "approve" || input.command === "deny") {
    const session = await getAgentHarnessSessionByRunId(input.runId);
    if (!session || session.ownerEmail !== scope.ownerEmail) {
      return missingHarnessRunResult(input.runId);
    }
    const pending = session.pendingApproval as { id?: unknown } | undefined;
    if (typeof pending?.id !== "string") {
      return {
        ok: false,
        runId: input.runId,
        run: await getAgentHarnessBackgroundRun(input.runId, scope),
        error: "This harness session has no pending approval.",
      };
    }
    const result = await resolveAgentHarnessApproval({
      runId: input.runId,
      approval: { id: pending.id, approved: input.command === "approve" },
      scope,
    });
    return {
      ok: result.ok,
      runId: input.runId,
      run: await getAgentHarnessBackgroundRun(input.runId, scope),
      message: result.ok
        ? input.command === "approve"
          ? "Harness approval accepted."
          : "Harness approval denied."
        : undefined,
      error: result.error,
    };
  }
  const run = await getAgentHarnessBackgroundRun(input.runId, scope);
  return {
    ok: false,
    runId: input.runId,
    run,
    error: `Unsupported control command for harness runs: ${input.command}`,
  };
}

function missingHarnessRunResult(runId: string): BackgroundAgentControlResult {
  return {
    ok: false,
    runId,
    run: null,
    error: "Harness run not found",
  };
}
