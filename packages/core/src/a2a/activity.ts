import { sanitizeToolErrorText } from "../agent/tool-error-redaction.js";
import type { AgentChatEvent } from "../agent/types.js";
import { redactArgsToJson, redactTextToSummary } from "../audit/redact.js";
import type { DataPart, Part } from "./types.js";

export const A2A_AGENT_ACTIVITY_KIND = "agent-native/agent-activity";
export const A2A_AGENT_ACTIVITY_VERSION = 1;
export const MAX_A2A_ACTIVITY_REASONING_CHARS = 32_768;
export const MAX_A2A_ACTIVITY_RESPONSE_CHARS = 32_768;
export const MAX_A2A_ACTIVITY_REASONING_SEGMENTS = 128;
export const MAX_A2A_ACTIVITY_TOOL_CALLS = 64;
export const MAX_A2A_ACTIVITY_TOOL_NAME_CHARS = 96;
export const MAX_A2A_ACTIVITY_TOOL_ID_CHARS = 128;
export const MAX_A2A_ACTIVITY_TOOL_INPUT_CHARS = 1024;
export const MAX_A2A_ACTIVITY_TOOL_RESULT_CHARS = 512;
/**
 * Shared ceiling for every recorded tool input/result across the snapshot. The
 * per-call caps alone allow 64 × 1536 chars, which would push a busy run past
 * `MAX_A2A_ACTIVITY_TOTAL_CHARS` and make `parseA2AAgentActivityPart` reject
 * the whole snapshot — trading missing arguments for a missing trace.
 */
export const MAX_A2A_ACTIVITY_TOOL_PAYLOAD_CHARS = 16_384;
export const MAX_A2A_ACTIVITY_TOTAL_CHARS =
  98_304 + MAX_A2A_ACTIVITY_TOOL_PAYLOAD_CHARS;

export type A2AAgentActivityPhase =
  | "reasoning"
  | "tool"
  | "responding"
  | "complete"
  | "error";

export type A2AAgentActivityToolStatus = "running" | "completed" | "failed";

export interface A2AAgentActivityToolCall {
  name: string;
  id?: string;
  status: A2AAgentActivityToolStatus;
  /**
   * Redacted, size-capped JSON of the call's arguments. Absent when the call
   * had none, or when the snapshot's shared payload budget was already spent.
   */
  input?: string;
  /** Redacted, size-capped head of the tool result (`tool_done` only). */
  result?: string;
}

export interface A2AAgentActivitySnapshot extends Record<string, unknown> {
  kind: typeof A2A_AGENT_ACTIVITY_KIND;
  version: typeof A2A_AGENT_ACTIVITY_VERSION;
  sequence: number;
  startedAt: number;
  updatedAt: number;
  durationMs: number;
  activePhase: A2AAgentActivityPhase;
  reasoning: string[];
  toolCalls: A2AAgentActivityToolCall[];
  /** Response text segments, indexed by how many tool calls preceded them. */
  response?: string[];
  /** Tail segment only. Kept so peers predating `response` still render. */
  responseText?: string;
}

export interface A2AAgentActivityState {
  sequence: number;
  startedAt: number;
  updatedAt: number;
  activePhase: A2AAgentActivityPhase;
  reasoning: string[];
  toolCalls: A2AAgentActivityToolCall[];
  response: string[];
}

export function createA2AAgentActivityState(
  startedAt = Date.now(),
): A2AAgentActivityState {
  return {
    sequence: 0,
    startedAt,
    updatedAt: startedAt,
    activePhase: "reasoning",
    reasoning: [],
    toolCalls: [],
    response: [],
  };
}

/**
 * Converts internal loop events into a bounded activity snapshot. Reasoning
 * text is carried verbatim (it was already emitted to the local chat); tool
 * arguments and results are carried only in redacted, size-capped form so the
 * delegated run stays diagnosable without the snapshot becoming a secondary
 * store of secrets or payloads.
 */
export function applyA2AAgentActivityEvent(
  state: A2AAgentActivityState,
  event: AgentChatEvent,
  updatedAt = Date.now(),
): A2AAgentActivityState {
  const next = { ...state, updatedAt: normalizeTimestamp(updatedAt) };
  let changed = false;

  switch (event.type) {
    case "thinking":
      next.activePhase = "reasoning";
      next.reasoning = appendBoundedSegment(
        next.reasoning,
        event.text,
        MAX_A2A_ACTIVITY_REASONING_CHARS,
        next.toolCalls.length,
      );
      changed = true;
      break;
    case "tool_start": {
      next.activePhase = "tool";
      const input = captureToolInput(
        event.input,
        remainingPayloadBudget(next.toolCalls),
      );
      next.toolCalls = appendToolCall(next.toolCalls, {
        ...toolFromEvent(event),
        ...(input ? { input } : {}),
      });
      changed = true;
      break;
    }
    case "tool_done":
      next.activePhase = "tool";
      next.toolCalls = settleToolCall(
        next.toolCalls,
        toolFromEvent(event),
        event,
      );
      changed = true;
      break;
    case "text":
      next.activePhase = "responding";
      next.response = appendBoundedSegment(
        next.response,
        event.text,
        MAX_A2A_ACTIVITY_RESPONSE_CHARS,
        next.toolCalls.length,
      );
      changed = true;
      break;
    case "done":
      next.activePhase = "complete";
      changed = true;
      break;
    case "error":
      next.activePhase = "error";
      changed = true;
      break;
    case "clear":
      next.response = [];
      changed = true;
      break;
  }

  return changed ? { ...next, sequence: state.sequence + 1 } : state;
}

export function buildA2AAgentActivitySnapshot(
  state: A2AAgentActivityState,
): A2AAgentActivitySnapshot {
  return {
    kind: A2A_AGENT_ACTIVITY_KIND,
    version: A2A_AGENT_ACTIVITY_VERSION,
    sequence: state.sequence,
    startedAt: state.startedAt,
    updatedAt: state.updatedAt,
    durationMs: Math.max(0, state.updatedAt - state.startedAt),
    activePhase: state.activePhase,
    reasoning: state.reasoning,
    toolCalls: state.toolCalls,
    ...(state.response.length ? { response: state.response } : {}),
    ...(tailSegment(state) ? { responseText: tailSegment(state) } : {}),
  };
}

function tailSegment(state: A2AAgentActivityState): string {
  return state.response[state.toolCalls.length] ?? "";
}

export function buildA2AAgentActivityPart(
  state: A2AAgentActivityState,
): DataPart {
  return { type: "data", data: buildA2AAgentActivitySnapshot(state) };
}

export function parseA2AAgentActivityPart(
  part: Part | unknown,
): A2AAgentActivitySnapshot | null {
  if (!part || typeof part !== "object") return null;
  const candidate = part as { type?: unknown; data?: unknown };
  if (candidate.type !== "data" || !isRecord(candidate.data)) return null;
  const data = candidate.data;
  if (
    data.kind !== A2A_AGENT_ACTIVITY_KIND ||
    data.version !== A2A_AGENT_ACTIVITY_VERSION ||
    !isSafeInteger(data.sequence) ||
    !isSafeInteger(data.startedAt) ||
    !isSafeInteger(data.updatedAt) ||
    !isSafeInteger(data.durationMs) ||
    !isPhase(data.activePhase) ||
    data.updatedAt < data.startedAt ||
    data.durationMs !== data.updatedAt - data.startedAt ||
    !isSafeSegments(data.reasoning, MAX_A2A_ACTIVITY_REASONING_CHARS) ||
    !isSafeToolCalls(data.toolCalls) ||
    (data.response !== undefined &&
      !isSafeSegments(data.response, MAX_A2A_ACTIVITY_RESPONSE_CHARS)) ||
    (data.responseText !== undefined &&
      !isSafeText(data.responseText, MAX_A2A_ACTIVITY_RESPONSE_CHARS)) ||
    activityCharacterCount(data) > MAX_A2A_ACTIVITY_TOTAL_CHARS
  ) {
    return null;
  }

  return data as unknown as A2AAgentActivitySnapshot;
}

function toolFromEvent(
  event: Extract<AgentChatEvent, { type: "tool_start" | "tool_done" }>,
): A2AAgentActivityToolCall {
  const id = sanitizeToolId(event.id);
  return {
    name: sanitizeToolName(event.tool),
    ...(id ? { id } : {}),
    status:
      event.type === "tool_start"
        ? "running"
        : event.isError
          ? "failed"
          : "completed",
  };
}

function payloadChars(tool: A2AAgentActivityToolCall): number {
  return (tool.input?.length ?? 0) + (tool.result?.length ?? 0);
}

function remainingPayloadBudget(
  current: A2AAgentActivityToolCall[],
  excludeIndex = -1,
): number {
  const used = current.reduce(
    (total, tool, index) =>
      index === excludeIndex ? total : total + payloadChars(tool),
    0,
  );
  return Math.max(0, MAX_A2A_ACTIVITY_TOOL_PAYLOAD_CHARS - used);
}

/**
 * Redacted, capped JSON of the arguments, or `undefined` when there is nothing
 * to record or the shared budget cannot fit a whole (still-parseable) capture.
 * A partial JSON string would be worse than none — the reader could not tell a
 * clipped object from a different one.
 */
function captureToolInput(input: unknown, budget: number): string | undefined {
  const cap = Math.min(MAX_A2A_ACTIVITY_TOOL_INPUT_CHARS, budget);
  if (cap < MAX_A2A_ACTIVITY_TOOL_INPUT_CHARS / 8) return undefined;
  const json = redactArgsToJson(input, { maxJson: cap, maxString: 256 });
  // JSON.stringify escapes control characters, so the result is already safe
  // for the snapshot without a `sanitizeText` pass — which would rewrite
  // `"token":"[redacted]"` into unparseable JSON.
  if (!json || json === "{}" || json.length > cap) return undefined;
  return json;
}

function captureToolResult(
  result: string | undefined,
  budget: number,
): string | undefined {
  const cap = Math.min(MAX_A2A_ACTIVITY_TOOL_RESULT_CHARS, budget);
  if (!result || cap <= 0) return undefined;
  const summary = redactTextToSummary(result, cap);
  return summary ? sanitizeText(summary, cap) || undefined : undefined;
}

function appendBoundedSegment(
  current: string[],
  addition: string,
  maxChars: number,
  precedingToolCount: number,
): string[] {
  const used = current.reduce((total, text) => total + text.length, 0);
  if (
    used >= maxChars ||
    current.length >= MAX_A2A_ACTIVITY_REASONING_SEGMENTS
  ) {
    return current;
  }
  const text = sanitizeText(addition, maxChars - used);
  if (!text) return current;
  const next = [...current];
  while (
    next.length < precedingToolCount &&
    next.length < MAX_A2A_ACTIVITY_REASONING_SEGMENTS
  ) {
    next.push("");
  }
  if (next.length === precedingToolCount) {
    return [...next, text];
  }
  next[precedingToolCount] = `${next[precedingToolCount] ?? ""}${text}`;
  return next;
}

function appendToolCall(
  current: A2AAgentActivityToolCall[],
  tool: A2AAgentActivityToolCall,
): A2AAgentActivityToolCall[] {
  return current.length < MAX_A2A_ACTIVITY_TOOL_CALLS
    ? [...current, tool]
    : current;
}

function settleToolCall(
  current: A2AAgentActivityToolCall[],
  tool: A2AAgentActivityToolCall,
  event: Extract<AgentChatEvent, { type: "tool_done" }>,
): A2AAgentActivityToolCall[] {
  for (let index = current.length - 1; index >= 0; index -= 1) {
    const existing = current[index];
    if (
      (tool.id && tool.id === existing.id) ||
      (!tool.id && tool.name === existing.name)
    ) {
      // The matching `tool_start` already paid for its input; reuse it rather
      // than re-capturing (and re-charging) the same arguments.
      let budget = remainingPayloadBudget(current, index);
      const input =
        existing.input ?? captureToolInput(event.input, budget) ?? undefined;
      budget -= input?.length ?? 0;
      const result = captureToolResult(event.result, budget);
      const settled: A2AAgentActivityToolCall = {
        ...tool,
        ...(input ? { input } : {}),
        ...(result ? { result } : {}),
      };
      return current.map((value, itemIndex) =>
        itemIndex === index ? settled : value,
      );
    }
  }
  let budget = remainingPayloadBudget(current);
  const input = captureToolInput(event.input, budget);
  budget -= input?.length ?? 0;
  const result = captureToolResult(event.result, budget);
  return appendToolCall(current, {
    ...tool,
    ...(input ? { input } : {}),
    ...(result ? { result } : {}),
  });
}

function sanitizeText(value: string, maxChars: number): string {
  return sanitizeToolErrorText(value)
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .slice(0, maxChars);
}

function sanitizeToolName(value: string): string {
  return sanitizeText(value, MAX_A2A_ACTIVITY_TOOL_NAME_CHARS) || "tool";
}

function sanitizeToolId(value: string | undefined): string | undefined {
  const sanitized = value
    ? sanitizeText(value, MAX_A2A_ACTIVITY_TOOL_ID_CHARS)
    : "";
  return sanitized || undefined;
}

function normalizeTimestamp(value: number): number {
  return isSafeInteger(value) ? value : Date.now();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isPhase(value: unknown): value is A2AAgentActivityPhase {
  return ["reasoning", "tool", "responding", "complete", "error"].includes(
    value as string,
  );
}

function isSafeSegments(value: unknown, maxChars: number): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= MAX_A2A_ACTIVITY_REASONING_SEGMENTS &&
    value.reduce(
      (total, text) =>
        total + (typeof text === "string" ? text.length : Infinity),
      0,
    ) <= maxChars &&
    value.every((text) => isSafeText(text, maxChars))
  );
}

function isSafeToolCalls(value: unknown): value is A2AAgentActivityToolCall[] {
  return (
    Array.isArray(value) &&
    value.length <= MAX_A2A_ACTIVITY_TOOL_CALLS &&
    value.every(isSafeToolCall)
  );
}

function isSafeToolCall(value: unknown): value is A2AAgentActivityToolCall {
  if (!isRecord(value) || !isSafeToolName(value.name)) return false;
  return (
    (value.id === undefined || isSafeToolId(value.id)) &&
    (value.input === undefined ||
      isSafeCapturedText(value.input, MAX_A2A_ACTIVITY_TOOL_INPUT_CHARS)) &&
    (value.result === undefined ||
      isSafeCapturedText(value.result, MAX_A2A_ACTIVITY_TOOL_RESULT_CHARS)) &&
    (value.status === "running" ||
      value.status === "completed" ||
      value.status === "failed")
  );
}

/**
 * Captured input/result are producer-side redacted strings. Unlike reasoning
 * text they are NOT re-sanitized on read: `sanitizeToolErrorText` rewrites
 * `"token":"…"` into unparseable JSON, so a round-trip equality check would
 * reject every legitimate capture. Bound the length and reject raw control
 * characters instead.
 */
function isSafeCapturedText(value: unknown, maxChars: number): value is string {
  return (
    typeof value === "string" &&
    value.length <= maxChars &&
    !/[\u0000-\u0008\u000b-\u001f\u007f]/.test(value)
  );
}

function isSafeText(value: unknown, maxChars: number): value is string {
  return (
    typeof value === "string" &&
    value.length <= maxChars &&
    value === sanitizeText(value, maxChars)
  );
}

function isSafeToolName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= MAX_A2A_ACTIVITY_TOOL_NAME_CHARS &&
    value === sanitizeToolName(value)
  );
}

function isSafeToolId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= MAX_A2A_ACTIVITY_TOOL_ID_CHARS &&
    value === sanitizeToolId(value)
  );
}

function activityCharacterCount(data: Record<string, unknown>): number {
  const reasoning = segmentCharacterCount(data.reasoning);
  // `responseText` duplicates the tail of `response`; counting both would
  // reject a snapshot that is within budget.
  const response = Array.isArray(data.response)
    ? segmentCharacterCount(data.response)
    : typeof data.responseText === "string"
      ? data.responseText.length
      : 0;
  const tools = Array.isArray(data.toolCalls)
    ? data.toolCalls.reduce((total, tool) => {
        if (!isRecord(tool)) return total;
        return (
          total +
          (typeof tool.name === "string" ? tool.name.length : 0) +
          (typeof tool.id === "string" ? tool.id.length : 0) +
          (typeof tool.input === "string" ? tool.input.length : 0) +
          (typeof tool.result === "string" ? tool.result.length : 0)
        );
      }, 0)
    : 0;
  return reasoning + response + tools;
}

function segmentCharacterCount(value: unknown): number {
  return Array.isArray(value)
    ? value.reduce(
        (total, text) => total + (typeof text === "string" ? text.length : 0),
        0,
      )
    : 0;
}
