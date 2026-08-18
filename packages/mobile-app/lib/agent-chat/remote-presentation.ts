import type { RemoteRun, RemoteTranscriptEvent } from "../remote-sessions-api";
import { applyWireEvent, initialTurnState } from "./reducer";
import type {
  ChatContentPart,
  ChatMessage,
  ChatTurnState,
  WireEvent,
} from "./types";

export interface RemoteChatState {
  messages: ChatMessage[];
  activity: string | null;
  isStreaming: boolean;
  error: string | null;
  errorCode: string | null;
}

const LIFECYCLE_MESSAGES = [
  /^Agent-Native Code run started\.?$/i,
  /^Agent-Native Code run completed\.?$/i,
  /^Agent-Native Code process exited\.?$/i,
  /^Starting local Agent-Native Code execution\.?$/i,
  /^Remote Agent-Native Code run queued\.?$/i,
  /^Connected \d+ MCP tools? for this run\.?$/i,
];

export function buildRemoteChatState(input: {
  events: readonly RemoteTranscriptEvent[];
  run?: RemoteRun | null;
  sending?: boolean;
  error?: string | null;
}): RemoteChatState {
  const orderedEvents = [...input.events].sort(compareEvents);
  let state: ChatTurnState = initialTurnState();
  let turnIndex = -1;
  let assistantId = `remote-${input.run?.id ?? orderedEvents[0]?.runId ?? "chat"}-assistant-0`;

  for (const event of orderedEvents) {
    if (event.type === "user") {
      turnIndex += 1;
      assistantId = `remote-${event.runId}-assistant-${turnIndex}`;
      const text = event.text.trim();
      if (!text) continue;
      state = {
        ...state,
        messages: [
          ...state.messages,
          {
            id: `remote-user-${event.id}`,
            role: "user",
            parts: [{ type: "text", text }],
            createdAt: toTimestamp(event.createdAt),
          },
        ],
      };
      continue;
    }

    if (turnIndex < 0) turnIndex = 0;
    const wireEvent = toWireEvent(event, state, assistantId);
    if (!wireEvent) continue;

    if (wireEvent.type === "tool_done") {
      const toolCallId = resolveToolCallId(
        state,
        assistantId,
        wireEvent.toolCallId ?? wireEvent.id,
        wireEvent.tool,
      );
      if (toolCallId && !hasTool(state, assistantId, toolCallId)) {
        state = applyWireEvent(
          state,
          {
            type: "tool_start",
            id: toolCallId,
            tool: wireEvent.tool,
            input: wireEvent.input,
          },
          assistantId,
        );
      }
      state = applyWireEvent(
        state,
        { ...wireEvent, id: toolCallId ?? wireEvent.id, toolCallId },
        assistantId,
      );
      continue;
    }

    state = applyWireEvent(state, wireEvent, assistantId);
  }

  const pendingApproval = readPendingApproval(input.run);
  if (pendingApproval) {
    const toolCallId =
      pendingApproval.toolCallId ??
      findRunningToolId(state, assistantId, pendingApproval.tool);
    const approvalKey =
      pendingApproval.approvalKey ?? toolCallId ?? "remote-approval";
    const alreadyVisible = state.messages.some((message) =>
      message.parts.some(
        (part) =>
          part.type === "tool-call" &&
          (part.approvalKey === approvalKey || part.toolCallId === toolCallId),
      ),
    );
    if (!alreadyVisible) {
      state = applyWireEvent(
        state,
        {
          type: "approval_required",
          id: toolCallId ?? approvalKey,
          toolCallId,
          tool: pendingApproval.tool ?? "Command",
          input: pendingApproval.command,
          approvalKey,
          label: pendingApproval.reason,
        },
        assistantId,
      );
    }
  }

  const isStreaming = Boolean(input.sending || isActiveRemoteRun(input.run));
  const activeMessage = state.messages.at(-1);
  const activity =
    state.activity ??
    (isStreaming && activeMessage?.role === "user"
      ? phaseLabel(input.run?.phase)
      : null);
  const workDurationMs = remoteWorkDuration(input.run);

  return {
    messages: state.messages.map((message) =>
      message.role === "assistant" && workDurationMs != null
        ? { ...message, workDurationMs }
        : message,
    ),
    activity,
    isStreaming,
    error: input.error ?? state.error,
    errorCode: state.errorCode,
  };
}

function toWireEvent(
  event: RemoteTranscriptEvent,
  state: ChatTurnState,
  assistantId: string,
): WireEvent | null {
  const metadata = event.metadata ?? {};
  const subtype = stringValue(metadata.type);
  const text = event.text.trim();
  const tool = stringValue(metadata.tool) ?? event.title;
  const toolCallId =
    stringValue(metadata.toolCallId) ?? stringValue(metadata.callId);
  const input = metadata.input;
  const result = metadata.result;
  const error =
    stringValue(metadata.error) ?? stringValue(metadata.errorMessage);

  if (subtype === "thinking" || subtype === "reasoning") {
    return { type: "reasoning", text, partId: stringValue(metadata.partId) };
  }
  if (subtype === "activity") {
    return {
      type: "activity",
      label: text || tool || "Working",
      tool,
    };
  }
  if (subtype === "tool_start") {
    return {
      type: "tool_start",
      id: toolCallId ?? event.id,
      tool: tool ?? "tool",
      input,
    };
  }
  if (subtype === "tool_done") {
    return {
      type: "tool_done",
      id: toolCallId ?? event.id,
      toolCallId: toolCallId ?? event.id,
      tool,
      input,
      result,
      error,
      isError: Boolean(metadata.isError || metadata.failed || error),
    };
  }
  if (isApprovalEvent(event, subtype)) {
    const pending = recordValue(metadata.pendingApproval);
    const approvalKey =
      stringValue(metadata.approvalKey) ??
      stringValue(metadata.pendingApprovalId) ??
      stringValue(metadata.approvalId) ??
      event.id;
    return {
      type: "approval_required",
      id: toolCallId ?? event.id,
      toolCallId: toolCallId ?? findRunningToolId(state, assistantId, tool),
      tool: tool ?? "Command",
      input: input ?? pending?.command,
      approvalKey,
      label: text || stringValue(pending?.reason),
    };
  }
  if (isErrorEvent(event, subtype)) {
    return {
      type: "error",
      error: error ?? (text || "Remote computer run failed."),
      errorCode: stringValue(metadata.errorCode),
    };
  }

  if (subtype === "assistant_delta" || subtype === "text") {
    return { type: "text", text, partId: stringValue(metadata.partId) };
  }
  if (event.type === "system" || event.type === "artifact") {
    return text ? { type: "text", text } : null;
  }
  if (event.type === "status") {
    if (isLifecycleEvent(event)) return null;
    if (stringValue(metadata.role) === "assistant") {
      return text ? { type: "text", text } : null;
    }
    return text ? { type: "text", text } : null;
  }
  return null;
}

function isApprovalEvent(
  event: RemoteTranscriptEvent,
  subtype: string | undefined,
): boolean {
  const metadata = event.metadata ?? {};
  return Boolean(
    subtype === "approval_required" ||
    stringValue(metadata.status) === "needs-approval" ||
    stringValue(metadata.phase)?.includes("approval") ||
    metadata.pendingApproval ||
    metadata.pendingApprovalId ||
    /\bapproval required\b/i.test(event.text),
  );
}

function isErrorEvent(
  event: RemoteTranscriptEvent,
  subtype: string | undefined,
): boolean {
  const metadata = event.metadata ?? {};
  return Boolean(
    subtype === "error" ||
    subtype?.endsWith("-error") ||
    metadata.failed ||
    metadata.error ||
    stringValue(metadata.status) === "errored" ||
    (event.type === "status" && /\bfailed\b|\berror\b/i.test(event.text)),
  );
}

function isLifecycleEvent(event: RemoteTranscriptEvent): boolean {
  const metadata = event.metadata ?? {};
  const status = stringValue(metadata.status);
  const phase = stringValue(metadata.phase);
  return Boolean(
    status === "queued" ||
    status === "running" ||
    status === "completed" ||
    phase === "queued" ||
    phase === "starting" ||
    phase === "executing" ||
    phase === "follow-up" ||
    phase === "complete" ||
    LIFECYCLE_MESSAGES.some((pattern) => pattern.test(event.text)),
  );
}

function readPendingApproval(run?: RemoteRun | null): {
  approvalKey?: string;
  command?: string;
  reason?: string;
  tool?: string;
  toolCallId?: string;
} | null {
  if (!run) return null;
  const pending = recordValue(run.metadata?.pendingApproval);
  if (!pending && !run.needsApproval && run.status !== "needs-approval") {
    return null;
  }
  return {
    approvalKey:
      stringValue(pending?.approvalKey) ??
      stringValue(pending?.id) ??
      stringValue(run.metadata?.pendingApprovalId),
    command: stringValue(pending?.command),
    reason: stringValue(pending?.reason) ?? "Review the pending command.",
    tool: stringValue(pending?.tool) ?? "Command",
    toolCallId: stringValue(pending?.toolCallId),
  };
}

function hasTool(
  state: ChatTurnState,
  assistantId: string,
  toolCallId?: string,
): boolean {
  if (!toolCallId) return false;
  return state.messages.some(
    (message) =>
      message.id === assistantId &&
      message.parts.some(
        (part) => part.type === "tool-call" && part.toolCallId === toolCallId,
      ),
  );
}

function resolveToolCallId(
  state: ChatTurnState,
  assistantId: string,
  candidate: string | undefined,
  tool: string | undefined,
): string | undefined {
  if (hasTool(state, assistantId, candidate)) return candidate;
  return findRunningToolId(state, assistantId, tool) ?? candidate;
}

function findRunningToolId(
  state: ChatTurnState,
  assistantId: string,
  tool: string | undefined,
): string | undefined {
  const message = state.messages.find((item) => item.id === assistantId);
  if (!message) return undefined;
  for (let index = message.parts.length - 1; index >= 0; index -= 1) {
    const part = message.parts[index];
    if (
      part.type === "tool-call" &&
      part.status === "running" &&
      (!tool || part.toolName === tool)
    ) {
      return part.toolCallId;
    }
  }
  return undefined;
}

function phaseLabel(phase?: string): string {
  if (phase === "queued") return "Queued";
  return "Working";
}

function isActiveRemoteRun(run?: RemoteRun | null): boolean {
  return Boolean(
    run &&
    (run.status === "queued" ||
      run.status === "running" ||
      run.status === "paused" ||
      run.status === "needs-approval"),
  );
}

function remoteWorkDuration(run?: RemoteRun | null): number | null {
  if (!run) return null;
  const startedAt = Date.parse(run.createdAt);
  const finishedAt = Date.parse(run.updatedAt);
  if (!Number.isFinite(startedAt) || !Number.isFinite(finishedAt)) return null;
  const duration = finishedAt - startedAt;
  return duration > 0 ? duration : null;
}

function compareEvents(
  left: RemoteTranscriptEvent,
  right: RemoteTranscriptEvent,
): number {
  const leftTime = Date.parse(left.createdAt);
  const rightTime = Date.parse(right.createdAt);
  if (
    Number.isFinite(leftTime) &&
    Number.isFinite(rightTime) &&
    leftTime !== rightTime
  ) {
    return leftTime - rightTime;
  }
  return left.id.localeCompare(right.id);
}

function toTimestamp(value: string): number {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : Date.now();
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
