import {
  normalizeActionChatUIConfig,
  type ActionChatUIConfig,
} from "../action-ui.js";
import type { CodeAgentTranscriptEvent } from "../cli/code-agent-runs.js";
import type { AgentMcpAppPayload } from "../mcp-client/app-result.js";

export type { CodeAgentTranscriptEvent } from "../cli/code-agent-runs.js";

export type NormalizedCodeAgentTranscriptItem =
  | NormalizedCodeAgentUserTurn
  | NormalizedCodeAgentAssistantTurn
  | NormalizedCodeAgentToolEvent
  | NormalizedCodeAgentStatusEvent
  | NormalizedCodeAgentThinkingEvent;

export interface NormalizedCodeAgentTranscript {
  items: NormalizedCodeAgentTranscriptItem[];
  rawEvents: CodeAgentTranscriptEvent[];
  hiddenEvents: CodeAgentTranscriptEvent[];
}

export interface NormalizedCodeAgentTranscriptBase {
  id: string;
  createdAt: string;
  updatedAt: string;
  eventIds: string[];
  events: CodeAgentTranscriptEvent[];
  turnIndex: number;
}

export interface NormalizedCodeAgentUserTurn extends NormalizedCodeAgentTranscriptBase {
  type: "user";
  role: "user";
  text: string;
}

export interface NormalizedCodeAgentAssistantTurn extends NormalizedCodeAgentTranscriptBase {
  type: "assistant";
  role: "assistant";
  text: string;
  source: "system" | "runner-stdout";
  suppressedDuplicateEventIds?: string[];
}

export interface NormalizedCodeAgentToolEvent extends NormalizedCodeAgentTranscriptBase {
  type: "tool";
  tool?: string;
  label: string;
  state: "activity" | "running" | "completed";
  input?: unknown;
  result?: unknown;
  mcpApp?: AgentMcpAppPayload;
  chatUI?: ActionChatUIConfig;
  activities: string[];
  startedAt?: string;
  completedAt?: string;
  /**
   * Structured metadata from the tool execution side-channel.  Present on
   * bash/edit/write/read tool events when the executor is new enough to emit
   * it.  Absent on old transcript events — UI must handle both cases.
   */
  structuredMeta?: Record<string, unknown>;
}

export interface NormalizedCodeAgentStatusEvent extends NormalizedCodeAgentTranscriptBase {
  type: "status";
  level: "info" | "warning" | "error" | "approval";
  text: string;
  statusKind: CodeAgentTranscriptEvent["kind"];
  status?: string;
  phase?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Accumulated reasoning/thinking text emitted during a model's extended
 * thinking phase.  Rendered as a collapsed-by-default "Thinking…" cell.
 */
export interface NormalizedCodeAgentThinkingEvent extends NormalizedCodeAgentTranscriptBase {
  type: "thinking";
  text: string;
}

export function normalizeCodeAgentTranscript(
  events: readonly CodeAgentTranscriptEvent[],
): NormalizedCodeAgentTranscript {
  const items: NormalizedCodeAgentTranscriptItem[] = [];
  const hiddenEvents: CodeAgentTranscriptEvent[] = [];
  const eventOrder = new Map(events.map((event, index) => [event.id, index]));
  let turnIndex = -1;

  for (const event of events) {
    const currentTurnIndex = Math.max(turnIndex, 0);
    if (event.kind === "user") {
      turnIndex = turnIndex < 0 ? (items.length === 0 ? 0 : 1) : turnIndex + 1;
      items.push(createUserTurn(event, turnIndex));
      continue;
    }

    const assistantSource = assistantTextSource(event);
    if (assistantSource) {
      const text = assistantTextForEvent(event, assistantSource);
      if (!text) {
        hiddenEvents.push(event);
        continue;
      }
      const previous = items.at(-1);
      if (
        previous?.type === "assistant" &&
        previous.source === assistantSource &&
        previous.turnIndex === currentTurnIndex
      ) {
        appendAssistantChunk(previous, event, text);
      } else {
        items.push(
          createAssistantTurn(event, assistantSource, currentTurnIndex, text),
        );
      }
      continue;
    }

    if (isThinkingEvent(event)) {
      appendThinkingChunk(items, event, currentTurnIndex);
      continue;
    }

    const toolType = toolEventType(event);
    if (toolType) {
      appendToolEvent(items, event, toolType, currentTurnIndex);
      continue;
    }

    if (shouldShowStatusEvent(event)) {
      items.push(createStatusEvent(event, currentTurnIndex));
    } else {
      hiddenEvents.push(event);
    }
  }

  const dedupedItems = suppressDuplicateFinalAssistantText(items, hiddenEvents);
  hiddenEvents.sort(
    (a, b) => (eventOrder.get(a.id) ?? 0) - (eventOrder.get(b.id) ?? 0),
  );

  return {
    items: dedupedItems,
    rawEvents: [...events],
    hiddenEvents,
  };
}

function createUserTurn(
  event: CodeAgentTranscriptEvent,
  turnIndex: number,
): NormalizedCodeAgentUserTurn {
  return {
    type: "user",
    role: "user",
    id: event.id,
    text: event.message,
    createdAt: event.createdAt,
    updatedAt: event.createdAt,
    eventIds: [event.id],
    events: [event],
    turnIndex,
  };
}

function createAssistantTurn(
  event: CodeAgentTranscriptEvent,
  source: NormalizedCodeAgentAssistantTurn["source"],
  turnIndex: number,
  text: string,
): NormalizedCodeAgentAssistantTurn {
  return {
    type: "assistant",
    role: "assistant",
    id: event.id,
    text,
    source,
    createdAt: event.createdAt,
    updatedAt: event.createdAt,
    eventIds: [event.id],
    events: [event],
    turnIndex,
  };
}

function appendAssistantChunk(
  item: NormalizedCodeAgentAssistantTurn,
  event: CodeAgentTranscriptEvent,
  text: string,
): void {
  item.text = shouldAppendAssistantChunkExactly(item, event)
    ? `${item.text}${text}`
    : joinAssistantChunks(item.text, text);
  item.updatedAt = event.createdAt;
  item.eventIds.push(event.id);
  item.events.push(event);
}

function isThinkingEvent(event: CodeAgentTranscriptEvent): boolean {
  return (
    event.kind === "status" &&
    stringMetadata(event.metadata, "type") === "thinking"
  );
}

function appendThinkingChunk(
  items: NormalizedCodeAgentTranscriptItem[],
  event: CodeAgentTranscriptEvent,
  turnIndex: number,
): void {
  const previous = items.at(-1);
  if (previous?.type === "thinking" && previous.turnIndex === turnIndex) {
    // Accumulate consecutive thinking chunks into one cell.
    previous.text = `${previous.text}${event.message}`;
    previous.updatedAt = event.createdAt;
    previous.eventIds.push(event.id);
    previous.events.push(event);
    return;
  }
  const thinkingItem: NormalizedCodeAgentThinkingEvent = {
    type: "thinking",
    id: event.id,
    text: event.message,
    createdAt: event.createdAt,
    updatedAt: event.createdAt,
    eventIds: [event.id],
    events: [event],
    turnIndex,
  };
  items.push(thinkingItem);
}

function createStatusEvent(
  event: CodeAgentTranscriptEvent,
  turnIndex: number,
): NormalizedCodeAgentStatusEvent {
  const metadata = event.metadata;
  return {
    type: "status",
    id: event.id,
    text: event.message,
    level: statusEventLevel(event),
    statusKind: event.kind,
    status: stringMetadata(metadata, "status"),
    phase: stringMetadata(metadata, "phase"),
    metadata,
    createdAt: event.createdAt,
    updatedAt: event.createdAt,
    eventIds: [event.id],
    events: [event],
    turnIndex,
  };
}

function appendToolEvent(
  items: NormalizedCodeAgentTranscriptItem[],
  event: CodeAgentTranscriptEvent,
  toolType: "activity" | "tool_done" | "tool_start",
  turnIndex: number,
): void {
  const tool = stringMetadata(event.metadata, "tool");
  const item = findOpenToolEvent(items, tool, turnIndex);

  if (!item) {
    items.push(createToolEvent(event, toolType, turnIndex));
    return;
  }

  item.updatedAt = event.createdAt;
  item.eventIds.push(event.id);
  item.events.push(event);

  if (toolType === "activity") {
    item.activities.push(event.message);
    if (item.state === "activity") item.label = event.message;
    return;
  }

  if (toolType === "tool_start") {
    const wasActivity = item.state === "activity";
    item.state = "running";
    item.startedAt = item.startedAt ?? event.createdAt;
    if (hasMetadataKey(event.metadata, "input")) {
      item.input = event.metadata?.input;
    }
    if (wasActivity || item.label === item.activities.at(-1)) {
      item.label = event.message;
    }
    const startMeta = structuredMetadata(event.metadata);
    if (startMeta) item.structuredMeta = startMeta;
    return;
  }

  item.state = "completed";
  item.completedAt = event.createdAt;
  if (hasMetadataKey(event.metadata, "result")) {
    item.result = event.metadata?.result;
  }
  const mcpApp = mcpAppMetadata(event.metadata);
  if (mcpApp) item.mcpApp = mcpApp;
  const chatUI = chatUIMetadata(event.metadata);
  if (chatUI) item.chatUI = chatUI;
  const doneMeta = structuredMetadata(event.metadata);
  if (doneMeta) item.structuredMeta = doneMeta;
}

function createToolEvent(
  event: CodeAgentTranscriptEvent,
  toolType: "activity" | "tool_done" | "tool_start",
  turnIndex: number,
): NormalizedCodeAgentToolEvent {
  const metadata = event.metadata;
  const state =
    toolType === "tool_done"
      ? "completed"
      : toolType === "tool_start"
        ? "running"
        : "activity";
  return {
    type: "tool",
    id: event.id,
    tool: stringMetadata(metadata, "tool"),
    label: event.message,
    state,
    input: hasMetadataKey(metadata, "input") ? metadata?.input : undefined,
    result: hasMetadataKey(metadata, "result") ? metadata?.result : undefined,
    mcpApp: mcpAppMetadata(metadata),
    chatUI: chatUIMetadata(metadata),
    activities: toolType === "activity" ? [event.message] : [],
    startedAt: toolType === "tool_start" ? event.createdAt : undefined,
    completedAt: toolType === "tool_done" ? event.createdAt : undefined,
    structuredMeta: structuredMetadata(metadata),
    createdAt: event.createdAt,
    updatedAt: event.createdAt,
    eventIds: [event.id],
    events: [event],
    turnIndex,
  };
}

function findOpenToolEvent(
  items: readonly NormalizedCodeAgentTranscriptItem[],
  tool: string | undefined,
  turnIndex: number,
): NormalizedCodeAgentToolEvent | null {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item.type !== "tool") continue;
    if (item.turnIndex !== turnIndex) continue;
    if (item.state === "completed") continue;
    if (tool && item.tool !== tool) continue;
    if (!tool && item.tool) continue;
    return item;
  }
  return null;
}

function suppressDuplicateFinalAssistantText(
  items: readonly NormalizedCodeAgentTranscriptItem[],
  hiddenEvents: CodeAgentTranscriptEvent[],
): NormalizedCodeAgentTranscriptItem[] {
  const result: NormalizedCodeAgentTranscriptItem[] = [];

  for (const item of items) {
    if (item.type !== "assistant" || item.source !== "system") {
      result.push(item);
      continue;
    }

    const stdoutItems = result.filter(
      (candidate): candidate is NormalizedCodeAgentAssistantTurn =>
        candidate.type === "assistant" &&
        candidate.source === "runner-stdout" &&
        candidate.turnIndex === item.turnIndex,
    );
    if (
      stdoutItems.length === 0 ||
      !isSameAssistantText(
        stdoutItems.map((candidate) => candidate.text).join(" "),
        item.text,
      )
    ) {
      result.push(item);
      continue;
    }

    hiddenEvents.push(...item.events);
    const target =
      stdoutItems.length === 1 ? stdoutItems[0] : stdoutItems.at(-1);
    if (!target) continue;
    if (stdoutItems.length === 1) {
      target.text = item.text;
      target.updatedAt = item.updatedAt;
    }
    target.eventIds.push(...item.eventIds);
    target.events.push(...item.events);
    target.suppressedDuplicateEventIds = [
      ...(target.suppressedDuplicateEventIds ?? []),
      ...item.eventIds,
    ];
  }

  return result;
}

function shouldShowStatusEvent(event: CodeAgentTranscriptEvent): boolean {
  if (event.kind === "artifact" || event.kind === "note") return true;
  if (event.kind !== "status") return false;
  // Thinking events are handled separately by appendThinkingChunk; never
  // render them again as plain status entries.
  if (isThinkingEvent(event)) return false;
  if (isLowSignalLifecycleEvent(event)) return false;
  return true;
}

function isLowSignalLifecycleEvent(event: CodeAgentTranscriptEvent): boolean {
  const metadata = event.metadata;
  const type = stringMetadata(metadata, "type");
  if (type === "mcp-tools-connected") return true;
  if (statusEventLevel(event) !== "info") return false;

  const status = stringMetadata(metadata, "status");
  const phase = stringMetadata(metadata, "phase");
  if (status === "queued" || status === "running" || status === "completed") {
    return true;
  }
  if (
    phase === "queued" ||
    phase === "starting" ||
    phase === "executing" ||
    phase === "follow-up" ||
    phase === "complete"
  ) {
    return true;
  }

  return LOW_SIGNAL_STATUS_MESSAGES.some((pattern) =>
    pattern.test(event.message),
  );
}

const LOW_SIGNAL_STATUS_MESSAGES = [
  /^Agent-Native Code run started\.?$/i,
  /^Agent-Native Code run completed\.?$/i,
  /^Agent-Native Code process exited\.?$/i,
  /^Starting local Agent-Native Code execution\.?$/i,
  /^Remote Agent-Native Code run queued\.?$/i,
  /^Connected \d+ MCP tools? for this run\.?$/i,
];

function statusEventLevel(
  event: CodeAgentTranscriptEvent,
): NormalizedCodeAgentStatusEvent["level"] {
  const metadata = event.metadata;
  const status = stringMetadata(metadata, "status");
  const phase = stringMetadata(metadata, "phase");
  const source = stringMetadata(metadata, "source");
  const type = stringMetadata(metadata, "type");

  if (
    status === "needs-approval" ||
    Boolean(metadata?.pendingApproval) ||
    Boolean(metadata?.pendingApprovalId) ||
    Boolean(metadata?.approvalId) ||
    phase?.includes("approval") ||
    /\bapproval\b/i.test(event.message)
  ) {
    return "approval";
  }

  if (
    event.kind === "status" &&
    (status === "errored" ||
      type === "error" ||
      type?.endsWith("-error") ||
      Boolean(metadata?.failed) ||
      typeof metadata?.errorCode === "string" ||
      source === "runner-stderr")
  ) {
    return "error";
  }

  if (
    status === "paused" ||
    phase === "missing-credentials" ||
    phase === "stopped" ||
    /\b(missing|stopped|unavailable|denied)\b/i.test(event.message)
  ) {
    return "warning";
  }

  return "info";
}

function assistantTextSource(
  event: CodeAgentTranscriptEvent,
): NormalizedCodeAgentAssistantTurn["source"] | null {
  const source = stringMetadata(event.metadata, "source");
  const type = stringMetadata(event.metadata, "type");
  if (type === "assistant_delta") {
    return "runner-stdout";
  }
  if (event.kind === "status" && source === "runner-stdout") {
    return "runner-stdout";
  }
  if (event.kind === "system" || event.metadata?.role === "assistant") {
    return "system";
  }
  return null;
}

function shouldAppendAssistantChunkExactly(
  item: NormalizedCodeAgentAssistantTurn,
  event: CodeAgentTranscriptEvent,
): boolean {
  return (
    item.source === "runner-stdout" &&
    (isAssistantDeltaEvent(event) || item.events.some(isAssistantDeltaEvent))
  );
}

function isAssistantDeltaEvent(event: CodeAgentTranscriptEvent): boolean {
  return stringMetadata(event.metadata, "type") === "assistant_delta";
}

function assistantTextForEvent(
  event: CodeAgentTranscriptEvent,
  source: NormalizedCodeAgentAssistantTurn["source"],
): string {
  if (source === "runner-stdout") {
    return stripRunnerDiagnostics(event.message, {
      trim: !isAssistantDeltaEvent(event),
    });
  }
  return event.message;
}

function stripRunnerDiagnostics(
  value: string,
  options: { trim?: boolean } = {},
): string {
  const stripped = value
    .replace(RUNNER_DIAGNOSTIC_LINE_PATTERNS.engineDetect, "")
    .replace(RUNNER_DIAGNOSTIC_LINE_PATTERNS.builderEngine, "")
    .replace(RUNNER_DIAGNOSTIC_LINE_PATTERNS.sessionStartedBanner, "");
  return options.trim === false ? stripped : stripped.trim();
}

const RUNNER_DIAGNOSTIC_LINE_PATTERNS = {
  engineDetect: /^\[engine-detect\][^\r\n]*(?:\r?\n|$)/gm,
  builderEngine: /^\[builder-engine\]\s*[←→][^\r\n]*(?:\r?\n|$)/gm,
  // Strip the "Agent-Native Code session started." banner block that the CLI
  // prints to stdout at the start of every run. It is informational for
  // terminal users but clutters the chat transcript.
  sessionStartedBanner:
    /\n?Agent-Native Code session started\.[\s\S]*?Streaming output below\. The transcript is saved with this run\.\n?/,
};

function toolEventType(
  event: CodeAgentTranscriptEvent,
): "activity" | "tool_done" | "tool_start" | null {
  if (event.kind !== "status") return null;
  const type = stringMetadata(event.metadata, "type");
  if (type === "activity" || type === "tool_done" || type === "tool_start") {
    return type;
  }
  return null;
}

function joinAssistantChunks(previous: string, next: string): string {
  if (!previous) return next;
  if (!next) return previous;
  if (/\s$/.test(previous) || /^\s/.test(next)) return `${previous}${next}`;
  if (/^[.,!?;:)\]}'"`]/.test(next)) return `${previous}${next}`;
  if (/[([{'"`]$/.test(previous)) return `${previous}${next}`;
  return `${previous} ${next}`;
}

function canonicalText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isSameAssistantText(left: string, right: string): boolean {
  if (canonicalText(left) === canonicalText(right)) return true;
  return compactText(left) === compactText(right);
}

function compactText(value: string): string {
  return canonicalText(value).replace(/\s+/g, "");
}

function stringMetadata(
  metadata: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" ? value : undefined;
}

function hasMetadataKey(
  metadata: Record<string, unknown> | undefined,
  key: string,
): boolean {
  return (
    Boolean(metadata) && Object.prototype.hasOwnProperty.call(metadata, key)
  );
}

function structuredMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  const value = metadata?.structuredMeta;
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  return value as Record<string, unknown>;
}

function mcpAppMetadata(
  metadata: Record<string, unknown> | undefined,
): AgentMcpAppPayload | undefined {
  const value = metadata?.mcpApp;
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<AgentMcpAppPayload>;
  if (
    typeof candidate.serverId !== "string" ||
    typeof candidate.originalToolName !== "string" ||
    typeof candidate.resourceUri !== "string" ||
    !candidate.resourceUri.startsWith("ui://")
  ) {
    return undefined;
  }
  return candidate as AgentMcpAppPayload;
}

function chatUIMetadata(
  metadata: Record<string, unknown> | undefined,
): ActionChatUIConfig | undefined {
  return normalizeActionChatUIConfig(metadata?.chatUI);
}
