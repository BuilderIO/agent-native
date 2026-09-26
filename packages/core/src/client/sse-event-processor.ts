import type { AgentSuggestion } from "@agent-native/agentkit/protocol";
import type { ChatModelRunResult } from "@assistant-ui/react";

import type { A2AAgentActivitySnapshot } from "../a2a/activity.js";
import type { ActionChatUIConfig } from "../action-ui.js";
import {
  LLM_MISSING_CREDENTIALS_ERROR_CODE,
  LLM_MISSING_CREDENTIALS_MESSAGE,
} from "../agent/engine/credential-errors.js";
import {
  BUILDER_GATEWAY_INTERNAL_ERROR_CODE,
  PROVIDER_TRANSIENT_REJECTION_ERROR_CODE,
} from "../agent/engine/error-detail.js";
import type { AgentChatRichEventEnvelope } from "../agent/types.js";
import type { ArtifactReceipt } from "../artifacts/detect.js";
import type { AgentMcpAppPayload } from "../mcp-client/app-result.js";
import { emitChatFirstOpenApp } from "./chat-first.js";
import { formatChatErrorText, normalizeChatError } from "./error-format.js";
import {
  humanizeToolLabelText,
  humanizeToolName,
  isToolCallActive,
  runningToolLabel,
} from "./tool-display.js";

export type ContentPart =
  | { type: "text"; text: string }
  | {
      type: "reasoning";
      text: string;
    }
  | {
      type: "tool-call";
      toolCallId: string;
      toolName: string;
      argsText: string;
      args: Record<string, string>;
      result?: string;
      isError?: boolean;
      outcome?: "unknown";
      completedSideEffect?: boolean;
      artifacts?: ArtifactReceipt[];
      mcpApp?: AgentMcpAppPayload;
      chatUI?: ActionChatUIConfig;
      activity?: boolean;
      repeatCount?: number;
      approval?: {
        approvalKey: string;
        dismissed?: boolean;
        askId?: string;
        allowPersistentApproval?: false;
      };
      structuredMeta?: Record<string, unknown>;
    };

export interface SSEEvent {
  type: string;
  text?: string;
  suggestions?: AgentSuggestion[];
  event?: AgentChatRichEventEnvelope;
  tool?: string;
  id?: string;
  eventId?: string;
  label?: string;
  progressBytes?: number;
  input?: Record<string, string>;
  result?: string;
  isError?: boolean;
  completedSideEffect?: boolean;
  artifacts?: ArtifactReceipt[];
  mcpApp?: AgentMcpAppPayload;
  chatUI?: ActionChatUIConfig;
  approvalKey?: string;
  toolCallId?: string;
  askId?: string;
  allowPersistentApproval?: false;
  requestId?: string;
  provider?: string;
  connectionReason?: "connect" | "grant" | "reauthorize" | "admin_required";
  appId?: string;
  error?: string;
  seq?: number;
  agent?: string;
  status?: string;
  state?: string;
  elapsedSeconds?: number;
  detail?: string;
  agentCallId?: string;
  durationMs?: number;
  terminalCode?: string;
  snapshot?: A2AAgentActivitySnapshot;
  reason?: string;
  taskId?: string;
  threadId?: string;
  description?: string;
  preview?: string;
  currentStep?: string;
  summary?: string;
  errorCode?: string;
  upgradeUrl?: string;
  details?: string;
  recoverable?: boolean;
  providerRetryable?: boolean;
  maxIterations?: number;
}

export type AgentAutoContinueReason =
  | "run_timeout"
  | "loop_limit"
  | "no_progress"
  | "stream_ended"
  | "stale_run";

export type AgentActivityTrailEntry = { label: string; tool?: string };

export interface AgentCallProgress {
  state: string;
  elapsedSeconds: number;
  detail?: string;
}

export interface AgentAutoContinueErrorInfo {
  message: string;
  details?: string;
  errorCode?: string;
  recoverable?: boolean;
  upgradeUrl?: string;
}

export const INTERRUPTED_TOOL_RESULT =
  "Interrupted before this tool returned a result.";
const INTERRUPTED_ACTIVITY_RESULT = "Stopped before this action started.";

const SSE_RENDER_UPDATES_PER_EVENT_LOOP_TURN = 1;

function waitForNextEventLoopTurn(): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

export function settleInterruptedToolCalls(
  content: ContentPart[],
  result = INTERRUPTED_TOOL_RESULT,
  options?: {
    includeActivity?: boolean;
    activityResult?: string;
    userStopped?: boolean;
  },
): boolean {
  let changed = false;
  for (const part of content) {
    const clearsSyntheticInterruption =
      options?.userStopped === true &&
      part.type === "tool-call" &&
      part.outcome === "unknown" &&
      (part.result === INTERRUPTED_TOOL_RESULT ||
        part.result === INTERRUPTED_ACTIVITY_RESULT);
    if (
      part.type === "tool-call" &&
      (part.result === undefined || clearsSyntheticInterruption) &&
      (part.activity !== true || options?.includeActivity === true)
    ) {
      if (options?.userStopped) {
        part.result = "";
        delete part.outcome;
      } else {
        part.result =
          part.activity === true
            ? (options?.activityResult ?? INTERRUPTED_ACTIVITY_RESULT)
            : result;
        part.outcome = "unknown";
      }
      changed = true;
    }
  }
  return changed;
}

export class AgentAutoContinueSignal extends Error {
  readonly reason: AgentAutoContinueReason;
  readonly maxIterations?: number;
  readonly activityTrail: AgentActivityTrailEntry[];
  readonly errorInfo?: AgentAutoContinueErrorInfo;
  readonly clientWatchdog: boolean;

  constructor(options: {
    reason: AgentAutoContinueReason;
    maxIterations?: number;
    activityTrail?: AgentActivityTrailEntry[];
    errorInfo?: AgentAutoContinueErrorInfo;
    clientWatchdog?: boolean;
  }) {
    super(`Agent run needs automatic continuation: ${options.reason}`);
    this.name = "AgentAutoContinueSignal";
    this.reason = options.reason;
    this.maxIterations = options.maxIterations;
    this.activityTrail = options.activityTrail ?? [];
    this.errorInfo = options.errorInfo;
    this.clientWatchdog = options.clientWatchdog === true;
  }
}

export const SSE_NO_PROGRESS_TIMEOUT_MS = 180_000;
export const SSE_ACTION_PREPARATION_STALL_TIMEOUT_MS = 90_000;
export const SSE_IN_FLIGHT_WORK_TIMEOUT_MS = 15 * 60_000;

export function sseInFlightWorkDelta(ev: SSEEvent): number {
  if (ev.type === "tool_start") return 1;
  if (ev.type === "tool_done") return -1;
  if (ev.type === "agent_call") {
    if (ev.status === "start") return 1;
    if (
      ev.status === "done" ||
      ev.status === "pending" ||
      ev.status === "error"
    )
      return -1;
  }
  return 0;
}
export const SSE_DURABLE_NO_PROGRESS_TIMEOUT_MS = 13 * 60_000;
export const SSE_DURABLE_ACTION_PREPARATION_STALL_TIMEOUT_MS = 13 * 60_000;

function sseTimeoutOverrideMs(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

export function sseNoProgressTimeoutMs(options?: SSEStreamOptions): number {
  return (
    sseTimeoutOverrideMs(options?.noProgressTimeoutMs) ??
    (options?.durableBackgroundRun === true
      ? SSE_DURABLE_NO_PROGRESS_TIMEOUT_MS
      : SSE_NO_PROGRESS_TIMEOUT_MS)
  );
}

function sseActionPreparationStallTimeoutMs(
  options?: SSEStreamOptions,
): number {
  return (
    sseTimeoutOverrideMs(options?.actionPreparationStallTimeoutMs) ??
    (options?.durableBackgroundRun === true
      ? SSE_DURABLE_ACTION_PREPARATION_STALL_TIMEOUT_MS
      : SSE_ACTION_PREPARATION_STALL_TIMEOUT_MS)
  );
}

export interface SSEStreamOptions {
  durableBackgroundRun?: boolean;
  noProgressTimeoutMs?: number;
  actionPreparationStallTimeoutMs?: number;
  markTerminalResults?: boolean;
  preparingActionState?: PreparingActionState;
  runId?: string;
  turnId?: string;
  seenEventSeqs?: Set<number>;
  seenEventIds?: Set<string>;
}

export function admitSSEEvent(
  event: SSEEvent,
  seenEventSeqs?: Set<number>,
  seenEventIds?: Set<string>,
): boolean {
  const alreadySeenById = Boolean(
    event.eventId && seenEventIds?.has(event.eventId),
  );
  const alreadySeenBySeq =
    event.seq !== undefined && seenEventSeqs?.has(event.seq);
  if (alreadySeenById || alreadySeenBySeq) return false;
  if (event.eventId && seenEventIds) seenEventIds.add(event.eventId);
  if (event.seq !== undefined && seenEventSeqs) seenEventSeqs.add(event.seq);
  return true;
}

type ActivityTrailEntry = AgentActivityTrailEntry;

type PreparingActionEntry = {
  tool: string;
  startedAt?: number;
  lastProgressBytes?: number;
  lastProgressAt?: number;
};

export type PreparingActionState = {
  entries?: Map<string, PreparingActionEntry>;
  toolEntries?: Map<string, PreparingActionEntry>;
};

function activityProgressBytes(ev: SSEEvent): number | undefined {
  return typeof ev.progressBytes === "number" &&
    Number.isFinite(ev.progressBytes) &&
    ev.progressBytes >= 0
    ? Math.floor(ev.progressBytes)
    : undefined;
}

function isPreparingActionActivity(ev: SSEEvent): boolean {
  if (ev.type !== "activity") return false;
  const label = (ev.label ?? "").trim().toLowerCase();
  return label.startsWith("preparing ") && label.includes(" action");
}

function isMeaningfulProgressEvent(
  ev: SSEEvent,
  actionPreparationProgress?: boolean,
  options?: SSEStreamOptions,
): boolean {
  if (ev.type === "stream_keepalive") {
    return options?.durableBackgroundRun === true;
  }
  if (ev.type === "activity" && isPreparingActionActivity(ev)) {
    if (options?.durableBackgroundRun === true) return true;
    return actionPreparationProgress === true;
  }
  return true;
}

function isDurableProgressEvent(
  ev: SSEEvent,
  actionPreparationProgress?: boolean,
): boolean {
  if (ev.type === "stream_keepalive" || ev.type === "clear") return false;
  if (ev.type === "activity" && isPreparingActionActivity(ev)) {
    return actionPreparationProgress === true;
  }
  return true;
}

function baseActivityLabel(ev: SSEEvent, tool?: string): string {
  return humanizeToolLabelText(ev.label ?? "Working", tool);
}

function preparationActivityLabel(
  tool: string | undefined,
  progressBytes: number | undefined,
): string {
  const action = humanizeToolName(tool);
  if (progressBytes === undefined) {
    return `Starting ${action}...`;
  }
  if (progressBytes <= 0) {
    return `Preparing ${action}...`;
  }
  return `Writing ${action}...`;
}

function visibleActivityLabel(ev: SSEEvent, tool?: string): string {
  const progressBytes = activityProgressBytes(ev);
  if (isPreparingActionActivity(ev)) {
    return preparationActivityLabel(tool, progressBytes);
  }
  return baseActivityLabel(ev, tool);
}

function findPendingToolCallIndex(
  content: ContentPart[],
  toolName: string,
  toolCallId?: string,
): number {
  if (toolCallId) {
    const exactIndex = findPendingToolCallIndexById(content, toolCallId);
    if (exactIndex >= 0) return exactIndex;
    // Fall through to name-matching: the start event may have arrived before
    // the server started emitting ids (e.g. older server build), so the
    // stored toolCallId is the locally-generated "tc_N" value rather than the
    // server-assigned one. In that case match by name as a fallback.
  }
  for (let i = content.length - 1; i >= 0; i--) {
    const part = content[i];
    if (
      part.type === "tool-call" &&
      part.toolName === toolName &&
      part.result === undefined
    ) {
      return i;
    }
  }
  return -1;
}

function findPendingToolCallIndexById(
  content: ContentPart[],
  toolCallId: string,
): number {
  for (let i = content.length - 1; i >= 0; i--) {
    const part = content[i];
    if (
      part.type === "tool-call" &&
      part.toolCallId === toolCallId &&
      part.result === undefined
    ) {
      return i;
    }
  }
  return -1;
}

function findApprovalToolCallIndex(
  content: ContentPart[],
  toolName: string,
  toolCallId?: string,
): number {
  if (!toolCallId) {
    return findPendingToolCallIndex(content, toolName);
  }

  const exactIndex = findPendingToolCallIndexById(content, toolCallId);
  if (exactIndex >= 0) return exactIndex;

  const readerLocalCandidates: number[] = [];
  for (let i = 0; i < content.length; i += 1) {
    const part = content[i];
    if (
      part.type === "tool-call" &&
      part.toolName === toolName &&
      part.result === undefined &&
      /^tc_\d+$/.test(part.toolCallId)
    ) {
      readerLocalCandidates.push(i);
    }
  }
  return readerLocalCandidates.length === 1 ? readerLocalCandidates[0]! : -1;
}

function findOldestPendingActivityToolCallIndex(
  content: ContentPart[],
  toolName: string,
): number {
  for (let i = 0; i < content.length; i += 1) {
    const part = content[i];
    if (
      part.type === "tool-call" &&
      part.toolName === toolName &&
      part.activity === true &&
      part.result === undefined
    ) {
      return i;
    }
  }
  return -1;
}

function findPendingActivityToolCallIndex(
  content: ContentPart[],
  toolName: string,
  toolCallId?: string,
): number {
  if (!toolCallId) {
    return findPendingToolCallIndex(content, toolName);
  }

  const exactIndex = findPendingToolCallIndexById(content, toolCallId);
  if (exactIndex >= 0) return exactIndex;

  const readerLocalCandidates: number[] = [];
  for (let i = 0; i < content.length; i += 1) {
    const part = content[i];
    if (
      part.type === "tool-call" &&
      part.toolName === toolName &&
      part.activity === true &&
      part.result === undefined &&
      /^tc_\d+$/.test(part.toolCallId)
    ) {
      readerLocalCandidates.push(i);
    }
  }
  return readerLocalCandidates.length === 1 ? readerLocalCandidates[0] : -1;
}

function findCompletedToolCallIndex(
  content: ContentPart[],
  toolCallId?: string,
): number {
  if (!toolCallId) return -1;
  for (let i = content.length - 1; i >= 0; i--) {
    const part = content[i];
    if (
      part.type === "tool-call" &&
      part.toolCallId === toolCallId &&
      part.result !== undefined
    ) {
      return i;
    }
  }
  return -1;
}

function appendActivityTrail(
  trail: ActivityTrailEntry[],
  next: ActivityTrailEntry,
) {
  const label = next.label.trim();
  if (!label) return;
  const tool = next.tool?.trim();
  const last = trail[trail.length - 1];
  if (last?.label === label && last.tool === tool) return;
  trail.push({ label, ...(tool ? { tool } : {}) });
  if (trail.length > 8) {
    trail.splice(0, trail.length - 8);
  }
}

function refreshPreparingToolEntry(state: PreparingActionState, tool: string) {
  const remainingEntries = [...(state.entries?.values() ?? [])].filter(
    (entry) => entry.tool === tool,
  );
  if (remainingEntries.length === 0) {
    state.toolEntries?.delete(tool);
    return;
  }
  const deadlineBasis = (entry: PreparingActionEntry) =>
    entry.lastProgressAt ?? entry.startedAt ?? Number.POSITIVE_INFINITY;
  const oldestEntry = remainingEntries.reduce((oldest, entry) =>
    deadlineBasis(entry) < deadlineBasis(oldest) ? entry : oldest,
  );
  const lastProgressBytes = remainingEntries.reduce<number | undefined>(
    (max, entry) =>
      entry.lastProgressBytes === undefined
        ? max
        : Math.max(max ?? 0, entry.lastProgressBytes),
    undefined,
  );
  const toolEntries =
    state.toolEntries ?? new Map<string, PreparingActionEntry>();
  state.toolEntries = toolEntries;
  toolEntries.set(tool, {
    tool,
    startedAt: oldestEntry.startedAt,
    lastProgressAt: oldestEntry.lastProgressAt,
    lastProgressBytes,
  });
}

function updatePreparingActionState(
  state: PreparingActionState,
  ev: SSEEvent,
  now: number,
): boolean | undefined {
  if (ev.type === "activity" && isPreparingActionActivity(ev)) {
    const tool = ev.tool?.trim() || undefined;
    if (!tool) return false;
    const id = ev.id?.trim();
    const key = id || tool;
    const entries = state.entries ?? new Map<string, PreparingActionEntry>();
    state.entries = entries;
    let entry = entries.get(key);
    if (!entry) {
      entry = {
        tool,
        startedAt: now,
        lastProgressAt: undefined,
        lastProgressBytes: undefined,
      };
      entries.set(key, entry);
    }
    const toolEntries =
      state.toolEntries ?? new Map<string, PreparingActionEntry>();
    state.toolEntries = toolEntries;
    let toolEntry = toolEntries.get(tool);
    if (!toolEntry) {
      toolEntry = {
        tool,
        startedAt: now,
        lastProgressAt: undefined,
        lastProgressBytes: undefined,
      };
      toolEntries.set(tool, toolEntry);
    }
    const progressBytes = activityProgressBytes(ev);
    const previousBytes = entry.lastProgressBytes ?? 0;
    let madeProgress = false;
    if (progressBytes !== undefined) {
      entry.lastProgressBytes = Math.max(previousBytes, progressBytes);
      toolEntry.lastProgressBytes = Math.max(
        toolEntry.lastProgressBytes ?? 0,
        progressBytes,
      );
      madeProgress = id ? progressBytes > previousBytes : progressBytes > 0;
    }
    if (madeProgress) {
      entry.lastProgressAt = now;
      toolEntry.lastProgressAt = now;
      return true;
    }
    return false;
  }

  if (
    ev.type === "clear" ||
    ev.type === "text" ||
    ev.type === "tool_start" ||
    ev.type === "tool_done" ||
    ev.type === "done" ||
    ev.type === "error" ||
    ev.type === "missing_api_key"
  ) {
    if (ev.type === "tool_start" || ev.type === "tool_done") {
      const tool = ev.tool?.trim();
      const id = ev.id?.trim();
      for (const [key, entry] of state.entries ?? []) {
        if ((id && key === id) || (!id && tool && entry.tool === tool)) {
          state.entries?.delete(key);
        }
      }
      if (tool) {
        refreshPreparingToolEntry(state, tool);
      }
    } else {
      state.entries?.clear();
      state.toolEntries?.clear();
    }
  }
  return undefined;
}

function hasStalledPreparingAction(
  state: PreparingActionState,
  now: number,
  stallTimeoutMs: number,
) {
  for (const entry of [
    ...(state.toolEntries?.values() ?? []),
    ...(state.entries?.values() ?? []),
  ]) {
    if (
      entry.startedAt !== undefined &&
      now - (entry.lastProgressAt ?? entry.startedAt) >= stallTimeoutMs
    ) {
      return true;
    }
  }
  return false;
}

async function readChunkWithProgressTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  lastMeaningfulEventAt: number,
  noProgressTimeoutMs: number,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  const elapsed = Date.now() - lastMeaningfulEventAt;
  const timeoutMs = Math.max(0, noProgressTimeoutMs - elapsed);
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const readPromise = reader.read();
  void readPromise.catch(() => {});

  const timeoutPromise = new Promise<"timeout">((resolve) => {
    timeoutId = setTimeout(() => resolve("timeout"), timeoutMs);
  });
  const result = await Promise.race([readPromise, timeoutPromise]);
  if (timeoutId) {
    clearTimeout(timeoutId);
  }
  if (result === "timeout") {
    await reader.cancel("no_progress").catch(() => {});
    throw new AgentAutoContinueSignal({
      reason: "no_progress",
      clientWatchdog: true,
    });
  }
  return result;
}

function isAutoRecoverableError(ev: SSEEvent, errMsg: string): boolean {
  const code = String(ev.errorCode ?? "").toLowerCase();
  const msg = errMsg.toLowerCase();

  if (ev.recoverable === false) return false;

  if (
    msg.includes(
      "the provider rejected the credential used for this request",
    ) ||
    msg.includes("stopped before finishing") ||
    msg.includes("stopped before it finished")
  ) {
    return false;
  }

  if (
    code === "context_length_exceeded" ||
    code === "input_too_long" ||
    code.startsWith("credits-limit") ||
    code === "billing_error" ||
    code === "unauthorized" ||
    code === "authentication_error" ||
    code === "permission_error" ||
    code === "builder_auth_error" ||
    code === "builder_model_unauthorized" ||
    code === "http_401" ||
    code === "http_403" ||
    code === "rate_limit_exceeded" ||
    code === "gateway_not_enabled" ||
    code === "missing_api_key" ||
    code === "missing_credentials" ||
    code === "invalid_request_error" ||
    code === "request_too_large" ||
    code === "not_found_error" ||
    code === "model_not_found" ||
    code === "http_429" ||
    code === "http_529" ||
    code === "rate_limited" ||
    code === "too_many_concurrent_requests" ||
    code === "provider_rate_limited" ||
    code === PROVIDER_TRANSIENT_REJECTION_ERROR_CODE ||
    code === "builder_gateway_error" ||
    code === "run_budget_exhausted" ||
    code.startsWith("aborted_") ||
    code === "run_record_missing" ||
    code === "unknown_run_status" ||
    code === "run_terminal_lookup_failed"
  ) {
    return false;
  }

  if (
    code === "builder_gateway_network_error" ||
    code === "builder_gateway_timeout" ||
    code === "provider_network_error" ||
    code === "stale_run" ||
    code === "timeout" ||
    code === "timeout_error" ||
    code === "http_408" ||
    code === "http_500" ||
    code === BUILDER_GATEWAY_INTERNAL_ERROR_CODE ||
    code === "http_502" ||
    code === "http_503" ||
    code === "http_504" ||
    code === "overloaded_error" ||
    code === "builder_gateway_stream_ended"
  ) {
    return true;
  }

  if (ev.recoverable === true) return true;

  if (msg.includes("daily gateway request cap")) return false;

  if (ev.providerRetryable === true) return true;

  return (
    msg.includes("overloaded") ||
    msg.includes("rate_limit") ||
    msg.includes("too many requests") ||
    msg.includes("timeout") ||
    msg.includes("gateway timeout") ||
    msg.includes("inactivity timeout") ||
    msg.includes("socket hang up") ||
    msg.includes("connection reset") ||
    msg.includes("connection") ||
    msg.includes("network") ||
    msg.includes("stream closed") ||
    msg.includes("stream ended") ||
    msg.includes("temporarily unavailable") ||
    msg.includes("502") ||
    msg.includes("503") ||
    msg.includes("504") ||
    msg.includes("529")
  );
}

function isMissingCredentialText(message: string, errorCode?: string): boolean {
  const code = String(errorCode ?? "").toLowerCase();
  const msg = message.toLowerCase();
  return (
    code === "missing_api_key" ||
    code === "missing_credentials" ||
    msg.includes("apikey") ||
    msg.includes("authtoken") ||
    msg.includes("anthropic_api_key") ||
    msg.includes("missing_api_key") ||
    msg.includes("missing api key") ||
    msg.includes("missing credentials") ||
    msg.includes("no llm provider") ||
    msg.includes("llm provider is connected")
  );
}

function isMissingProviderErrorText(
  message: string,
  errorCode?: string,
): boolean {
  const code = String(errorCode ?? "").toLowerCase();
  return (
    code === "missing_api_key" ||
    code === "missing_credentials" ||
    /no llm provider(?: key)? (?:is connected|was found)/i.test(message)
  );
}

function dispatchActivityClear(tabId: string | undefined) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("agent-chat:activity-clear", {
      detail: { tabId },
    }),
  );
}

function dispatchStreamProgress(tabId: string | undefined) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("agent-chat:stream-progress", {
      detail: { tabId },
    }),
  );
}

function dispatchMissingApiKey(tabId: string | undefined) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("agent-chat:missing-api-key", {
      detail: { tabId },
    }),
  );
}

function pendingToolNames(content: ContentPart[]): {
  activity: string[];
  running: string[];
} {
  const activity = new Set<string>();
  const running = new Set<string>();
  for (const part of content) {
    if (part.type === "tool-call" && part.result === undefined) {
      if (part.activity === true) {
        activity.add(part.toolName);
      } else {
        running.add(part.toolName);
      }
    }
  }
  return { activity: [...activity], running: [...running] };
}

function contentSnapshot(content: ContentPart[]): ContentPart[] {
  return content.map((part) => {
    if (part.type === "text" || part.type === "reasoning") return { ...part };
    return {
      ...part,
      args: { ...part.args },
      ...(part.mcpApp ? { mcpApp: { ...part.mcpApp } } : {}),
      ...(part.chatUI ? { chatUI: { ...part.chatUI } } : {}),
      ...(part.artifacts
        ? { artifacts: part.artifacts.map((artifact) => ({ ...artifact })) }
        : {}),
      ...(part.approval ? { approval: { ...part.approval } } : {}),
      ...(part.structuredMeta
        ? { structuredMeta: { ...part.structuredMeta } }
        : {}),
    };
  });
}

function mergeArtifactReceipts(
  current: ArtifactReceipt[] | undefined,
  incoming: ArtifactReceipt[],
): ArtifactReceipt[] {
  const receipts = new Map<string, ArtifactReceipt>();
  for (const artifact of current ?? []) {
    receipts.set(`${artifact.kind}:${artifact.id}`, artifact);
  }
  for (const artifact of incoming) {
    receipts.set(`${artifact.kind}:${artifact.id}`, artifact);
  }
  return [...receipts.values()];
}

function repeatSignatureValue(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value ?? "");
  }
}

function completedToolRepeatSignature(
  part: Extract<ContentPart, { type: "tool-call" }>,
): string | null {
  if (
    part.result === undefined ||
    part.activity === true ||
    part.approval ||
    part.mcpApp ||
    part.chatUI ||
    part.structuredMeta
  ) {
    return null;
  }
  return [
    part.toolName,
    part.argsText,
    repeatSignatureValue(part.args),
    part.result,
    part.isError === true ? "error" : "",
    part.completedSideEffect === true ? "side-effect" : "",
  ].join("\u0000");
}

const JOURNAL_RECOVERY_RESULT_PREFIXES = [
  "(Already completed in an earlier interrupted attempt",
  "(Recovered from prior interrupted chunk",
] as const;

function isJournalRecoveryResult(result: unknown): boolean {
  return (
    typeof result === "string" &&
    JOURNAL_RECOVERY_RESULT_PREFIXES.some((prefix) => result.startsWith(prefix))
  );
}

function coalesceJournalRecoveredTool(
  content: ContentPart[],
  completedIndex: number,
): boolean {
  const current = content[completedIndex];
  if (!current || current.type !== "tool-call") return false;
  if (!isJournalRecoveryResult(current.result)) return false;
  const matchesCurrentCall = (
    part: ContentPart,
  ): part is Extract<ContentPart, { type: "tool-call" }> =>
    part.type === "tool-call" &&
    part.activity !== true &&
    part.toolName === current.toolName &&
    part.argsText === current.argsText;

  for (let i = completedIndex - 1; i >= 0; i--) {
    const prior = content[i];
    if (!matchesCurrentCall(prior)) continue;
    if (prior.result === undefined) {
      prior.result = current.result;
      if (current.isError !== undefined) prior.isError = current.isError;
      if (current.completedSideEffect !== undefined) {
        prior.completedSideEffect = current.completedSideEffect;
      }
      if (current.mcpApp) prior.mcpApp = current.mcpApp;
      if (current.chatUI) prior.chatUI = current.chatUI;
      if (current.approval) prior.approval = { ...current.approval };
    }
    if (current.artifacts !== undefined) {
      prior.artifacts = mergeArtifactReceipts(
        prior.artifacts,
        current.artifacts,
      );
    }
    content.splice(completedIndex, 1);
    return true;
  }

  for (let i = content.length - 1; i > completedIndex; i--) {
    const later = content[i];
    if (
      later.type === "tool-call" &&
      matchesCurrentCall(later) &&
      later.result === undefined
    ) {
      content.splice(i, 1);
    }
  }
  return false;
}

function coalesceCompletedToolRepeat(
  content: ContentPart[],
  completedIndex: number,
): void {
  const current = content[completedIndex];
  const previous = content[completedIndex - 1];
  if (
    !current ||
    !previous ||
    current.type !== "tool-call" ||
    previous.type !== "tool-call"
  ) {
    return;
  }

  const currentSignature = completedToolRepeatSignature(current);
  if (
    !currentSignature ||
    currentSignature !== completedToolRepeatSignature(previous)
  ) {
    return;
  }

  previous.repeatCount =
    (previous.repeatCount ?? 1) + (current.repeatCount ?? 1);
  if (current.artifacts !== undefined) {
    previous.artifacts = mergeArtifactReceipts(
      previous.artifacts,
      current.artifacts,
    );
  }
  content.splice(completedIndex, 1);
}

function formatToolNames(tools: string[]): string {
  const names = tools.map(humanizeToolName);
  if (names.length === 0) return "the promised action";
  if (names.length === 1) return `the ${names[0]} action`;
  return `these actions: ${names.join(", ")}`;
}

function interruptedToolMessage(pending: {
  activity: string[];
  running: string[];
}): string {
  if (pending.running.length > 0) {
    return `The agent stopped before ${formatToolNames(pending.running)} returned a result. The requested changes may not have been made.`;
  }
  const actionLabel = formatToolNames(pending.activity);
  return `The agent stopped before starting ${actionLabel}. No tool result was returned, so the requested changes were not made.`;
}

function lastAssistantTextIndex(content: ContentPart[]): number {
  for (let i = content.length - 1; i >= 0; i--) {
    const part = content[i];
    if (part.type === "text" && part.text.trim().length > 0) return i;
  }
  return -1;
}

function completedToolNamesAfterLastAssistantText(
  content: ContentPart[],
): string[] {
  const lastTextIndex = lastAssistantTextIndex(content);
  const names = new Set<string>();
  for (let i = lastTextIndex + 1; i < content.length; i++) {
    const part = content[i];
    if (
      part.type === "tool-call" &&
      part.activity !== true &&
      part.result !== undefined &&
      part.isError !== true &&
      part.outcome !== "unknown"
    ) {
      names.add(part.toolName);
    }
  }
  return [...names];
}

function completedToolOnlyMessage(toolNames: string[]): string | null {
  if (toolNames.length === 0) return null;
  const label = formatToolNames(toolNames);
  return `The agent completed ${label}, but stopped before sending a final message. Review the completed tool card above or ask the agent to continue.`;
}

const MAX_REPORTED_TOOL_ERROR_LENGTH = 300;

function failedToolResultsAfterLastAssistantText(
  content: ContentPart[],
): { toolName: string; error: string }[] {
  const lastTextIndex = lastAssistantTextIndex(content);
  const failures: { toolName: string; error: string }[] = [];
  for (let index = content.length - 1; index > lastTextIndex; index--) {
    const part = content[index];
    if (
      part?.type !== "tool-call" ||
      part.activity === true ||
      part.isError !== true ||
      part.result === undefined
    ) {
      continue;
    }
    failures.push({
      toolName: part.toolName,
      error: typeof part.result === "string" ? part.result.trim() : "",
    });
  }
  return failures;
}

function failedToolMessage(
  failures: { toolName: string; error: string }[],
): string | null {
  const latest = failures[0];
  if (!latest) return null;
  const label = formatToolNames(failures.map((failure) => failure.toolName));
  const detail = latest.error
    ? ` ${truncateToolError(latest.error)}`
    : " No error detail was returned.";
  return `The agent stopped after ${label} failed, without sending a final message.${detail} Ask the agent to continue, or fix the underlying failure and retry.`;
}

function truncateToolError(error: string): string {
  const singleLine = error.replace(/\s+/g, " ").trim();
  return singleLine.length > MAX_REPORTED_TOOL_ERROR_LENGTH
    ? `${singleLine.slice(0, MAX_REPORTED_TOOL_ERROR_LENGTH)}…`
    : singleLine;
}

function hasCompletedCustomUi(content: ContentPart[]): boolean {
  const lastTextIndex = lastAssistantTextIndex(content);
  let lastCompletedToolIsCustomUi = false;
  let hasCompletedTool = false;
  for (let index = lastTextIndex + 1; index < content.length; index++) {
    const part = content[index];
    if (
      part?.type !== "tool-call" ||
      part.activity === true ||
      part.result === undefined ||
      part.isError === true ||
      part.outcome === "unknown"
    ) {
      continue;
    }
    hasCompletedTool = true;
    lastCompletedToolIsCustomUi =
      part.chatUI !== undefined || part.mcpApp !== undefined;
  }
  return hasCompletedTool && lastCompletedToolIsCustomUi;
}

export function appendMissingFinalResponseWarning(
  content: ContentPart[],
  completedToolNames?: Iterable<string>,
): {
  message: string;
  errorCode: string;
  recoverable: true;
  failedTools?: string[];
} | null {
  if (content.some((part) => isToolCallActive(part))) return null;
  const lastTextIndex = lastAssistantTextIndex(content);
  const successfulToolNames = [
    ...new Set(
      completedToolNames ?? completedToolNamesAfterLastAssistantText(content),
    ),
  ];
  let lastToolIndex = -1;
  let lastToolResultFailed = false;
  const materializedToolNames = new Set<string>();
  for (let index = lastTextIndex + 1; index < content.length; index++) {
    const part = content[index];
    if (
      part.type === "tool-call" &&
      part.activity !== true &&
      part.result !== undefined
    ) {
      lastToolIndex = index;
      lastToolResultFailed = part.isError === true;
      materializedToolNames.add(part.toolName);
    }
  }
  if (!lastToolResultFailed && hasCompletedCustomUi(content)) return null;
  if (successfulToolNames.length === 0 && lastTextIndex > lastToolIndex) {
    return null;
  }
  const failures = failedToolResultsAfterLastAssistantText(content);
  const completedToolMessage = completedToolOnlyMessage(successfulToolNames);
  const message =
    failedToolMessage(failures) ??
    completedToolMessage ??
    (materializedToolNames.size > 0
      ? `The agent stopped after ${formatToolNames([...materializedToolNames])} without sending a final message. Review the tool card above or ask the agent to continue.`
      : "The agent stopped without sending a final message. Ask the agent to continue or retry.");
  if (!content.some((part) => part.type === "text" && part.text === message)) {
    content.push({ type: "text", text: message });
  }
  return {
    message,
    errorCode:
      successfulToolNames.length > 0 || materializedToolNames.size > 0
        ? "final_response_missing_after_tool"
        : "final_response_missing",
    recoverable: true,
    ...(failures.length > 0
      ? { failedTools: failures.map((failure) => failure.toolName) }
      : {}),
  };
}

interface ProcessEventState {
  completedToolsAfterLastAssistantText: Set<string>;
  streamProgressDispatched: boolean;
}

function markAssistantText(state: ProcessEventState | undefined) {
  state?.completedToolsAfterLastAssistantText.clear();
}

function markCompletedToolAfterAssistantText(
  state: ProcessEventState | undefined,
  toolName: string,
) {
  state?.completedToolsAfterLastAssistantText.add(toolName);
}

function resetProcessEventState(state: ProcessEventState | undefined) {
  state?.completedToolsAfterLastAssistantText.clear();
  if (state) state.streamProgressDispatched = false;
}

function shouldDispatchStreamProgress(
  state: ProcessEventState | undefined,
): boolean {
  if (state?.streamProgressDispatched) return false;
  if (state) state.streamProgressDispatched = true;
  return true;
}

function emitFirstPartyOpenAppHandoff(ev: SSEEvent): void {
  if (ev.type !== "tool_done" || (ev.tool ?? "unknown") !== "open_app") {
    return;
  }
  if (ev.isError === true) return;
  if (!ev.result?.trim()) {
    console.warn(
      "[chat-first] open_app completed without a readable result; no app pane opened",
    );
    return;
  }

  let result: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(ev.result);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      console.warn(
        "[chat-first] open_app completed without a readable result; no app pane opened",
      );
      return;
    }
    result = parsed as Record<string, unknown>;
  } catch {
    // coercion-ok: unreadable tool output must not be treated as a successful handoff.
    console.warn(
      "[chat-first] open_app completed without a readable result; no app pane opened",
    );
    return;
  }

  const readString = (value: unknown): string | undefined =>
    typeof value === "string" && value.trim() ? value : undefined;
  const delivery = emitChatFirstOpenApp({
    app: readString(result.app ?? result.appId ?? result.application),
    path: readString(result.path ?? result.targetPath),
    url: readString(result.url ?? result.href),
    view: readString(result.view),
  });
  if (!delivery.delivered) {
    console.warn(
      `[chat-first] open_app was completed but not delivered (${delivery.reason ?? "unknown"})`,
    );
  }
}

export function processEvent(
  ev: SSEEvent,
  content: ContentPart[],
  toolCallCounter: { value: number },
  tabId: string | undefined,
  state?: ProcessEventState,
  context?: { runId?: string; turnId?: string },
): {
  action:
    | "continue"
    | "done"
    | "yield"
    | "error"
    | "missing_api_key"
    | "auto_continue";
  result?: ChatModelRunResult;
  autoContinue?: {
    reason: AgentAutoContinueReason;
    maxIterations?: number;
    errorInfo?: AgentAutoContinueErrorInfo;
  };
} {
  if (ev.type === "clear") {
    clearAssistantDraftContent(content);
    resetProcessEventState(state);
    dispatchActivityClear(tabId);
    return {
      action: "yield",
      result: { content: contentSnapshot(content) } as ChatModelRunResult,
    };
  }

  if (ev.type === "text") {
    if (ev.text) {
      dispatchActivityClear(tabId);
      if (shouldDispatchStreamProgress(state)) dispatchStreamProgress(tabId);
    }
    if (ev.text?.trim()) markAssistantText(state);
    const lastPart = content[content.length - 1];
    if (lastPart && lastPart.type === "text") {
      lastPart.text += ev.text ?? "";
    } else {
      content.push({ type: "text", text: ev.text ?? "" });
    }
    return {
      action: "yield",
      result: { content: contentSnapshot(content) } as ChatModelRunResult,
    };
  }

  if (ev.type === "thinking" || ev.type === "reasoning") {
    const delta = ev.text ?? "";
    if (!delta) return { action: "continue" };
    if (shouldDispatchStreamProgress(state)) dispatchStreamProgress(tabId);
    const lastPart = content[content.length - 1];
    if (lastPart && lastPart.type === "reasoning") {
      lastPart.text += delta;
    } else {
      content.push({ type: "reasoning", text: delta });
    }
    return {
      action: "yield",
      result: { content: contentSnapshot(content) } as ChatModelRunResult,
    };
  }

  if (ev.type === "stream_keepalive") {
    return { action: "continue" };
  }

  if (ev.type === "activity") {
    const tool = ev.tool?.trim() || undefined;
    const label = visibleActivityLabel(ev, tool);
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("agent-chat:activity", {
          detail: {
            label,
            ...(tool ? { tool } : {}),
            tabId,
          },
        }),
      );
    }
    if (!tool) return { action: "continue" };

    const pendingToolCallIndex = findPendingActivityToolCallIndex(
      content,
      tool,
      ev.id,
    );
    if (pendingToolCallIndex >= 0 && ev.id) {
      const pending = content[pendingToolCallIndex];
      if (pending?.type === "tool-call" && pending.toolCallId !== ev.id) {
        content[pendingToolCallIndex] = { ...pending, toolCallId: ev.id };
      }
    }
    if (pendingToolCallIndex === -1) {
      const hasCompletedSameTool = content.some(
        (part) =>
          part.type === "tool-call" &&
          part.toolName === tool &&
          part.result !== undefined &&
          (!ev.id || part.toolCallId === ev.id),
      );
      if (!hasCompletedSameTool) {
        content.push({
          type: "tool-call",
          toolCallId: ev.id ?? `tc_${++toolCallCounter.value}`,
          toolName: tool,
          argsText: "",
          args: {},
          activity: true,
        });
      }
    }
    return {
      action: "yield",
      result: { content: contentSnapshot(content) } as ChatModelRunResult,
    };
  }

  if (ev.type === "tool_input_start" || ev.type === "tool_input_delta") {
    const tool = ev.tool?.trim() || "unknown";
    const pendingToolCallIndex = findPendingActivityToolCallIndex(
      content,
      tool,
      ev.id,
    );
    let toolCallIndex = pendingToolCallIndex;

    if (toolCallIndex < 0) {
      const hasCompletedSameTool = content.some(
        (part) =>
          part.type === "tool-call" &&
          part.toolName === tool &&
          part.result !== undefined &&
          (!ev.id || part.toolCallId === ev.id),
      );
      if (!hasCompletedSameTool) {
        content.push({
          type: "tool-call",
          toolCallId: ev.id ?? `tc_${++toolCallCounter.value}`,
          toolName: tool,
          argsText: "",
          args: {},
          activity: true,
        });
        toolCallIndex = content.length - 1;
      }
    }

    const pending = toolCallIndex >= 0 ? content[toolCallIndex] : undefined;
    if (pending?.type === "tool-call") {
      if (ev.id && pending.toolCallId !== ev.id) {
        pending.toolCallId = ev.id;
      }
      if (ev.type === "tool_input_delta" && ev.text) {
        pending.argsText += ev.text;
      }
    }

    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("agent-native:tool-input", {
          detail: {
            phase: ev.type === "tool_input_start" ? "start" : "delta",
            tool,
            ...(ev.id ? { id: ev.id } : {}),
            argsText:
              pending?.type === "tool-call" ? pending.argsText : undefined,
            ...(ev.type === "tool_input_delta" ? { text: ev.text ?? "" } : {}),
            tabId,
          },
        }),
      );
    }

    return {
      action: "yield",
      result: { content: contentSnapshot(content) } as ChatModelRunResult,
    };
  }

  if (ev.type === "tool_start") {
    const args = (ev.input ?? {}) as Record<string, string>;
    const tool = ev.tool ?? "unknown";
    if (findCompletedToolCallIndex(content, ev.id) >= 0) {
      return { action: "continue" };
    }
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("agent-native:tool-start", {
          detail: { tool, input: args },
        }),
      );
      window.dispatchEvent(
        new CustomEvent("agent-chat:activity", {
          detail: {
            label: runningToolLabel(tool),
            tool,
            tabId,
          },
        }),
      );
    }
    const pendingToolCallIndex = ev.id
      ? findPendingActivityToolCallIndex(content, tool, ev.id)
      : findOldestPendingActivityToolCallIndex(content, tool);
    const pendingToolCall =
      pendingToolCallIndex >= 0 ? content[pendingToolCallIndex] : undefined;
    const pendingIsActivityPlaceholder =
      pendingToolCall?.type === "tool-call" &&
      pendingToolCall.activity === true &&
      pendingToolCall.result === undefined;
    const pendingIsSameIdReplay =
      pendingToolCall?.type === "tool-call" &&
      ev.id !== undefined &&
      pendingToolCall.toolCallId === ev.id;
    if (
      pendingToolCall &&
      pendingToolCall.type === "tool-call" &&
      (pendingIsActivityPlaceholder || pendingIsSameIdReplay)
    ) {
      content[pendingToolCallIndex] = {
        type: "tool-call",
        toolCallId: ev.id ?? pendingToolCall.toolCallId,
        toolName: tool,
        argsText: JSON.stringify(args),
        args,
      };
    } else {
      content.push({
        type: "tool-call",
        toolCallId: ev.id ?? `tc_${++toolCallCounter.value}`,
        toolName: tool,
        argsText: JSON.stringify(args),
        args,
      });
    }
    return {
      action: "yield",
      result: { content: contentSnapshot(content) } as ChatModelRunResult,
    };
  }

  if (ev.type === "approval_required") {
    const approvalTool = ev.tool ?? "unknown";
    const approvalKey = ev.approvalKey;
    if (approvalKey) {
      const idx = findApprovalToolCallIndex(
        content,
        approvalTool,
        ev.toolCallId ?? ev.id,
      );
      if (idx >= 0) {
        const part = content[idx];
        if (part.type === "tool-call") {
          part.approval = {
            approvalKey,
            ...(ev.askId ? { askId: ev.askId } : {}),
            ...(ev.allowPersistentApproval === false
              ? { allowPersistentApproval: false }
              : {}),
          };
        }
      }
    }
    return {
      action: "yield",
      result: { content: contentSnapshot(content) } as ChatModelRunResult,
    };
  }

  if (ev.type === "tool_done") {
    const doneTool = ev.tool ?? "unknown";
    if (findCompletedToolCallIndex(content, ev.id) >= 0) {
      return { action: "continue" };
    }
    emitFirstPartyOpenAppHandoff(ev);
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("agent-native:tool-done", {
          detail: { tool: doneTool, result: ev.result },
        }),
      );
    }
    dispatchActivityClear(tabId);
    const doneIdx = findPendingToolCallIndex(content, doneTool, ev.id);
    if (doneIdx >= 0) {
      const part = content[doneIdx];
      if (part.type === "tool-call") {
        part.result = ev.result ?? "";
        if (ev.isError !== undefined) part.isError = ev.isError;
        if (ev.completedSideEffect !== undefined) {
          part.completedSideEffect = ev.completedSideEffect;
        }
        if (ev.artifacts !== undefined) {
          part.artifacts = mergeArtifactReceipts(part.artifacts, ev.artifacts);
        }
        if (ev.mcpApp) part.mcpApp = ev.mcpApp;
        if (ev.chatUI) part.chatUI = ev.chatUI;
        if (part.activity !== true && part.isError !== true) {
          markCompletedToolAfterAssistantText(state, part.toolName);
        }
        if (!coalesceJournalRecoveredTool(content, doneIdx)) {
          coalesceCompletedToolRepeat(content, doneIdx);
        }
      }
    }
    return {
      action: "yield",
      result: { content: contentSnapshot(content) } as ChatModelRunResult,
    };
  }

  if (ev.type === "agent_call") {
    const agentName = ev.agent ?? "agent";
    if (ev.status === "start") {
      const toolCallId = ev.agentCallId ?? `tc_${++toolCallCounter.value}`;
      content.push({
        type: "tool-call",
        toolCallId,
        toolName: `agent:${agentName}`,
        argsText: "",
        args: {},
        activity: true,
      });
    } else if (
      ev.status === "done" ||
      ev.status === "pending" ||
      ev.status === "error"
    ) {
      for (let i = content.length - 1; i >= 0; i--) {
        const part = content[i];
        if (
          part.type === "tool-call" &&
          part.toolName === `agent:${agentName}` &&
          (!ev.agentCallId || part.toolCallId === ev.agentCallId) &&
          part.result === undefined
        ) {
          part.result =
            ev.status === "error"
              ? "Error calling agent"
              : ev.status === "pending"
                ? "Remote agent task is still pending"
                : "Done";
          part.structuredMeta = {
            ...part.structuredMeta,
            ...(ev.status === "pending" ? { agentPending: true } : {}),
            ...(ev.durationMs != null
              ? { agentDurationMs: ev.durationMs }
              : {}),
          };
          break;
        }
      }
    }
    return {
      action: "yield",
      result: { content: contentSnapshot(content) } as ChatModelRunResult,
    };
  }

  if (ev.type === "agent_call_text") {
    const agentName = ev.agent ?? "agent";
    for (let i = content.length - 1; i >= 0; i--) {
      const part = content[i];
      if (
        part.type === "tool-call" &&
        part.toolName === `agent:${agentName}` &&
        (!ev.agentCallId || part.toolCallId === ev.agentCallId) &&
        part.result === undefined
      ) {
        part.argsText += ev.text ?? "";
        break;
      }
    }
    return {
      action: "yield",
      result: { content: contentSnapshot(content) } as ChatModelRunResult,
    };
  }

  if (ev.type === "agent_call_progress") {
    const agentName = ev.agent ?? "agent";
    if (typeof ev.state !== "string") {
      return { action: "continue" };
    }
    const elapsedSeconds =
      typeof ev.elapsedSeconds === "number" &&
      Number.isFinite(ev.elapsedSeconds) &&
      ev.elapsedSeconds >= 0
        ? ev.elapsedSeconds
        : 0;
    for (let i = content.length - 1; i >= 0; i--) {
      const part = content[i];
      if (
        part.type === "tool-call" &&
        part.toolName === `agent:${agentName}` &&
        (!ev.agentCallId || part.toolCallId === ev.agentCallId) &&
        part.result === undefined
      ) {
        part.structuredMeta = {
          ...part.structuredMeta,
          agentProgress: {
            state: ev.state,
            elapsedSeconds,
            ...(ev.detail ? { detail: ev.detail } : {}),
          } satisfies AgentCallProgress,
        };
        break;
      }
    }
    return {
      action: "yield",
      result: { content: contentSnapshot(content) } as ChatModelRunResult,
    };
  }

  if (ev.type === "agent_call_activity" && ev.snapshot) {
    const agentName = ev.agent ?? "agent";
    for (let i = content.length - 1; i >= 0; i--) {
      const part = content[i];
      if (
        part.type === "tool-call" &&
        part.toolName === `agent:${agentName}` &&
        (!ev.agentCallId || part.toolCallId === ev.agentCallId)
      ) {
        const previous = part.structuredMeta?.agentActivity as
          | A2AAgentActivitySnapshot
          | undefined;
        if (!previous || ev.snapshot.sequence >= previous.sequence) {
          part.structuredMeta = {
            ...part.structuredMeta,
            agentActivity: ev.snapshot,
          };
        }
        break;
      }
    }
    return {
      action: "yield",
      result: { content: contentSnapshot(content) } as ChatModelRunResult,
    };
  }

  if (
    ev.type === "agent_task" ||
    ev.type === "agent_task_update" ||
    ev.type === "agent_task_complete"
  ) {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("agent-task-event", { detail: ev }));
    }
    return { action: "continue" };
  }

  if (ev.type === "missing_api_key") {
    const errMsg = LLM_MISSING_CREDENTIALS_MESSAGE;
    const errorCode = LLM_MISSING_CREDENTIALS_ERROR_CODE;
    const runError = {
      message: normalizeChatError(errMsg, errorCode).message,
      errorCode,
    };
    if (typeof window !== "undefined") {
      dispatchMissingApiKey(tabId);
      window.dispatchEvent(
        new CustomEvent("agent-chat:run-error", {
          detail: {
            ...runError,
            tabId,
            ...(context?.runId ? { runId: context.runId } : {}),
            ...(context?.turnId ? { turnId: context.turnId } : {}),
          },
        }),
      );
    }
    dispatchActivityClear(tabId);
    settleInterruptedToolCalls(content, undefined, { includeActivity: true });
    return {
      action: "missing_api_key",
      result: {
        content: contentSnapshot(content),
        status: { type: "incomplete" as const, reason: "error" as const },
        metadata: { custom: { runError } },
      } as ChatModelRunResult,
    };
  }

  if (ev.type === "loop_limit") {
    const maxIterations =
      typeof ev.maxIterations === "number" ? ev.maxIterations : undefined;
    return {
      action: "auto_continue",
      autoContinue: {
        reason: "loop_limit",
        ...(maxIterations ? { maxIterations } : {}),
      },
    };
  }

  if (ev.type === "auto_continue") {
    const reason =
      ev.reason === "stream_ended" ||
      ev.reason === "loop_limit" ||
      ev.reason === "no_progress" ||
      ev.reason === "run_timeout"
        ? ev.reason
        : ev.errorCode === "stream_ended" ||
            ev.errorCode === "loop_limit" ||
            ev.errorCode === "no_progress" ||
            ev.errorCode === "run_timeout"
          ? ev.errorCode
          : ev.error === "stream_ended" ||
              ev.error === "loop_limit" ||
              ev.error === "no_progress" ||
              ev.error === "run_timeout"
            ? ev.error
            : ev.status === "stream_ended" ||
                ev.status === "loop_limit" ||
                ev.status === "no_progress" ||
                ev.status === "run_timeout"
              ? ev.status
              : "run_timeout";
    return {
      action: "auto_continue",
      autoContinue: {
        reason,
        ...(typeof ev.maxIterations === "number"
          ? { maxIterations: ev.maxIterations }
          : {}),
      },
    };
  }

  if (ev.type === "error") {
    const errMsg = ev.error ?? "Unknown error";
    if (
      (ev.errorCode === "run_timeout" && ev.recoverable) ||
      isAutoRecoverableError(ev, errMsg)
    ) {
      const normalized = normalizeChatError(errMsg, ev.errorCode);
      return {
        action: "auto_continue",
        autoContinue: {
          reason:
            ev.errorCode === "stale_run"
              ? "stale_run"
              : ev.errorCode === "builder_gateway_timeout" ||
                  ev.errorCode === "run_timeout" ||
                  errMsg.toLowerCase().includes("timeout")
                ? "run_timeout"
                : "stream_ended",
          errorInfo: {
            message: normalized.message,
            ...(ev.details || normalized.details
              ? { details: ev.details ?? normalized.details }
              : {}),
            ...(ev.errorCode ? { errorCode: ev.errorCode } : {}),
            recoverable: ev.recoverable ?? true,
            ...(ev.upgradeUrl ? { upgradeUrl: ev.upgradeUrl } : {}),
          },
        },
      };
    }
    const normalized = normalizeChatError(errMsg, ev.errorCode);
    const missingProviderError = isMissingProviderErrorText(
      errMsg,
      ev.errorCode,
    );
    if (isMissingCredentialText(errMsg, ev.errorCode)) {
      dispatchMissingApiKey(tabId);
    }
    const runError = {
      message: normalized.message,
      ...(normalized.details || ev.details
        ? { details: ev.details ?? normalized.details }
        : {}),
      ...(ev.errorCode ? { errorCode: ev.errorCode } : {}),
      ...(ev.recoverable ? { recoverable: ev.recoverable } : {}),
    };
    dispatchActivityClear(tabId);
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("agent-chat:run-error", {
          detail: {
            ...runError,
            tabId,
            ...(context?.runId ? { runId: context.runId } : {}),
            ...(context?.turnId ? { turnId: context.turnId } : {}),
          },
        }),
      );
    }
    settleInterruptedToolCalls(content, undefined, { includeActivity: true });
    if (!missingProviderError) {
      content.push({
        type: "text",
        text: formatChatErrorText(errMsg, ev.upgradeUrl, ev.errorCode),
      });
    }
    return {
      action: "error",
      result: {
        content: contentSnapshot(content),
        status: { type: "incomplete" as const, reason: "error" as const },
        metadata: { custom: { runError } },
      } as ChatModelRunResult,
    };
  }

  if (ev.type === "done") {
    dispatchActivityClear(tabId);
    const userStoppedRun = ev.reason === "user";
    const interruptedTools = pendingToolNames(content);
    const allInterruptedTools = [
      ...interruptedTools.running,
      ...interruptedTools.activity,
    ];
    if (allInterruptedTools.length > 0) {
      settleInterruptedToolCalls(content, undefined, {
        includeActivity: true,
        userStopped: userStoppedRun,
      });
      if (userStoppedRun) {
        return {
          action: "done",
          result: {
            content: contentSnapshot(content),
            status: { type: "complete" as const, reason: "stop" as const },
            metadata: { custom: { userStopped: true } },
          } as ChatModelRunResult,
        };
      }
      const message = interruptedToolMessage(interruptedTools);
      const runError = {
        message,
        details: `interrupted_actions: ${allInterruptedTools.join(", ")}`,
        errorCode: "action_not_started",
        recoverable: true,
      };
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("agent-chat:run-error", {
            detail: {
              ...runError,
              tabId,
              ...(context?.runId ? { runId: context.runId } : {}),
              ...(context?.turnId ? { turnId: context.turnId } : {}),
            },
          }),
        );
      }
      content.push({
        type: "text",
        text: formatChatErrorText(message, undefined, runError.errorCode),
      });
      return {
        action: "error",
        result: {
          content: contentSnapshot(content),
          status: { type: "incomplete" as const, reason: "error" as const },
          metadata: { custom: { runError } },
        } as ChatModelRunResult,
      };
    }
    if (userStoppedRun) {
      return {
        action: "done",
        result: {
          content: contentSnapshot(content),
          status: { type: "complete" as const, reason: "stop" as const },
          metadata: { custom: { userStopped: true } },
        } as ChatModelRunResult,
      };
    }
    const runWarning = appendMissingFinalResponseWarning(
      content,
      state ? state.completedToolsAfterLastAssistantText : undefined,
    );
    if (runWarning) {
      return {
        action: "done",
        result: {
          content: contentSnapshot(content),
          status: { type: "complete" as const, reason: "stop" as const },
          metadata: {
            custom: {
              runWarning,
            },
          },
        } as ChatModelRunResult,
      };
    }
    return {
      action: "done",
      result: { content: contentSnapshot(content) } as ChatModelRunResult,
    };
  }

  return { action: "continue" };
}

function clearAssistantDraftContent(content: ContentPart[]): void {
  for (let index = content.length - 1; index >= 0; index--) {
    const part = content[index];
    if (!part) continue;
    if (
      part.type === "tool-call" &&
      part.activity !== true &&
      part.result !== undefined
    ) {
      return;
    }
    if (part.type === "text" || part.type === "reasoning") {
      content.splice(index, 1);
      continue;
    }
    if (part.type === "tool-call" && part.result === undefined) {
      const isEphemeral =
        part.activity === true ||
        part.argsText === "" ||
        Object.keys(part.args ?? {}).length === 0;
      if (isEphemeral) content.splice(index, 1);
    }
  }
}

export async function* readSSEStream(
  body: ReadableStream<Uint8Array>,
  content: ContentPart[],
  toolCallCounter: { value: number },
  tabId: string | undefined,
  onSeq?: (seq: number, isProgress?: boolean) => void,
  runId?: string | null,
  options?: SSEStreamOptions,
): AsyncGenerator<ChatModelRunResult> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let lastMeaningfulEventAt = Date.now();
  const noProgressTimeoutMs = sseNoProgressTimeoutMs(options);
  const preparationStallTimeoutMs = sseActionPreparationStallTimeoutMs(options);
  const activityTrail: ActivityTrailEntry[] = [];
  const preparingActionState: PreparingActionState =
    options?.preparingActionState ?? {};
  const processEventState: ProcessEventState = {
    completedToolsAfterLastAssistantText: new Set(),
    streamProgressDispatched: false,
  };
  let renderUpdatesThisTurn = 0;
  let nextEventLoopTurn: Promise<void> | null = null;
  let inFlightWork = 0;
  const currentNoProgressTimeoutMs = () =>
    inFlightWork > 0
      ? Math.max(noProgressTimeoutMs, SSE_IN_FLIGHT_WORK_TIMEOUT_MS)
      : noProgressTimeoutMs;

  const paceRenderUpdate = async (hasBufferedEvent: boolean): Promise<void> => {
    if (!hasBufferedEvent) {
      renderUpdatesThisTurn = 0;
      return;
    }

    renderUpdatesThisTurn += 1;
    if (!nextEventLoopTurn) {
      nextEventLoopTurn = waitForNextEventLoopTurn().then(() => {
        renderUpdatesThisTurn = 0;
        nextEventLoopTurn = null;
      });
    }
    if (renderUpdatesThisTurn >= SSE_RENDER_UPDATES_PER_EVENT_LOOP_TURN) {
      await nextEventLoopTurn;
    }
  };

  const withStreamMetadata = (r: ChatModelRunResult): ChatModelRunResult => {
    if (!runId && activityTrail.length === 0) return r;
    const metadata = (r.metadata ?? {}) as Record<string, unknown>;
    const custom =
      metadata.custom && typeof metadata.custom === "object"
        ? (metadata.custom as Record<string, unknown>)
        : {};
    const runError =
      runId && custom.runError && typeof custom.runError === "object"
        ? {
            ...(custom.runError as Record<string, unknown>),
            runId,
          }
        : custom.runError;
    return {
      ...r,
      metadata: {
        ...metadata,
        custom: {
          ...custom,
          ...(runId ? { runId } : {}),
          ...(runError ? { runError } : {}),
          ...(activityTrail.length > 0
            ? { activityTrail: [...activityTrail] }
            : {}),
        },
      },
    };
  };

  try {
    while (true) {
      let readResult: ReadableStreamReadResult<Uint8Array>;
      try {
        readResult = await readChunkWithProgressTimeout(
          reader,
          lastMeaningfulEventAt,
          currentNoProgressTimeoutMs(),
        );
      } catch (err) {
        if (err instanceof AgentAutoContinueSignal) {
          throw new AgentAutoContinueSignal({
            reason: err.reason,
            maxIterations: err.maxIterations,
            activityTrail: [...activityTrail],
            errorInfo: err.errorInfo,
            clientWatchdog: err.clientWatchdog,
          });
        }
        throw err;
      }
      const { done, value } = readResult;
      if (done) break;

      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      let sawProgressEvent = false;
      let bufferedDataEvents = lines.reduce(
        (count, pendingLine) =>
          count +
          (pendingLine.startsWith("data: ") &&
          pendingLine.slice(6).trim().length > 0
            ? 1
            : 0),
        0,
      );

      for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        const line = lines[lineIndex]!;
        if (!line.startsWith("data: ")) continue;
        const raw = line.slice(6).trim();
        if (!raw) continue;
        bufferedDataEvents -= 1;

        let ev: SSEEvent;
        try {
          ev = JSON.parse(raw);
        } catch {
          continue;
        }
        if (!admitSSEEvent(ev, options?.seenEventSeqs, options?.seenEventIds)) {
          continue;
        }
        const now = Date.now();
        inFlightWork = Math.max(0, inFlightWork + sseInFlightWorkDelta(ev));
        const actionPreparationProgress = updatePreparingActionState(
          preparingActionState,
          ev,
          now,
        );
        const meaningfulProgress = isMeaningfulProgressEvent(
          ev,
          actionPreparationProgress,
          options,
        );
        const durableProgress = isDurableProgressEvent(
          ev,
          actionPreparationProgress,
        );
        if (meaningfulProgress) {
          sawProgressEvent = true;
          lastMeaningfulEventAt = now;
        }

        if (ev.seq !== undefined && onSeq) {
          onSeq(ev.seq, durableProgress);
        }

        if (ev.type === "clear") {
          activityTrail.length = 0;
        } else if (ev.type === "activity") {
          const tool = ev.tool?.trim() || undefined;
          appendActivityTrail(activityTrail, {
            label: baseActivityLabel(ev, tool),
            ...(tool ? { tool } : {}),
          });
        } else if (ev.type === "tool_start") {
          const tool = ev.tool ?? "unknown";
          appendActivityTrail(activityTrail, {
            label: runningToolLabel(tool),
            tool,
          });
        } else if (ev.type === "tool_done") {
          const tool = ev.tool ?? "unknown";
          for (let i = activityTrail.length - 1; i >= 0; i--) {
            if (activityTrail[i]?.tool === tool) {
              activityTrail.splice(i, 1);
            }
          }
        }

        const { action, result, autoContinue } = processEvent(
          ev,
          content,
          toolCallCounter,
          tabId,
          processEventState,
          {
            runId: options?.runId ?? runId ?? undefined,
            turnId: options?.turnId,
          },
        );

        const terminalResult =
          result &&
          options?.markTerminalResults === true &&
          action === "done" &&
          result.status == null
            ? {
                ...result,
                status: {
                  type: "complete" as const,
                  reason: "stop" as const,
                },
              }
            : result;
        if (terminalResult) {
          const hasBufferedEvent = bufferedDataEvents > 0;
          await paceRenderUpdate(hasBufferedEvent);
          yield withStreamMetadata(terminalResult);
        }
        if (
          hasStalledPreparingAction(
            preparingActionState,
            Date.now(),
            preparationStallTimeoutMs,
          )
        ) {
          throw new AgentAutoContinueSignal({
            reason: "no_progress",
            activityTrail: [...activityTrail],
            clientWatchdog: true,
          });
        }
        if (action === "auto_continue") {
          throw new AgentAutoContinueSignal(
            autoContinue
              ? { ...autoContinue, activityTrail: [...activityTrail] }
              : { reason: "stream_ended", activityTrail: [...activityTrail] },
          );
        }
        if (
          action === "done" ||
          action === "error" ||
          action === "missing_api_key"
        ) {
          return;
        }
      }

      if (
        !sawProgressEvent &&
        Date.now() - lastMeaningfulEventAt >= currentNoProgressTimeoutMs()
      ) {
        throw new AgentAutoContinueSignal({
          reason: "no_progress",
          activityTrail: [...activityTrail],
          clientWatchdog: true,
        });
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // The timeout path cancels the stream before unwinding; some runtimes
      // still consider the pending read active for a tick.
    }
  }

  throw new AgentAutoContinueSignal({
    reason: "stream_ended",
    activityTrail: [...activityTrail],
    clientWatchdog: true,
  });
}

export async function readSSEStreamRaw(
  body: ReadableStream<Uint8Array>,
  content: ContentPart[],
  toolCallCounter: { value: number },
  tabId: string | undefined,
  onUpdate: (content: ContentPart[]) => void,
  onSeq?: (seq: number, isProgress?: boolean) => void,
  options?: SSEStreamOptions,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let lastMeaningfulEventAt = Date.now();
  const noProgressTimeoutMs = sseNoProgressTimeoutMs(options);
  const preparationStallTimeoutMs = sseActionPreparationStallTimeoutMs(options);
  const activityTrail: ActivityTrailEntry[] = [];
  const preparingActionState: PreparingActionState =
    options?.preparingActionState ?? {};
  const processEventState: ProcessEventState = {
    completedToolsAfterLastAssistantText: new Set(),
    streamProgressDispatched: false,
  };
  let emittedLatestContent = false;
  let inFlightWork = 0;
  const currentNoProgressTimeoutMs = () =>
    inFlightWork > 0
      ? Math.max(noProgressTimeoutMs, SSE_IN_FLIGHT_WORK_TIMEOUT_MS)
      : noProgressTimeoutMs;

  try {
    while (true) {
      let readResult: ReadableStreamReadResult<Uint8Array>;
      try {
        readResult = await readChunkWithProgressTimeout(
          reader,
          lastMeaningfulEventAt,
          currentNoProgressTimeoutMs(),
        );
      } catch (err) {
        if (err instanceof AgentAutoContinueSignal) {
          throw new AgentAutoContinueSignal({
            reason: err.reason,
            maxIterations: err.maxIterations,
            activityTrail: [...activityTrail],
            errorInfo: err.errorInfo,
            clientWatchdog: err.clientWatchdog,
          });
        }
        throw err;
      }
      const { done, value } = readResult;
      if (done) break;

      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";

      let sawProgressEvent = false;
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const raw = line.slice(6).trim();
        if (!raw) continue;

        let ev: SSEEvent;
        try {
          ev = JSON.parse(raw);
        } catch {
          continue;
        }
        if (!admitSSEEvent(ev, options?.seenEventSeqs, options?.seenEventIds)) {
          continue;
        }
        const now = Date.now();
        inFlightWork = Math.max(0, inFlightWork + sseInFlightWorkDelta(ev));
        const actionPreparationProgress = updatePreparingActionState(
          preparingActionState,
          ev,
          now,
        );
        const meaningfulProgress = isMeaningfulProgressEvent(
          ev,
          actionPreparationProgress,
          options,
        );
        const durableProgress = isDurableProgressEvent(
          ev,
          actionPreparationProgress,
        );
        if (meaningfulProgress) {
          sawProgressEvent = true;
          lastMeaningfulEventAt = now;
        }

        if (ev.seq !== undefined && onSeq) {
          onSeq(ev.seq, durableProgress);
        }

        if (ev.type === "clear") {
          activityTrail.length = 0;
        } else if (ev.type === "activity") {
          const tool = ev.tool?.trim() || undefined;
          appendActivityTrail(activityTrail, {
            label: baseActivityLabel(ev, tool),
            ...(tool ? { tool } : {}),
          });
        } else if (ev.type === "tool_start") {
          const tool = ev.tool ?? "unknown";
          appendActivityTrail(activityTrail, {
            label: runningToolLabel(tool),
            tool,
          });
        } else if (ev.type === "tool_done") {
          const tool = ev.tool ?? "unknown";
          for (let i = activityTrail.length - 1; i >= 0; i--) {
            if (activityTrail[i]?.tool === tool) {
              activityTrail.splice(i, 1);
            }
          }
        }

        const { action, autoContinue } = processEvent(
          ev,
          content,
          toolCallCounter,
          tabId,
          processEventState,
          { runId: options?.runId, turnId: options?.turnId },
        );

        if (
          action === "yield" ||
          action === "done" ||
          action === "error" ||
          action === "missing_api_key"
        ) {
          onUpdate(contentSnapshot(content));
          emittedLatestContent = true;
        }
        if (action === "auto_continue") {
          onUpdate(contentSnapshot(content));
          emittedLatestContent = true;
          throw new AgentAutoContinueSignal(
            autoContinue
              ? { ...autoContinue, activityTrail: [...activityTrail] }
              : { reason: "stream_ended", activityTrail: [...activityTrail] },
          );
        }
        if (
          hasStalledPreparingAction(
            preparingActionState,
            Date.now(),
            preparationStallTimeoutMs,
          )
        ) {
          onUpdate(contentSnapshot(content));
          throw new AgentAutoContinueSignal({
            reason: "no_progress",
            activityTrail: [...activityTrail],
            clientWatchdog: true,
          });
        }
        if (
          action === "done" ||
          action === "error" ||
          action === "missing_api_key"
        ) {
          return;
        }
      }

      if (
        !sawProgressEvent &&
        Date.now() - lastMeaningfulEventAt >= currentNoProgressTimeoutMs()
      ) {
        throw new AgentAutoContinueSignal({
          reason: "no_progress",
          activityTrail: [...activityTrail],
          clientWatchdog: true,
        });
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // See readSSEStream: cancellation may race lock release in browsers.
    }
  }
  if (content.length > 0 && !emittedLatestContent) {
    onUpdate(contentSnapshot(content));
  }
  throw new AgentAutoContinueSignal({
    reason: "stream_ended",
    clientWatchdog: true,
  });
}
