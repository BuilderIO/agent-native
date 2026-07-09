import type { ChatModelRunResult } from "@assistant-ui/react";

import type { ActionChatUIConfig } from "../action-ui.js";
import {
  LLM_MISSING_CREDENTIALS_ERROR_CODE,
  LLM_MISSING_CREDENTIALS_MESSAGE,
} from "../agent/engine/credential-errors.js";
import type { AgentMcpAppPayload } from "../mcp-client/app-result.js";
import { formatChatErrorText, normalizeChatError } from "./error-format.js";
import {
  humanizeToolLabelText,
  humanizeToolName,
  runningToolLabel,
} from "./tool-display.js";

export type ContentPart =
  | { type: "text"; text: string }
  | {
      /**
       * Model chain-of-thought / extended-thinking prose. Streamed from
       * server `thinking` SSE events (and code-agent thinking transcript
       * items). Rendered as a collapsible plain-English cell — not a tool
       * call.
       */
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
      completedSideEffect?: boolean;
      mcpApp?: AgentMcpAppPayload;
      chatUI?: ActionChatUIConfig;
      activity?: boolean;
      repeatCount?: number;
      /**
       * Set when the server emitted an `approval_required` event for this tool
       * call (opt-in `needsApproval` actions). The action did NOT run; the UI
       * renders an Approve/Deny affordance. `approvalKey` is echoed back in
       * `approvedToolCalls` to approve, `dismissed` records a local Deny.
       */
      approval?: { approvalKey: string; dismissed?: boolean };
      /**
       * Structured metadata from the coding-tools executor side-channel.
       * Present only on code-agent tool calls from executors new enough to
       * emit it.  The `toolKind` discriminant identifies the shape.
       */
      structuredMeta?: Record<string, unknown>;
    };

export interface SSEEvent {
  type: string;
  text?: string;
  tool?: string;
  /** Server-assigned call identifier emitted on tool_start / tool_done events. */
  id?: string;
  label?: string;
  progressBytes?: number;
  input?: Record<string, string>;
  result?: string;
  isError?: boolean;
  completedSideEffect?: boolean;
  mcpApp?: AgentMcpAppPayload;
  chatUI?: ActionChatUIConfig;
  /** Stable key the client echoes back in `approvedToolCalls` to approve a
   *  paused `needsApproval` tool call. Present on `approval_required` events. */
  approvalKey?: string;
  error?: string;
  seq?: number;
  agent?: string;
  status?: string;
  reason?: string;
  // Agent task fields
  taskId?: string;
  threadId?: string;
  description?: string;
  preview?: string;
  currentStep?: string;
  summary?: string;
  // Structured error metadata — Builder gateway sets these on quota/auth/setup
  // failures so the UI can render a CTA alongside the error text.
  errorCode?: string;
  upgradeUrl?: string;
  details?: string;
  recoverable?: boolean;
  maxIterations?: number;
}

export type AgentAutoContinueReason =
  | "run_timeout"
  | "loop_limit"
  | "no_progress"
  | "stream_ended"
  | "stale_run";

export type AgentActivityTrailEntry = { label: string; tool?: string };

export interface AgentAutoContinueErrorInfo {
  message: string;
  details?: string;
  errorCode?: string;
  recoverable?: boolean;
  upgradeUrl?: string;
}

const INTERRUPTED_TOOL_RESULT =
  "Interrupted before this tool returned a result.";
const INTERRUPTED_ACTIVITY_RESULT = "Stopped before this action started.";

export function settleInterruptedToolCalls(
  content: ContentPart[],
  result = INTERRUPTED_TOOL_RESULT,
  options?: { includeActivity?: boolean; activityResult?: string },
): boolean {
  let changed = false;
  for (const part of content) {
    if (
      part.type === "tool-call" &&
      part.result === undefined &&
      (part.activity !== true || options?.includeActivity === true)
    ) {
      part.result =
        part.activity === true
          ? (options?.activityResult ?? INTERRUPTED_ACTIVITY_RESULT)
          : result;
      part.isError = true;
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

  constructor(options: {
    reason: AgentAutoContinueReason;
    maxIterations?: number;
    activityTrail?: AgentActivityTrailEntry[];
    errorInfo?: AgentAutoContinueErrorInfo;
  }) {
    super(`Agent run needs automatic continuation: ${options.reason}`);
    this.name = "AgentAutoContinueSignal";
    this.reason = options.reason;
    this.maxIterations = options.maxIterations;
    this.activityTrail = options.activityTrail ?? [];
    this.errorInfo = options.errorInfo;
  }
}

export const SSE_NO_PROGRESS_TIMEOUT_MS = 75_000;
export const SSE_ACTION_PREPARATION_STALL_TIMEOUT_MS = 90_000;
/**
 * Widened client watchdog windows for durable background runs. The SERVER is
 * the recovery brain for these runs: its run-manager no-progress backstop
 * emits `auto_continue` over the same stream the client is already reading,
 * and its unclaimed-run sweep reaps dead workers into loud terminal errors.
 * The client watchdogs therefore sit ABOVE the server's durable-background
 * backstop so a healthy background run never trips them — the server's own
 * recovery event arrives first over the wire. When one does fire, the thrown
 * signal only means "reattach the read" (the adapter's background follow loop
 * re-polls /runs/active); it never escalates to a client-declared error or a
 * synthetic continuation POST. Progress ACCOUNTING (what counts as a
 * meaningful event) is unchanged — only the client-initiated recovery timing
 * is relaxed.
 */
export const SSE_DURABLE_NO_PROGRESS_TIMEOUT_MS = 13 * 60_000;
export const SSE_DURABLE_ACTION_PREPARATION_STALL_TIMEOUT_MS = 13 * 60_000;

export function sseNoProgressTimeoutMs(options?: SSEStreamOptions): number {
  return options?.durableBackgroundRun === true
    ? SSE_DURABLE_NO_PROGRESS_TIMEOUT_MS
    : SSE_NO_PROGRESS_TIMEOUT_MS;
}

function sseActionPreparationStallTimeoutMs(
  options?: SSEStreamOptions,
): number {
  return options?.durableBackgroundRun === true
    ? SSE_DURABLE_ACTION_PREPARATION_STALL_TIMEOUT_MS
    : SSE_ACTION_PREPARATION_STALL_TIMEOUT_MS;
}

export interface SSEStreamOptions {
  /**
   * Durable background runs have their own server-side liveness budget and
   * heartbeat. While one is active, generic keepalive-only periods keep the
   * client attached. Tool-input preparation is stricter: real byte progress
   * keeps long payloads alive, but zero-byte/silent preparation still recovers
   * so one stuck action cannot pin the chat forever — just on the wider
   * durable windows above (behind the server's own 150s backstop) instead of
   * the tight foreground 75s/90s windows.
   */
  durableBackgroundRun?: boolean;
  /**
   * Optional caller-owned preparation watchdog state. Passing the same object
   * across reconnect reads keeps a stuck action preparation from getting a
   * fresh stall budget every time the browser reattaches to the same run.
   */
  preparingActionState?: PreparingActionState;
}

type ActivityTrailEntry = AgentActivityTrailEntry;

type PreparingActionEntry = {
  tool: string;
  startedAt?: number;
  lastProgressBytes?: number;
  /**
   * Timestamp of the last real streaming progress for the in-preparation tool
   * input. The server emits a throttled `activity` heartbeat per
   * `tool-input-delta`, so while the model is actively streaming a (possibly
   * very large) tool argument this keeps advancing. The stall guard measures
   * silence from HERE — not from `startedAt` — so a legitimately large, still-
   * streaming input is never aborted; only genuine silence (keepalive-only, no
   * further deltas) can trip it.
   */
  lastProgressAt?: number;
};

export type PreparingActionState = {
  entries?: Map<string, PreparingActionEntry>;
  toolEntries?: Map<string, PreparingActionEntry>;
};

function formatProgressBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

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
  return `Writing ${action}... (${formatProgressBytes(progressBytes)} prepared)`;
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
  // Prefer id-based match when the event carries an id: parallel same-name
  // calls can be in flight simultaneously, and name-only matching would
  // attach a result to the wrong call.
  if (toolCallId) {
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
      // A byte increase is proof the model is still streaming this action's
      // argument. Repeated zero-byte prep activity is only a heartbeat.
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
  // Fire only when a tool input has gone SILENT — no further streaming deltas
  // for the whole window — never merely because a large input has been
  // streaming for a long time. `lastProgressAt` advances on every delta
  // heartbeat, so an actively-streaming large output keeps resetting this and
  // survives; a genuinely stuck prep (keepalive-only, no deltas) trips it.
  // Durable background reads pass the wider durable window so the server's
  // own 150s no-progress backstop gets first chance to recover the stall.
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
  // If the timeout wins and cancellation causes the pending read to reject,
  // swallow that rejection because the generator is already recovering.
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
    throw new AgentAutoContinueSignal({ reason: "no_progress" });
  }
  return result;
}

function isAutoRecoverableError(ev: SSEEvent, errMsg: string): boolean {
  const code = String(ev.errorCode ?? "").toLowerCase();
  const msg = errMsg.toLowerCase();

  if (
    code === "context_length_exceeded" ||
    code === "input_too_long" ||
    code.startsWith("credits-limit") ||
    code === "billing_error" ||
    code === "unauthorized" ||
    code === "authentication_error" ||
    code === "permission_error" ||
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
    code === "provider_rate_limited" ||
    // `builder_gateway_error` is the no-detail fallback the Builder engine
    // emits when the gateway returns `{type:"stop",reason:"error"}` with no
    // explanation — almost always the upstream provider giving up (model
    // quota hit, account misconfiguration, opaque downstream failure). The
    // production-agent already retries this synchronously up to MAX_RETRIES
    // before the error escapes to the SSE stream, so by the time the client
    // sees it, retrying again with another POST /agent-chat will hit the
    // same wall. This used to send the chat into a 32-continuation runaway
    // (each turn cleared+regenerated visible content) for users hitting a
    // misbehaving Builder route. Surface the error instead.
    code === "builder_gateway_error" ||
    // The hosted run exhausted its in-invocation continuation budget without
    // finishing (run-loop-with-resume.ts). It's flagged `recoverable: true` so
    // the recovery banner reads "stopped before finishing", but it must NOT
    // auto-continue: another POST would hit the same ~40s wall and churn. The
    // user retries deliberately (ideally as a single bulk action).
    code === "run_budget_exhausted"
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
    code === "http_429" ||
    code === "http_500" ||
    code === "http_502" ||
    code === "http_503" ||
    code === "http_504" ||
    code === "rate_limited" ||
    code === "too_many_concurrent_requests" ||
    code === "overloaded_error"
  ) {
    return true;
  }

  if (ev.recoverable === true) return true;

  if (msg.includes("daily gateway request cap")) return false;

  // "gateway error" intentionally absent — that's the no-detail Builder
  // gateway fallback and the production-agent already retries it
  // synchronously up to MAX_RETRIES before the error escapes here. Treating
  // it as auto-recoverable on top of that produced a 32-continuation
  // runaway in production for users hitting a misbehaving Builder route.
  // (See `code === "builder_gateway_error"` in the not-recoverable list.)
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

function dispatchActivityClear(tabId: string | undefined) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("agent-chat:activity-clear", {
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
      ...(part.approval ? { approval: { ...part.approval } } : {}),
      ...(part.structuredMeta
        ? { structuredMeta: { ...part.structuredMeta } }
        : {}),
    };
  });
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

/**
 * Result prefixes the server emits when a tool_start/tool_done pair is a
 * REPLAY of a call that already executed in an earlier interrupted chunk of
 * this turn (tool-call journal hard-block and zombie-ledger recovery in
 * production-agent.ts). These are not new calls — rendering them as separate
 * cards produces the "same tool twice, one spinning / one done" duplicate.
 */
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

/**
 * Merge a journal/ledger-recovered tool_done into the earlier card for the
 * same logical call instead of leaving a duplicate pair. Two shapes occur:
 *
 * 1. The original card already completed (reconnect/continuation replay): the
 *    recovery card at `completedIndex` is redundant — drop it, keeping the
 *    original result.
 * 2. The recovery result attached to the ORIGINAL still-pending card (the
 *    id-less replay tool_done name-matches the earliest pending card): the
 *    replay's own tool_start pushed a second pending card AFTER it that no
 *    tool_done will ever resolve — remove that stuck-spinner artifact.
 *
 * Gated strictly on the recovery result markers so genuinely repeated
 * identical calls are never collapsed. Returns true when it spliced the card
 * at `completedIndex` (callers must not reuse the index afterwards).
 */
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
      // The original was interrupted mid-flight (spinner) — resolve it with
      // the recovered result instead of showing a second card.
      prior.result = current.result;
      if (current.isError !== undefined) prior.isError = current.isError;
      if (current.completedSideEffect !== undefined) {
        prior.completedSideEffect = current.completedSideEffect;
      }
      if (current.mcpApp) prior.mcpApp = current.mcpApp;
      if (current.chatUI) prior.chatUI = current.chatUI;
    }
    content.splice(completedIndex, 1);
    return true;
  }

  // No earlier card — the recovery result landed on the original pending card
  // itself. Remove any later still-pending replay-start artifact for the same
  // call so it doesn't spin forever.
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
      part.isError !== true
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

interface ProcessEventState {
  completedToolsAfterLastAssistantText: Set<string>;
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
}

/**
 * Process a single SSE event and update the content accumulator.
 * Returns: "continue" to keep going, "done" to stop, or a yield-ready result.
 */
export function processEvent(
  ev: SSEEvent,
  content: ContentPart[],
  toolCallCounter: { value: number },
  tabId: string | undefined,
  state?: ProcessEventState,
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
    // Server is retrying — discard rejected draft text and unfinished tool
    // output while keeping completed tool results visible.
    clearAssistantDraftContent(content);
    resetProcessEventState(state);
    dispatchActivityClear(tabId);
    return {
      action: "yield",
      result: { content: contentSnapshot(content) } as ChatModelRunResult,
    };
  }

  if (ev.type === "text") {
    // Visible output means the run is plainly not hanging — drop any running
    // activity label so a transient "Contacting model" / "Still generating
    // image" doesn't linger beside streamed text. Idempotent (clears once, then
    // no-ops) so per-token text deltas stay cheap.
    if (ev.text) dispatchActivityClear(tabId);
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
    // Model chain-of-thought. Coalesce consecutive deltas into one reasoning
    // part so the UI can render a single collapsible "Thinking" cell.
    const delta = ev.text ?? "";
    if (!delta) return { action: "continue" };
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

    const pendingToolCallIndex = findPendingToolCallIndex(content, tool);
    if (pendingToolCallIndex === -1) {
      // Only surface a placeholder spinner when this tool has no card yet. A
      // trailing activity heartbeat that arrives after the matching tool_done
      // (e.g. reordered reconnect replay) must NOT resurrect a spinner for an
      // already-completed call — that is the "pop back to an older state"
      // flicker. The real card reappears on the next tool_start regardless.
      const hasCompletedSameTool = content.some(
        (part) =>
          part.type === "tool-call" &&
          part.toolName === tool &&
          part.result !== undefined,
      );
      if (!hasCompletedSameTool) {
        content.push({
          type: "tool-call",
          toolCallId: `tc_${++toolCallCounter.value}`,
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
    // Pass the server-assigned id so we upgrade the pending activity card
    // using id-match when available (parallel same-name calls stay separate).
    const pendingToolCallIndex = findPendingToolCallIndex(content, tool, ev.id);
    const pendingToolCall =
      pendingToolCallIndex >= 0 ? content[pendingToolCallIndex] : undefined;
    const pendingIsActivityPlaceholder =
      pendingToolCall?.type === "tool-call" &&
      pendingToolCall.activity === true &&
      pendingToolCall.argsText === "" &&
      Object.keys(pendingToolCall.args).length === 0;
    // A re-emitted start for the SAME id — a retry/auto-continue clear that
    // keeps the in-flight card mounted, or a reconnect replay — must update the
    // existing card in place instead of pushing a duplicate. Matching on id
    // keeps genuinely parallel same-name calls, which carry distinct ids,
    // separate.
    const pendingIsSameIdReplay =
      pendingToolCall?.type === "tool-call" &&
      ev.id !== undefined &&
      pendingToolCall.toolCallId === ev.id;
    if (
      pendingToolCall &&
      pendingToolCall.type === "tool-call" &&
      (pendingIsActivityPlaceholder || pendingIsSameIdReplay)
    ) {
      // Upgrade the pending card in place. Prefer the server-assigned id so the
      // subsequent tool_done can match it precisely (parallel same-name calls
      // each carry their own id). Fall back to the locally-generated id.
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
    // Opt-in `needsApproval` gate: the server emitted `tool_start` immediately
    // before this, so the matching tool-call part already exists. Mark it as
    // awaiting approval so the UI can render the Approve/Deny affordance. The
    // action did NOT execute; a paused `tool_done` follows.
    const approvalTool = ev.tool ?? "unknown";
    const approvalKey = ev.approvalKey;
    if (approvalKey) {
      const idx = findPendingToolCallIndex(content, approvalTool, ev.id);
      if (idx >= 0) {
        const part = content[idx];
        if (part.type === "tool-call") {
          part.approval = { approvalKey };
        }
      }
    }
    return {
      action: "yield",
      result: { content: contentSnapshot(content) } as ChatModelRunResult,
    };
  }

  if (ev.type === "tool_done") {
    // Normalize identically to tool_start (which stores `ev.tool ?? "unknown"`)
    // so a tool_done frame with an undefined tool name still matches its
    // pending tool-call entry instead of leaving it forever unresolved.
    const doneTool = ev.tool ?? "unknown";
    if (findCompletedToolCallIndex(content, ev.id) >= 0) {
      return { action: "continue" };
    }
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("agent-native:tool-done", {
          detail: { tool: doneTool, result: ev.result },
        }),
      );
    }
    // Clear any sticky running-activity label (e.g. "Still generating image"):
    // the tool that was emitting activity heartbeats has finished, so the label
    // must not linger while the model streams its follow-up text or reasoning.
    dispatchActivityClear(tabId);
    // Use id-based lookup when available so parallel same-name tool calls
    // get their results correctly assigned; fall back to name-matching.
    const doneIdx = findPendingToolCallIndex(content, doneTool, ev.id);
    if (doneIdx >= 0) {
      const part = content[doneIdx];
      if (part.type === "tool-call") {
        part.result = ev.result ?? "";
        if (ev.isError !== undefined) part.isError = ev.isError;
        if (ev.completedSideEffect !== undefined) {
          part.completedSideEffect = ev.completedSideEffect;
        }
        if (ev.mcpApp) part.mcpApp = ev.mcpApp;
        if (ev.chatUI) part.chatUI = ev.chatUI;
        if (part.activity !== true && part.isError !== true) {
          markCompletedToolAfterAssistantText(state, part.toolName);
        }
        // Journal/ledger replay merge first (may splice the card at doneIdx —
        // when it does, the adjacent-repeat coalesce below must not run on the
        // stale index).
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
      const toolCallId = `tc_${++toolCallCounter.value}`;
      content.push({
        type: "tool-call",
        toolCallId,
        toolName: `agent:${agentName}`,
        argsText: "",
        args: {},
      });
    } else if (ev.status === "done" || ev.status === "error") {
      for (let i = content.length - 1; i >= 0; i--) {
        const part = content[i];
        if (
          part.type === "tool-call" &&
          part.toolName === `agent:${agentName}` &&
          part.result === undefined
        ) {
          part.result = ev.status === "error" ? "Error calling agent" : "Done";
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
    // Find the in-progress agent tool-call and append streaming text to argsText
    for (let i = content.length - 1; i >= 0; i--) {
      const part = content[i];
      if (
        part.type === "tool-call" &&
        part.toolName === `agent:${agentName}` &&
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

  // ─── Agent task events (sub-agent chips) ─────────────────────────
  // These events are dispatched as CustomEvents so AgentTaskCard components
  // can listen for updates to their specific taskId.
  if (
    ev.type === "agent_task" ||
    ev.type === "agent_task_update" ||
    ev.type === "agent_task_complete"
  ) {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("agent-task-event", { detail: ev }));
    }
    // Don't add to content — the agent-teams tool call handles rendering
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
          detail: { ...runError, tabId },
        }),
      );
    }
    settleInterruptedToolCalls(content, undefined, { includeActivity: true });
    content.push({
      type: "text",
      text: formatChatErrorText(errMsg, undefined, errorCode),
    });
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
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("agent-chat:run-error", {
          detail: { ...runError, tabId },
        }),
      );
    }
    settleInterruptedToolCalls(content, undefined, { includeActivity: true });
    content.push({
      type: "text",
      text: formatChatErrorText(errMsg, ev.upgradeUrl, ev.errorCode),
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

  if (ev.type === "done") {
    const interruptedTools = pendingToolNames(content);
    const allInterruptedTools = [
      ...interruptedTools.running,
      ...interruptedTools.activity,
    ];
    if (allInterruptedTools.length > 0) {
      settleInterruptedToolCalls(content, undefined, { includeActivity: true });
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
            detail: { ...runError, tabId },
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
    const toolOnlyMessage = completedToolOnlyMessage(
      state
        ? [...state.completedToolsAfterLastAssistantText]
        : completedToolNamesAfterLastAssistantText(content),
    );
    if (toolOnlyMessage) {
      content.push({
        type: "text",
        text: toolOnlyMessage,
      });
      return {
        action: "done",
        result: {
          content: contentSnapshot(content),
          status: { type: "complete" as const, reason: "stop" as const },
          metadata: {
            custom: {
              runWarning: {
                message: toolOnlyMessage,
                errorCode: "final_response_missing_after_tool",
                recoverable: true,
              },
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
    if (part.type === "text" || part.type === "reasoning") {
      content.splice(index, 1);
      continue;
    }
    if (part.type === "tool-call" && part.result === undefined) {
      // Only drop ephemeral placeholders. Materialized in-flight tool cards
      // (real args from tool_start) stay mounted so a retry/auto-continue clear
      // does not hide→show the same call when the next chunk re-emits it.
      const isEphemeral =
        part.activity === true ||
        part.argsText === "" ||
        Object.keys(part.args ?? {}).length === 0;
      if (isEphemeral) content.splice(index, 1);
    }
  }
}

/**
 * Read and process SSE events from a ReadableStream response body.
 * Yields ChatModelRunResult for each meaningful event.
 *
 * When `runId` is provided, every yielded result carries
 * `metadata.custom.runId` so the UI can expose the trace ID via
 * "Copy Request ID" — including mid-stream, so users can grab it before
 * the run completes (or if the run hangs / ends prematurely).
 */
export async function* readSSEStream(
  body: ReadableStream<Uint8Array>,
  content: ContentPart[],
  toolCallCounter: { value: number },
  tabId: string | undefined,
  onSeq?: (seq: number) => void,
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
          noProgressTimeoutMs,
        );
      } catch (err) {
        if (err instanceof AgentAutoContinueSignal) {
          throw new AgentAutoContinueSignal({
            reason: err.reason,
            maxIterations: err.maxIterations,
            activityTrail: [...activityTrail],
            errorInfo: err.errorInfo,
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
        const now = Date.now();
        const actionPreparationProgress = updatePreparingActionState(
          preparingActionState,
          ev,
          now,
        );
        if (isMeaningfulProgressEvent(ev, actionPreparationProgress, options)) {
          sawProgressEvent = true;
          lastMeaningfulEventAt = now;
        }

        // Track sequence number for reconnection
        if (ev.seq !== undefined && onSeq) {
          onSeq(ev.seq);
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
        );

        if (result) yield withStreamMetadata(result);
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
        Date.now() - lastMeaningfulEventAt >= noProgressTimeoutMs
      ) {
        throw new AgentAutoContinueSignal({
          reason: "no_progress",
          activityTrail: [...activityTrail],
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

  // Stream ended without explicit done event. Even an empty content array is
  // abnormal here: a healthy run emits a terminal `done` event. Treat this as
  // recoverable so the adapter can first reconnect to the run, then continue
  // from durable history if the producer is gone.
  throw new AgentAutoContinueSignal({
    reason: "stream_ended",
    activityTrail: [...activityTrail],
  });
}

/**
 * Read raw SSE events from a ReadableStream and process them into ContentPart[].
 * Unlike readSSEStream, this doesn't yield ChatModelRunResult — it updates the
 * content array in-place and calls onUpdate for each meaningful change.
 * Designed for reconnection scenarios where we render outside assistant-ui's runtime.
 */
export async function readSSEStreamRaw(
  body: ReadableStream<Uint8Array>,
  content: ContentPart[],
  toolCallCounter: { value: number },
  tabId: string | undefined,
  onUpdate: (content: ContentPart[]) => void,
  onSeq?: (seq: number) => void,
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
  };
  // Tracks whether the most recent content state was already pushed via
  // onUpdate inside the loop, so the post-loop flush below doesn't emit the
  // identical content a second time when the stream closes without a terminal
  // event.
  let emittedLatestContent = false;

  try {
    while (true) {
      let readResult: ReadableStreamReadResult<Uint8Array>;
      try {
        readResult = await readChunkWithProgressTimeout(
          reader,
          lastMeaningfulEventAt,
          noProgressTimeoutMs,
        );
      } catch (err) {
        if (err instanceof AgentAutoContinueSignal) {
          throw new AgentAutoContinueSignal({
            reason: err.reason,
            maxIterations: err.maxIterations,
            activityTrail: [...activityTrail],
            errorInfo: err.errorInfo,
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
        const now = Date.now();
        const actionPreparationProgress = updatePreparingActionState(
          preparingActionState,
          ev,
          now,
        );
        if (isMeaningfulProgressEvent(ev, actionPreparationProgress, options)) {
          sawProgressEvent = true;
          lastMeaningfulEventAt = now;
        }

        if (ev.seq !== undefined && onSeq) {
          onSeq(ev.seq);
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
        Date.now() - lastMeaningfulEventAt >= noProgressTimeoutMs
      ) {
        throw new AgentAutoContinueSignal({
          reason: "no_progress",
          activityTrail: [...activityTrail],
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
  throw new AgentAutoContinueSignal({ reason: "stream_ended" });
}
