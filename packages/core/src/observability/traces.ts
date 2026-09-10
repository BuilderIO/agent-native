import type {
  AgentLoopOutcome,
  AgentLoopUsage,
} from "../agent/production-agent.js";
import type { AgentChatEvent, AgentToolInput } from "../agent/types.js";
import { captureError } from "../server/capture-error.js";
import { getRequestContext } from "../server/request-context.js";
import {
  MAX_AI_CONTENT_BYTES,
  MAX_AI_SPANS_PER_RUN,
  boundAiContent,
  emitAiSpanEvent,
  emitAiTraceEvent,
  resolveAiError,
  toAiErrorDetail,
  toPostHogMessages,
} from "./posthog-ai.js";
import {
  type AgentSpan,
  endAgentSpan,
  startAgentSpan,
  withAgentSpanContext,
} from "./tracing.js";
import { trackingIdentityProperties } from "./tracking-identity.js";
import type { TraceSpan, TraceSummary, ObservabilityConfig } from "./types.js";

function spanId(): string {
  return `span-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function llmProviderFromEngine(
  engineName: string | undefined,
  model: string,
): string {
  const engine = engineName?.trim();
  if (engine?.startsWith("ai-sdk:")) return engine.slice("ai-sdk:".length);
  if (engine) return engine;
  if (/claude|anthropic/i.test(model)) return "anthropic";
  if (/gpt|openai|codex/i.test(model)) return "openai";
  if (/gemini|google/i.test(model)) return "google";
  return "unknown";
}

function costUsdFromCenticents(value: number): number {
  return Math.round((value / 10_000) * 1_000_000) / 1_000_000;
}

interface TimeInterval {
  start: number;
  end: number;
}

/**
 * Wall-clock time covered by these intervals, counting overlap once.
 *
 * Tools run concurrently, so summing durations reports more elapsed time than
 * actually passed — enough to drive a derived remainder to zero on a parallel
 * fan-out.
 */
function coveredDurationMs(intervals: TimeInterval[]): number {
  if (intervals.length === 0) return 0;
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  let covered = 0;
  let { start: openStart, end: openEnd } = sorted[0];
  for (const { start, end } of sorted.slice(1)) {
    if (start > openEnd) {
      covered += openEnd - openStart;
      openStart = start;
      openEnd = end;
    } else if (end > openEnd) {
      openEnd = end;
    }
  }
  return covered + (openEnd - openStart);
}

function spanIntervals(spans: TraceSpan[]): TimeInterval[] {
  return spans.map((s) => ({
    start: s.createdAt,
    end: s.createdAt + Math.max(0, s.durationMs),
  }));
}

/**
 * Project run metadata onto flat PostHog trace properties.
 *
 * Prefixed and shallow on purpose: this is operational context (which
 * automation, which trigger, which terminal state), never message content, and
 * nested objects in an analytics property are unqueryable anyway. Values are
 * bounded so a caller cannot turn a metadata bag into a payload channel.
 */
function aiTraceMetadataProperties(
  metadata: Record<string, unknown> | null,
): Record<string, unknown> {
  if (!metadata) return {};
  const properties: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (value === undefined || value === null) continue;
    const scalar =
      typeof value === "string"
        ? value.slice(0, 200)
        : typeof value === "number" || typeof value === "boolean"
          ? value
          : undefined;
    if (scalar === undefined) continue;
    properties[`run_${key}`] = scalar;
  }
  return properties;
}

const MAX_TRACKED_GENERATION_TOOL_CALLS = 50;

/**
 * `auto_continue` reasons the server PLANNED, which must not read as failures.
 *
 * A hosted foreground chunk ends at `run_timeout` roughly every 40s by design —
 * counting those as errors would bury the boundaries that mean something under
 * the ones that mean "working as intended". Every other reason is a boundary
 * something forced on the run: recoverable, but not normal, and it stays
 * visible as an error carrying its reason as the terminal code. Moving a reason
 * across this line changes what the error rate means, so move it deliberately.
 */
const EXPECTED_CONTINUATION_REASONS = new Set(["run_timeout", "auto_continue"]);
const MAX_TOOL_ERROR_MESSAGE_LENGTH = 500;
const HTTP_STATUS_OK = 200;

const STANDALONE_API_KEY_PATTERN =
  /\b(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{8,}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{8,}|AIza[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{16,})\b/g;

type GenerationToolCall = {
  name: string;
  started_offset_ms: number;
  duration_ms: number;
  status: "success" | "error";
  error_class: "tool_error" | "legacy_inferred_error" | "interrupted" | null;
  error_message?: string;
};

function truncateToolErrorMessage(value: string): string {
  return value.length > MAX_TOOL_ERROR_MESSAGE_LENGTH
    ? `${value.slice(0, MAX_TOOL_ERROR_MESSAGE_LENGTH)}…`
    : value;
}

function redactToolErrorMessage(value: string): string {
  const credentialName =
    "authorization|cookie|api[_ -]?key|password|secret|token|access[_ -]?token|refresh[_ -]?token";
  const labeledCredential = `(["']?\\b(?:${credentialName})\\b["']?\\s*[:=]\\s*["']?)`;
  return value
    .replace(
      new RegExp(
        `${labeledCredential}(?:Bearer|Basic)\\s+[^"'\\s,;)}\\]]+`,
        "gi",
      ),
      "$1[REDACTED]",
    )
    .replace(
      new RegExp(`${labeledCredential}[^"'\\s,;)}\\[\\]]+`, "gi"),
      "$1[REDACTED]",
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "[REDACTED]")
    .replace(STANDALONE_API_KEY_PATTERN, "[REDACTED]");
}

/**
 * Provider HTTP status of a failed model call, when the thrown error carries
 * one. `EngineError` sets `statusCode`; provider SDK errors (Anthropic,
 * OpenAI) use `status`. Anything else returns undefined rather than a guess —
 * PostHog reads `$ai_http_status`, and a fabricated 500 on a transport drop is
 * worse than no status at all.
 */
export function httpStatusFromError(err: unknown): number | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const candidate =
    (err as { statusCode?: unknown }).statusCode ??
    (err as { status?: unknown }).status;
  return typeof candidate === "number" && Number.isInteger(candidate)
    ? candidate
    : undefined;
}

function emitLlmGenerationTrackingEvent(args: {
  runId: string;
  threadId: string | null;
  userId: string | null;
  parentSpanId: string;
  llmSpanId: string;
  engineName: string | undefined;
  model: string;
  /**
   * Undefined means the engine never reported a usage figure for this run
   * (e.g. killed for silence before any provider response arrived) — not
   * that the count was zero. Callers must omit these from the emitted event
   * rather than coerce to 0; a coerced 0 is indistinguishable from a real
   * empty-input run and defeats analysis of failing runs by input size.
   */
  inputTokens: number | undefined;
  outputTokens: number | undefined;
  cacheReadTokens: number | undefined;
  cacheWriteTokens: number | undefined;
  /** Same "unknown vs zero" rule as the token fields — cost is derived from
   *  them and is equally unmeasurable when they were never reported. */
  costCentsX100: number | undefined;
  durationMs: number;
  /**
   * Wall-clock ms spent in the model. This is what `$ai_latency` reports, and
   * it is deliberately NOT `durationMs`.
   *
   * PostHog sums `$ai_latency` across a trace's direct children, and every
   * tool call is emitted as one of those children. Reporting the full run
   * duration here counted tool time twice and made the trace waterfall wider
   * than the run it describes.
   */
  llmDurationMs: number;
  /** False when `llmDurationMs` was derived by subtracting tool time from the
   *  run because the engine never bracketed its model calls. Emitted so a
   *  latency built on that estimate can be told apart from a measured one. */
  llmDurationMeasured: boolean;
  /** LLM round-trips in the run. Feeds `$ai_request_count`, which PostHog
   *  multiplies by per-request pricing — a hardcoded 1 undercharged every
   *  multi-step run on a request-priced model. */
  llmCallCount: number;
  /** Why the model stopped generating. PostHog's `$ai_stop_reason`; a
   *  `max_tokens` here is a truncated answer, which no other field reports. */
  stopReason?: string;
  /** Elapsed ms from run start to the first non-heartbeat engine event.
   *  Undefined when no such event ever arrived (the run never produced a
   *  token before being aborted) — never coerced to 0. */
  firstTokenMs: number | undefined;
  status: "success" | "error";
  errorMessage: string | null;
  /**
   * Provider HTTP status for this model call. 200 on a call that streamed to
   * completion; the reported status on one that failed. Undefined when the
   * call failed without a status the engine could name — omitted from the
   * event rather than sent as 200 or 500, either of which would make an
   * unclassifiable transport failure look like a known one.
   */
  httpStatus?: number;
  toolCalls: number;
  successfulTools: number;
  failedTools: number;
  tools: GenerationToolCall[];
  toolsTruncated: boolean;
  terminalOutcome?: AgentLoopOutcome;
  delegation?: {
    protocol: "a2a" | "mcp" | "agent-team";
    callerApp?: string;
    taskId?: string;
    parentRunId?: string;
    parentTurnId?: string;
  };
  createdAt: number;
  experimentAssignments?: Array<{
    experimentId: string;
    variantId: string;
  }>;
  modelSelectionSource?: string;
  /**
   * PostHog content fields. Each is `undefined` unless the matching capture
   * flag is on, and is then OMITTED from the event — never sent as `[]`, which
   * PostHog would render as "the model was called with no messages".
   */
  aiInput?: unknown;
  aiOutputChoices?: unknown;
  aiInputTruncated?: boolean;
  aiOutputTruncated?: boolean;
  browserSessionId?: string;
}): void {
  const provider = llmProviderFromEngine(args.engineName, args.model);
  const costUsd =
    args.costCentsX100 !== undefined
      ? costUsdFromCenticents(args.costCentsX100)
      : undefined;
  const totalTokens =
    args.inputTokens !== undefined && args.outputTokens !== undefined
      ? args.inputTokens + args.outputTokens
      : undefined;
  const error = args.errorMessage ?? undefined;
  const terminalCode =
    args.terminalOutcome?.state === "failed" ||
    args.terminalOutcome?.state === "input_required"
      ? args.terminalOutcome.code
      : undefined;
  const terminalRetryable =
    args.terminalOutcome?.state === "failed"
      ? args.terminalOutcome.retryable
      : undefined;
  const properties: Record<string, unknown> = {
    ...trackingIdentityProperties(),
    source: "agent_observability",
    span_type: "llm_call",
    run_id: args.runId,
    thread_id: args.threadId,
    parent_span_id: args.parentSpanId,
    span_id: args.llmSpanId,
    model: args.model,
    provider,
    input_tokens: args.inputTokens,
    output_tokens: args.outputTokens,
    total_tokens: totalTokens,
    cache_read_tokens: args.cacheReadTokens,
    cache_write_tokens: args.cacheWriteTokens,
    cost_cents_x100: args.costCentsX100,
    cost_usd: costUsd,
    duration_ms: args.durationMs,
    stop_reason: args.stopReason,
    time_to_first_token_ms: args.firstTokenMs,
    status: args.status,
    tool_calls: args.toolCalls,
    successful_tools: args.successfulTools,
    failed_tools: args.failedTools,
    tools: args.tools,
    tools_truncated: args.toolsTruncated,
    terminal_state: args.terminalOutcome?.state,
    terminal_code: terminalCode,
    terminal_retryable: terminalRetryable,
    delegated: args.delegation ? true : undefined,
    delegation_protocol: args.delegation?.protocol,
    caller_app: args.delegation?.callerApp,
    delegation_task_id: args.delegation?.taskId,
    a2a_task_id:
      args.delegation?.protocol === "a2a" ? args.delegation.taskId : undefined,
    parent_run_id: args.delegation?.parentRunId,
    parent_turn_id: args.delegation?.parentTurnId,
    model_selection_source: args.modelSelectionSource,
    created_at: new Date(args.createdAt).toISOString(),
    created_at_ms: args.createdAt,
    $ai_trace_id: args.runId,
    $ai_session_id: args.threadId ?? undefined,
    $ai_span_id: args.llmSpanId,
    $ai_span_name: args.model,
    // Parent is the run's trace, not the internal `agent_run` span id — the
    // latter is never emitted to PostHog, so pointing at it orphaned the
    // generation and PostHog rendered a placeholder trace around it.
    $ai_parent_id: args.runId,
    $ai_model: args.model,
    $ai_provider: provider,
    $ai_input_tokens: args.inputTokens,
    $ai_output_tokens: args.outputTokens,
    $ai_latency: Math.round(args.llmDurationMs) / 1000,
    $ai_is_error: args.status === "error",
    $ai_error: resolveAiError(
      args.status === "error",
      toAiErrorDetail(error, {
        state: args.terminalOutcome?.state,
        code: terminalCode,
        retryable: terminalRetryable,
      }),
    ),
    // A generation fails only as the model layer, so the default kind says so;
    // a classified terminal code names it more precisely.
    $ai_error_type:
      args.status === "error" ? (terminalCode ?? "llm_error") : undefined,
    // Every engine here streams (`messages.stream`, `streamText`, gateway SSE),
    // which is also what makes `$ai_time_to_first_token` meaningful.
    $ai_stream: true,
    $ai_cache_read_input_tokens: args.cacheReadTokens,
    $ai_cache_creation_input_tokens: args.cacheWriteTokens,
    $ai_request_count: args.llmCallCount,
    $ai_stop_reason: args.stopReason,
    $ai_http_status: args.httpStatus,
    $ai_total_cost_usd: costUsd,
    $ai_input: args.aiInput,
    $ai_output_choices: args.aiOutputChoices,
    input_truncated: args.aiInputTruncated || undefined,
    output_truncated: args.aiOutputTruncated || undefined,
    latency_source: args.llmDurationMeasured ? "measured" : "derived",
    // Seconds, per PostHog's schema — `time_to_first_token_ms` above is the
    // millisecond field this framework's own dashboards read.
    $ai_time_to_first_token:
      args.firstTokenMs === undefined
        ? undefined
        : Math.round(args.firstTokenMs) / 1000,
    $session_id: args.browserSessionId,
  };
  if (args.experimentAssignments?.length) {
    properties.experiment_ids = args.experimentAssignments
      .map((assignment) => assignment.experimentId)
      .join(",");
    properties.experiment_variants = args.experimentAssignments
      .map((assignment) => assignment.variantId)
      .join(",");
    if (args.experimentAssignments.length === 1) {
      properties.experiment_id = args.experimentAssignments[0].experimentId;
      properties.experiment_variant = args.experimentAssignments[0].variantId;
    }
  }
  if (error) properties.error_message = error;

  for (const key of Object.keys(properties)) {
    if (properties[key] === undefined) delete properties[key];
  }

  try {
    void import("../tracking/registry.js")
      .then(({ track }) => {
        track("$ai_generation", properties, {
          userId: args.userId ?? undefined,
          occurredAt: args.createdAt,
        });
      })
      .catch(() => {});
  } catch {
    // Tracking must never affect the agent run or trace persistence.
  }
}

/**
 * Build the PostHog content fields for one `$ai_generation`.
 *
 * One generation per model round-trip: `messages` is what that call was sent,
 * `assistantText` what it answered, and `toolSpans` the tools it then asked
 * for. An engine that never brackets its calls with `model_stream` has no
 * round-trips to split on and falls back to a single generation covering the
 * whole run — an aggregate, and reported as one.
 *
 * `$ai_output_choices` is emitted whenever tool calls happened even with
 * `capturePrompts` off, because PostHog derives `$ai_tools_called` /
 * `$ai_tool_call_count` from tool-call blocks inside it and nothing else. The
 * assistant's text content stays gated; only the structural call list ships.
 *
 * The app's tool DEFINITIONS are not sent at all. They are the same catalogue
 * on every call — tens of kilobytes of descriptions — and a call is already
 * identified by its name in `tool_calls` and by its own span.
 */

function buildGenerationContent(args: {
  config: ObservabilityConfig;
  messages: unknown;
  assistantText: string;
  toolSpans: TraceSpan[];
  /** Tool span id → the id the MODEL used for that call. See below. */
  toolCallIds: Map<string, string>;
}): {
  aiInput?: unknown;
  aiOutputChoices?: unknown;
  aiInputTruncated?: boolean;
  aiOutputTruncated?: boolean;
} {
  const { config } = args;

  // `$ai_input` is the conversation, not the system prompt. PostHog accepts a
  // `system` role, but the prompt is app configuration rather than content and
  // is near-identical on every run — shipping it would repeat kilobytes on each
  // generation for no analytical gain.
  //
  // Normalized before bounding: the byte ceiling rescues the last `user`
  // message, and in engine shape every tool result is one.
  const input = config.capturePrompts
    ? boundAiContent(toPostHogMessages(redactSensitiveFields(args.messages)))
    : undefined;

  const toolCalls = args.toolSpans
    .slice(0, MAX_TRACKED_GENERATION_TOOL_CALLS)
    .map((span) => ({
      type: "function" as const,
      // The id the MODEL issued, which is what the matching `tool` message in
      // `$ai_input` carries as `tool_call_id`. Our span id is a different
      // namespace: emitting it here left PostHog with a call and a result that
      // never paired, so every tool call rendered with no output. The span id
      // remains the fallback for engines that report no call id.
      id: args.toolCallIds.get(span.id) ?? span.id,
      function: {
        name: span.name,
        // Already redacted at span construction, and only present when
        // `captureToolArgs` is on.
        ...((span.metadata as { input?: unknown } | null)?.input !== undefined
          ? { arguments: (span.metadata as { input?: unknown }).input }
          : {}),
      },
    }));

  const hasChoice = config.capturePrompts || toolCalls.length > 0;
  const output = hasChoice
    ? boundAiContent([
        {
          role: "assistant",
          ...(config.capturePrompts
            ? { content: redactToolErrorMessage(args.assistantText) }
            : {}),
          ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
        },
      ])
    : undefined;

  return {
    aiInput: input?.value,
    aiOutputChoices: output?.value,
    aiInputTruncated: input?.truncated,
    aiOutputTruncated: output?.truncated,
  };
}

/** Keys whose values are stripped from persisted tool inputs when
 *  `captureToolArgs` is enabled. Matched case-insensitively and tolerant
 *  of `_` / `-` separators. M14 in the MCP/A2A audit: tool calls
 *  routinely receive credentials verbatim (db-exec INSERTs, fetchTool
 *  Authorization headers, ad-hoc bearer tokens) — keeping those values
 *  out of agent_trace_spans.metadata avoids long-term storage of
 *  short-lived secrets. */
const SENSITIVE_FIELD_PATTERN =
  /^(authorization|cookie|api[_-]?key|password|secret|token|access[_-]?token|refresh[_-]?token|bearer)$/i;

/** Recursively walk a structured value and replace sensitive field
 *  values with the literal string "[REDACTED]". Pure (returns a copy);
 *  the original input is never mutated. Cycles are tolerated via a
 *  small WeakSet seen-tracker that returns "[Circular]" for repeats. */
export function redactSensitiveFields(value: unknown): unknown {
  return redactWalk(value, new WeakSet<object>());
}

function redactWalk(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value as object)) return "[Circular]";
  seen.add(value as object);
  if (Array.isArray(value)) {
    return value.map((v) => redactWalk(v, seen));
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_FIELD_PATTERN.test(k)) {
      out[k] = "[REDACTED]";
    } else {
      out[k] = redactWalk(v, seen);
    }
  }
  return out;
}

export async function getObservabilityConfig(): Promise<ObservabilityConfig> {
  const { getAppConfig } = await import("../app-config/store.js");
  const config = getAppConfig().observability;
  const { resolveInferredSentimentConfig } = await import("./sentiment.js");
  // Sentiment keeps its own resolver as the top layer: it derives a default
  // from whether this is a first-party hosted deployment, which no declared
  // default can express.
  return { ...config, ...resolveInferredSentimentConfig(config) };
}

export async function instrumentAgentLoop(opts: {
  runAgentLoop: (loopOpts: {
    engine: any;
    model: string;
    systemPrompt: string;
    tools: any[];
    messages: any[];
    actions: Record<string, any>;
    send: (event: AgentChatEvent) => void;
    signal: AbortSignal;
    onUsage?: (usage: AgentLoopUsage) => void;
    onOutcome?: (outcome: AgentLoopOutcome) => void;
    providerOptions?: any;
    runId?: string;
  }) => Promise<AgentLoopUsage>;
  loopOpts: {
    engine: any;
    model: string;
    systemPrompt: string;
    tools: any[];
    messages: any[];
    actions: Record<string, any>;
    send: (event: AgentChatEvent) => void;
    signal: AbortSignal;
    onUsage?: (usage: AgentLoopUsage) => void;
    onOutcome?: (outcome: AgentLoopOutcome) => void;
    providerOptions?: any;
    runId?: string;
  };
  runId: string;
  threadId: string | null;
  /** Owner of this run; persisted on every span + summary so dashboard
   *  reads can filter to a single user. Null for unauthenticated callers
   *  (background tasks, etc.) — those rows aren't returned by per-user
   *  reads. */
  userId: string | null;
  config: ObservabilityConfig;
  /**
   * Name for this run's root span, in the local trace store and in PostHog LLM
   * analytics. Defaults to `"agent_run"`. Without it every path emits the same
   * name and a scheduled automation is indistinguishable from a chat turn in
   * the one view where telling them apart is the whole question.
   */
  spanName?: string;
  /**
   * Free-form run context. Persisted onto the local store's parent span AND
   * forwarded to PostHog as trace properties — a channel that reached only the
   * SQL store was a channel that could not answer "which automation was this?"
   * in LLM analytics.
   */
  metadata?: Record<string, unknown> | null;
  experimentAssignments?: Array<{
    experimentId: string;
    variantId: string;
  }>;
  modelSelectionSource?: string;
  delegation?: {
    protocol: "a2a" | "mcp" | "agent-team";
    callerApp?: string;
    taskId?: string;
    parentRunId?: string;
    parentTurnId?: string;
  };
  /** Raw user-authored message before prompt/context enrichment. */
  sentimentInput?: string;
  /**
   * Browser session id of the request that started this run, when it came from
   * a page. Emitted as PostHog's `$session_id` so agent traces join to session
   * replay — distinct from `$ai_session_id`, which is the thread.
   *
   * Defaults to the in-flight request context, which the agent-chat route
   * populates from the `X-Agent-Native-Session-Id` header.
   */
  browserSessionId?: string;
  classifyError?: (error: unknown) =>
    | {
        status?: "success" | "error";
        errorMessage?: string | null;
        metadata?: Record<string, unknown> | null;
      }
    | null
    | undefined;
}): Promise<AgentLoopUsage> {
  const { runAgentLoop, loopOpts, runId, threadId, userId, config } = opts;
  const spanName = opts.spanName?.trim() || "agent_run";
  const runStart = Date.now();
  const parentSpanId = spanId();
  const precedingResponsePromise =
    config.inferredSentimentEnabled && opts.sentimentInput && threadId && userId
      ? import("./store.js")
          .then(({ getLatestTraceSummaryForThread }) =>
            getLatestTraceSummaryForThread(threadId, {
              userId,
              excludeRunId: runId,
            }),
          )
          .catch(() => null)
      : Promise.resolve(null);

  // Falls back to the in-flight request so callers deep in the agent stack
  // don't have to thread it down by hand.
  const browserSessionId =
    opts.browserSessionId ?? getRequestContext()?.browserSessionId;

  // Optional OpenTelemetry root span for this run. No-ops unless a host has
  // installed `@opentelemetry/api` and registered a provider. The root is
  // installed as the active context while the loop runs so child tool/model
  // spans have a real parent relationship in the exported trace.
  const otelRunSpanPromise = startAgentSpan("agent.run", {
    "agent.run_id": runId,
    "agent.thread_id": threadId ?? undefined,
    "agent.user_id": userId ?? undefined,
    "agent.model": loopOpts.model,
    "agent.model_selection_source": opts.modelSelectionSource,
    "agent.experiment_id":
      opts.experimentAssignments?.length === 1
        ? opts.experimentAssignments[0].experimentId
        : undefined,
    "agent.experiment_variant":
      opts.experimentAssignments?.length === 1
        ? opts.experimentAssignments[0].variantId
        : undefined,
  });
  let otelRunSpan: AgentSpan | null = null;

  const spans: TraceSpan[] = [];
  let toolInvocationCounter = 0;
  // Keyed by counter to handle concurrent calls to the same tool name
  const pendingTools = new Map<
    number,
    {
      spanId: string;
      callId?: string;
      startMs: number;
      toolName: string;
      input: AgentToolInput;
      otelSpan: AgentSpan | null;
      endResult?: { status: "success" | "error"; errorMessage: string | null };
    }
  >();
  // Secondary index for legacy emitters without call ids. Current tool events
  // are paired by id first; same-name FIFO remains as a compatibility fallback.
  const toolNameToCounters = new Map<string, number[]>();
  const toolCallIdToCounter = new Map<string, number>();
  const generationToolCalls = new Map<number, GenerationToolCall>();
  // Assistant text, accumulated only when prompt capture is on so a disabled
  // config never holds message content in memory in the first place.
  const assistantTextParts: string[] = [];
  let assistantTextLength = 0;

  let toolCallCount = 0;
  let successfulTools = 0;
  let failedTools = 0;
  /** Tools that reported a failure of their own, excluding the ones the run's
   *  death interrupted — those are a consequence of the failure, never
   *  evidence of what caused it. */
  let reportedToolFailures = 0;

  // One `model_stream` start/end bracket is emitted per LLM round-trip, and it
  // closes before any tool of that turn is started — so these intervals ARE the
  // model's wall clock, not an estimate of it. Recording them is what lets each
  // generation report a measured `$ai_latency` instead of backing tool time out
  // of the run duration, and what makes a round-trip the unit PostHog draws:
  // one `$ai_generation` per model call, with that call's tools underneath it.
  // Engines that never bracket their calls record none, and the run falls back
  // to a single aggregate generation.
  const modelRoundTrips: Array<{
    spanId: string;
    start: number;
    end: number;
    usage?: AgentLoopUsage;
    /** Why the model stopped: `end_turn`, `tool_use`, `max_tokens`, … Absent
     *  when the stream was cut before the engine reported one. */
    stopReason?: string;
    /** Messages as they stood when this call was made. Only when
     *  `capturePrompts` is on; the array is copied because the loop appends to
     *  it in place as the run continues. */
    input?: unknown[];
    assistantText: string[];
  }> = [];
  /** The call currently streaming, or the last one that streamed — text and
   *  usage arriving between calls belong to the call that just finished. */
  const currentRoundTrip = () => modelRoundTrips[modelRoundTrips.length - 1];
  type CostCalculator = (
    inputTokens: number,
    outputTokens: number,
    model: string,
    cacheReadTokens?: number,
    cacheWriteTokens?: number,
  ) => number;
  let calculateCost: CostCalculator | undefined;
  const calculateUsageCost = (
    callUsage: AgentLoopUsage | undefined,
  ): number | undefined => {
    if (!calculateCost || !callUsage) return undefined;
    try {
      return calculateCost(
        callUsage.inputTokens,
        callUsage.outputTokens,
        callUsage.model,
        callUsage.cacheReadTokens,
        callUsage.cacheWriteTokens,
      );
    } catch {
      // coercion-ok: cost estimation is enrichment and cannot fail tracing.
      return undefined;
    }
  };
  type OtelModelSpanEndResult = {
    status: "success" | "error";
    errorMessage: string | null;
    attributes: Record<string, string | number | boolean | null | undefined>;
    endTime?: number;
  };
  const pendingOtelModelSpans = new Map<
    number,
    {
      spanPromise: Promise<AgentSpan | null>;
      span: AgentSpan | null;
      endResult?: OtelModelSpanEndResult;
      ended: boolean;
    }
  >();
  const openOtelModelSpans = new Set<AgentSpan>();
  const modelSpansAwaitingFinalError = new Set<number>();
  const modelSpanAttributes = (index: number) => {
    const trip = modelRoundTrips[index];
    const callUsage = trip?.usage;
    return {
      "llm.model": callUsage?.model ?? loopOpts.model,
      "llm.call_index": index,
      "llm.stop_reason": trip?.stopReason,
      "llm.input_tokens": callUsage?.inputTokens,
      "llm.output_tokens": callUsage?.outputTokens,
      "llm.cache_read_tokens": callUsage?.cacheReadTokens,
      "llm.cache_write_tokens": callUsage?.cacheWriteTokens,
      "llm.cost_cents_x100": calculateUsageCost(callUsage),
    };
  };
  const startOtelModelSpan = (index: number): void => {
    const entry = {
      spanPromise: Promise.resolve(null) as Promise<AgentSpan | null>,
      span: null as AgentSpan | null,
      endResult: undefined as OtelModelSpanEndResult | undefined,
      ended: false,
    };
    entry.spanPromise = startAgentSpan(
      "llm.call",
      {
        "llm.model": loopOpts.model,
        "llm.call_index": index,
      },
      otelRunSpan,
    );
    pendingOtelModelSpans.set(index, entry);
    void entry.spanPromise.then((span) => {
      if (!span || entry.ended) return;
      if (entry.endResult) {
        entry.ended = true;
        endAgentSpan(span, entry.endResult);
      } else {
        entry.span = span;
        openOtelModelSpans.add(span);
      }
    });
  };
  const finishOtelModelSpan = (
    index: number,
    result: OtelModelSpanEndResult,
  ): void => {
    const entry = pendingOtelModelSpans.get(index);
    if (!entry || entry.ended) return;
    entry.endResult = result;
    if (!entry.span) return;
    entry.ended = true;
    openOtelModelSpans.delete(entry.span);
    endAgentSpan(entry.span, result);
  };
  const finishAwaitingOtelModelSpans = (
    finalErrorMessage: string | null = null,
  ): void => {
    for (const tripIndex of modelSpansAwaitingFinalError) {
      finishOtelModelSpan(tripIndex, {
        status: "error",
        errorMessage:
          finalErrorMessage ?? "Model stream ended before completion.",
        attributes: modelSpanAttributes(tripIndex),
        endTime: modelRoundTrips[tripIndex]?.end,
      });
    }
    modelSpansAwaitingFinalError.clear();
  };
  const modelStreamIntervals: TimeInterval[] = [];
  let modelStreamOpenedAt: number | null = null;
  /** Tool span id → the round-trip that requested it. */
  const toolSpanRoundTrip = new Map<string, number>();
  /** Tool invocation counter → the same, for the generation's `tools` list. */
  const toolCounterRoundTrip = new Map<number, number>();
  /** Tool span id → how it failed. A class, not the tool's output, so it
   *  travels even when `captureToolResults` withholds the message. */
  const toolSpanErrorClass = new Map<string, string>();
  /** Tool span id → the id the MODEL gave that call. The two namespaces are
   *  separate, and only the model's appears in the transcript — so it is the
   *  one that pairs a `tool_calls` entry with its `tool` message. Empty for
   *  legacy emitters that send no call id. */
  const toolSpanCallId = new Map<string, string>();

  // Track in-flight OTel tool spans so they're all ended even if the loop
  // throws before a matching `tool_done` arrives.
  const openOtelToolSpans = new Set<AgentSpan>();
  let usage: AgentLoopUsage | undefined;
  let runStatus: "success" | "error" = "success";
  let errorMessage: string | null = null;
  let runMetadata: Record<string, unknown> | null = opts.metadata ?? null;
  let terminalOutcome: AgentLoopOutcome | undefined;
  // Provider HTTP status of the model call that ended the run, when the engine
  // reported one. Stays undefined for a failure that never carried a status (a
  // transport drop, an SDK throw) — an unknown status must not read as 200.
  let errorHttpStatus: number | undefined;
  // The `auto_continue` boundary this run ended at, if any. A cut-off never
  // reaches the loop's outcome classification (`runAgentLoop` returns early at
  // the checkpoint), so without this the run reports no terminal state at all
  // and the reason is recoverable only from `agent_run_events` in Postgres.
  let cutOffReason: string | null = null;

  const instrumentedOutcome = (outcome: AgentLoopOutcome): void => {
    terminalOutcome = outcome;
    if (outcome.state === "completed") {
      runStatus = "success";
      errorMessage = null;
    } else {
      runStatus = "error";
      errorMessage =
        outcome.state === "canceled"
          ? (outcome.message ?? "Agent run was canceled.")
          : outcome.message;
    }
    runMetadata = {
      ...(runMetadata ?? {}),
      terminal_state: outcome.state,
      ...("code" in outcome ? { terminal_code: outcome.code } : {}),
      ...(outcome.state === "failed"
        ? { terminal_retryable: outcome.retryable }
        : {}),
    };
    try {
      loopOpts.onOutcome?.(outcome);
    } catch {
      // Observability adapters cannot alter the agent run.
    }
  };

  const instrumentedSend = (event: AgentChatEvent): void => {
    try {
      if (
        config.capturePrompts &&
        event.type === "text" &&
        assistantTextLength < MAX_AI_CONTENT_BYTES
      ) {
        assistantTextParts.push(event.text);
        assistantTextLength += event.text.length;
        currentRoundTrip()?.assistantText.push(event.text);
      }
      // Some guardrails intentionally stop the loop by emitting a terminal
      // event and returning usage instead of throwing. Preserve that terminal
      // state in telemetry so a tripwire/loop-limit/provider error cannot be
      // counted as a successful delegated generation. A later clear/done means
      // the wrapper recovered and finished cleanly, so reset in that case.
      if (event.type === "clear" || event.type === "done") {
        finishAwaitingOtelModelSpans();
        runStatus = "success";
        errorMessage = null;
        cutOffReason = null;
      } else if (event.type === "auto_continue") {
        const reason = event.reason || "auto_continue";
        cutOffReason = reason;
        if (!EXPECTED_CONTINUATION_REASONS.has(reason)) {
          runStatus = "error";
          errorMessage = `Agent run was cut off before finishing (${reason}).`;
        }
      } else if (event.type === "error") {
        runStatus = "error";
        errorMessage = event.error;
      } else if (event.type === "tripwire") {
        runStatus = "error";
        errorMessage = event.reason;
      } else if (event.type === "loop_limit") {
        runStatus = "error";
        errorMessage = "Agent stopped at the loop limit";
      } else if (event.type === "missing_api_key") {
        runStatus = "error";
        errorMessage = "Missing API key";
      }
      if (event.type === "model_stream") {
        // The emitter brackets these itself, so a repeated start or an
        // unmatched end is a no-op here rather than a fabricated interval.
        if (event.status === "start") {
          // A reasonless closure is emitted before the agent loop decides
          // whether to retry. If another attempt starts, the old attempt is
          // definitely final and must not span the retry backoff.
          finishAwaitingOtelModelSpans();
          if (modelStreamOpenedAt === null) {
            modelStreamOpenedAt = Date.now();
            const tripIndex = modelRoundTrips.length;
            modelRoundTrips.push({
              spanId: spanId(),
              start: modelStreamOpenedAt,
              end: modelStreamOpenedAt,
              // Copied: the loop appends this call's answer and its tool
              // results to the same array as the run continues, so a reference
              // held here would report the whole transcript as this call's
              // prompt.
              //
              // This is the loop's message list, which is not byte-for-byte
              // what the engine received: Context X-Ray, observational memory
              // and overflow trimming build a separate `contextMessages` for
              // the provider. Reporting a prompt the model never saw is a
              // known gap, and closing it needs the loop to hand its
              // per-call request to instrumentation.
              ...(config.capturePrompts
                ? { input: [...loopOpts.messages] }
                : {}),
              assistantText: [],
            });
            startOtelModelSpan(tripIndex);
          }
        } else if (modelStreamOpenedAt !== null) {
          const end = Date.now();
          modelStreamIntervals.push({ start: modelStreamOpenedAt, end });
          const tripIndex = modelRoundTrips.length - 1;
          const trip = currentRoundTrip();
          if (trip) {
            trip.end = end;
            if (event.reason) trip.stopReason = event.reason;
          }
          if (event.reason === undefined || event.reason === "error") {
            // The engine emits this from a `finally`, before the outer catch
            // has classified a provider error. Defer ending the span so that
            // the real error message wins over a generic stream-ended value.
            modelSpansAwaitingFinalError.add(tripIndex);
          }
          modelStreamOpenedAt = null;
        }
      }

      if (event.type === "tool_start") {
        const counter = toolInvocationCounter++;
        const sid = spanId();
        // Recorded here, not at `tool_done`: a tool the run's death interrupts
        // never reaches that path, and would then hang under the trace root
        // instead of the call that asked for it. The model_stream bracket
        // closes before the turn's tools start, so the last round-trip is the
        // requesting call.
        if (modelRoundTrips.length > 0) {
          toolSpanRoundTrip.set(sid, modelRoundTrips.length - 1);
          toolCounterRoundTrip.set(counter, modelRoundTrips.length - 1);
        }
        // Start the OTel tool span synchronously-ish: kick off the async
        // resolution and stash the span once it lands. Tool spans are short
        // and the api tracer is synchronous in practice, but we tolerate the
        // microtask gap by recording the span on the pending entry when ready.
        const entry: {
          spanId: string;
          callId?: string;
          startMs: number;
          toolName: string;
          input: AgentToolInput;
          otelSpan: AgentSpan | null;
          // Set by the done handler if it fires before the span promise
          // resolves, so the resolved span is ended with the correct status.
          endResult?: {
            status: "success" | "error";
            errorMessage: string | null;
          };
        } = {
          spanId: sid,
          ...(event.id ? { callId: event.id } : {}),
          startMs: Date.now(),
          toolName: event.tool,
          input: event.input,
          otelSpan: null,
        };
        pendingTools.set(counter, entry);
        if (event.id) toolCallIdToCounter.set(event.id, counter);
        void startAgentSpan(
          "tool.call",
          {
            "tool.name": event.tool,
          },
          otelRunSpan,
        ).then((span) => {
          if (!span) return;
          // If `tool_done` already ran for this call, end the span now with the
          // status it recorded; otherwise stash it for the done handler.
          if (entry.endResult) {
            endAgentSpan(span, {
              status: entry.endResult.status,
              errorMessage: entry.endResult.errorMessage,
            });
          } else {
            entry.otelSpan = span;
            openOtelToolSpans.add(span);
          }
        });
        const queue = toolNameToCounters.get(event.tool);
        if (queue) queue.push(counter);
        else toolNameToCounters.set(event.tool, [counter]);
      } else if (event.type === "tool_done") {
        const queue = toolNameToCounters.get(event.tool);
        const counterFromId = event.id
          ? toolCallIdToCounter.get(event.id)
          : undefined;
        const legacyQueueIndex =
          event.id && counterFromId === undefined && queue
            ? queue.findIndex(
                (candidate) => !pendingTools.get(candidate)?.callId,
              )
            : -1;
        const counter =
          counterFromId ??
          (event.id
            ? legacyQueueIndex >= 0
              ? queue?.[legacyQueueIndex]
              : undefined
            : queue?.shift());
        const pending =
          counter !== undefined ? pendingTools.get(counter) : undefined;
        if (counter !== undefined) {
          pendingTools.delete(counter);
          if (pending?.callId) toolCallIdToCounter.delete(pending.callId);
          if ((counterFromId !== undefined || legacyQueueIndex >= 0) && queue) {
            const queueIndex = queue.indexOf(counter);
            if (queueIndex >= 0) queue.splice(queueIndex, 1);
          }
          if (queue && queue.length === 0)
            toolNameToCounters.delete(event.tool);
        }
        toolCallCount++;

        const finishedAt = Date.now();

        const explicitError = event.isError === true;
        const isError =
          typeof event.isError === "boolean"
            ? event.isError
            : typeof event.result === "string" &&
              (event.result.startsWith("Error") ||
                event.result.startsWith("Error running "));
        if (isError) {
          failedTools++;
          reportedToolFailures++;
        } else successfulTools++;

        if (
          counter !== undefined &&
          counter < MAX_TRACKED_GENERATION_TOOL_CALLS &&
          pending
        ) {
          generationToolCalls.set(counter, {
            name: pending.toolName,
            started_offset_ms: Math.max(0, pending.startMs - runStart),
            duration_ms: Math.max(0, finishedAt - pending.startMs),
            status: isError ? "error" : "success",
            error_class: !isError
              ? null
              : explicitError
                ? "tool_error"
                : "legacy_inferred_error",
            error_message:
              isError && config.captureToolResults
                ? truncateToolErrorMessage(redactToolErrorMessage(event.result))
                : undefined,
          });
        }

        // Finalize the OTel tool span. If the span promise hasn't resolved yet
        // we record the result on the entry so its `.then` handler ends it.
        const otelEndResult = {
          status: (isError ? "error" : "success") as "success" | "error",
          errorMessage: isError ? (event.result as string) : null,
        };
        if (pending?.otelSpan) {
          openOtelToolSpans.delete(pending.otelSpan);
          endAgentSpan(pending.otelSpan, {
            status: otelEndResult.status,
            errorMessage: otelEndResult.errorMessage,
            attributes: { "tool.name": event.tool },
          });
        } else if (pending) {
          pending.endResult = otelEndResult;
        }

        const spanMetadataFields: Record<string, unknown> = {};
        if (config.captureToolArgs && pending) {
          // Strip Authorization/api-key/token-shaped values before persisting
          // (M14 in the MCP/A2A audit). Tool-runtime execution still sees the
          // unredacted input — only the long-lived span row is sanitized.
          spanMetadataFields.input = redactSensitiveFields(pending.input);
        }
        // A failed tool's content reaches the span through `errorMessage`; a
        // successful one had nowhere to go, so every healthy tool span shipped
        // an input and no output — indistinguishable from a tool that returned
        // nothing. Same redaction and truncation as the error path.
        if (
          !isError &&
          config.captureToolResults &&
          typeof event.result === "string"
        ) {
          spanMetadataFields.output = truncateToolErrorMessage(
            redactToolErrorMessage(event.result),
          );
        }
        const spanMetadata = Object.keys(spanMetadataFields).length
          ? spanMetadataFields
          : null;

        const toolSpanId = pending?.spanId ?? spanId();
        const modelCallId = pending?.callId ?? event.id;
        if (modelCallId) toolSpanCallId.set(toolSpanId, modelCallId);
        // The model_stream bracket closes before the turn's tools start, so the
        // last recorded round-trip is the call that requested this one.
        if (isError) {
          toolSpanErrorClass.set(
            toolSpanId,
            explicitError ? "tool_error" : "legacy_inferred_error",
          );
        }
        const span: TraceSpan = {
          id: toolSpanId,
          runId,
          threadId,
          userId,
          parentSpanId,
          spanType: "tool_call",
          name: event.tool,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          costCentsX100: 0,
          durationMs: pending ? Math.max(0, finishedAt - pending.startMs) : 0,
          status: isError ? "error" : "success",
          errorMessage: isError ? event.result : null,
          metadata: spanMetadata,
          // The span's start, not its completion: `durationMs` is measured from
          // here, so stamping the end instead places the tool after the run
          // ended in any timeline that plots start + duration.
          createdAt: pending?.startMs ?? finishedAt,
        };
        spans.push(span);
      }
    } catch {}

    loopOpts.send(event);
  };

  // The loop appends to this array in place — its own assistant turns, tool
  // results, internal continuation prompts. Read after the run it is the final
  // transcript, not the request, so the model's reply showed up inside
  // `$ai_input` as well as `$ai_output_choices`. Snapshot the array before the
  // loop can grow it. The message objects stay shared on purpose: the last user
  // message is enriched in place (screen context, @-mention responses), and the
  // enriched text is what the model actually received.
  const requestMessages = Array.isArray(loopOpts.messages)
    ? [...loopOpts.messages]
    : loopOpts.messages;

  try {
    otelRunSpan = await otelRunSpanPromise;
    usage = await withAgentSpanContext(otelRunSpan, () =>
      runAgentLoop({
        ...loopOpts,
        runId,
        send: instrumentedSend,
        onOutcome: instrumentedOutcome,
        // Fires once per model round-trip with THAT call's tokens, not the
        // running total — which is what lets each generation report its own.
        onUsage: (callUsage: AgentLoopUsage) => {
          const trip = currentRoundTrip();
          if (trip) trip.usage = callUsage;
          loopOpts.onUsage?.(callUsage);
        },
      }),
    );
  } catch (err: any) {
    const classification = opts.classifyError?.(err) ?? null;
    runStatus = classification?.status ?? "error";
    errorMessage =
      classification?.errorMessage === undefined
        ? (err?.message ?? String(err))
        : classification.errorMessage;
    errorHttpStatus = httpStatusFromError(err);
    const errorMetadata = classification?.metadata ?? null;
    runMetadata =
      runMetadata || errorMetadata
        ? { ...(runMetadata ?? {}), ...(errorMetadata ?? {}) }
        : null;
    throw err;
  } finally {
    // A throw from inside a `finally` REPLACES whatever the block was doing —
    // including a successful return — so an assembly failure here (a content
    // builder tripping on an odd payload, a span mapper on a malformed tool
    // result) would report a completed run as a failed one, and a failed run
    // with the wrong error. Every emit below already guards itself; this guards
    // the assembly between them, so the module's contract holds without each
    // future line having to remember it.
    try {
      const runEnd = Date.now();
      const totalDurationMs = runEnd - runStart;

      // The loop threw or was killed mid-stream, so no `end` ever arrived. The
      // model was still running when the run stopped, so the interval closes at
      // the run's end rather than being dropped.
      const failedInsideModelCall = modelStreamOpenedAt !== null;
      const interruptedModelRoundTrip =
        modelStreamOpenedAt !== null && modelRoundTrips.length > 0
          ? modelRoundTrips.length - 1
          : null;
      if (modelStreamOpenedAt !== null) {
        modelStreamIntervals.push({ start: modelStreamOpenedAt, end: runEnd });
        const trip = currentRoundTrip();
        if (trip) trip.end = runEnd;
        modelStreamOpenedAt = null;
      }
      // Undefined means the engine never bracketed its model calls, NOT that
      // the model took no time — the two must stay distinguishable, because
      // only the first may fall back to backing tool time out of the run.
      const measuredModelDurationMs = modelStreamIntervals.length
        ? coveredDurationMs(modelStreamIntervals)
        : undefined;

      if (pendingTools.size > 0) {
        if (runStatus === "success") {
          runStatus = "error";
          errorMessage ??= "Agent run ended with interrupted tool calls";
        }
        for (const [counter, pending] of pendingTools) {
          toolCallCount += 1;
          failedTools += 1;
          const interruptedMessage = "Tool call interrupted before completion";
          toolSpanErrorClass.set(pending.spanId, "interrupted");
          if (counter < MAX_TRACKED_GENERATION_TOOL_CALLS) {
            generationToolCalls.set(counter, {
              name: pending.toolName,
              started_offset_ms: Math.max(0, pending.startMs - runStart),
              duration_ms: Math.max(0, runEnd - pending.startMs),
              status: "error",
              error_class: "interrupted",
              error_message: config.captureToolResults
                ? interruptedMessage
                : undefined,
            });
          }
          if (pending.otelSpan) {
            openOtelToolSpans.delete(pending.otelSpan);
            endAgentSpan(pending.otelSpan, {
              status: "error",
              errorMessage: interruptedMessage,
              attributes: { "tool.name": pending.toolName },
            });
          } else {
            pending.endResult = {
              status: "error",
              errorMessage: interruptedMessage,
            };
          }
          spans.push({
            id: pending.spanId,
            runId,
            threadId,
            userId,
            parentSpanId,
            spanType: "tool_call",
            name: pending.toolName,
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            costCentsX100: 0,
            durationMs: Math.max(0, runEnd - pending.startMs),
            status: "error",
            errorMessage: interruptedMessage,
            metadata: null,
            createdAt: pending.startMs,
          });
        }
        pendingTools.clear();
        toolNameToCounters.clear();
        toolCallIdToCounter.clear();
      }

      let costCentsX100 = 0;
      // Held for the per-generation costs below, which price each round-trip
      // from its own tokens rather than splitting the run total.
      try {
        ({ calculateCost } = await import("../usage/store.js"));
        if (usage) {
          costCentsX100 = calculateCost(
            usage.inputTokens,
            usage.outputTokens,
            usage.model,
            usage.cacheReadTokens,
            usage.cacheWriteTokens,
          );
        }
        // Cost estimation is enrichment: a pricing-table miss leaves the span
        // without a cost rather than failing the trace.
      } catch {} // coercion-ok: see above

      // A cut-off run never reaches the loop's outcome classification, so stand in
      // for it here rather than reporting no terminal state at all. `failed` +
      // `retryable` is the honest encoding available in `AgentLoopOutcome`: the
      // turn did not finish, and the continuation machinery is expected to
      // recover it. A real reported outcome always wins.
      const effectiveTerminalOutcome: AgentLoopOutcome | undefined =
        terminalOutcome ??
        (cutOffReason && !EXPECTED_CONTINUATION_REASONS.has(cutOffReason)
          ? {
              state: "failed",
              code: cutOffReason,
              retryable: true,
              message: `Agent run was cut off before finishing (${String(cutOffReason)}).`,
            }
          : undefined);

      const collectedToolSpans = spans.filter(
        (s) => s.spanType === "tool_call",
      );
      // Resolved before the generation event, not just before the span events:
      // the generation's latency is the run minus the tool time PostHog will
      // actually see, so it has to be computed against the same set. Tools
      // dropped by `captureLlmSpans` or the per-run cap have no sibling span to
      // hold their time, and subtracting them would lose it from the trace.
      const emittedToolSpans = (
        config.captureLlmSpans ? collectedToolSpans : []
      ).slice(0, MAX_AI_SPANS_PER_RUN);
      const droppedToolSpans =
        (config.captureLlmSpans ? collectedToolSpans.length : 0) -
        emittedToolSpans.length;

      // Elapsed to the run's first engine event. Belongs to the run, and is
      // reported on its first generation as PostHog's per-call field.
      const runFirstTokenMs =
        usage?.firstEngineEventAtMs !== undefined
          ? Math.max(0, usage.firstEngineEventAtMs - runStart)
          : undefined;

      const modelCallFailed =
        failedInsideModelCall ||
        (modelRoundTrips.length === 0 &&
          cutOffReason === null &&
          reportedToolFailures === 0);

      let llmCallCount = 0;
      if (usage || runStatus === "error") {
        llmCallCount =
          usage?.llmCalls ??
          // Compatibility for custom loop implementations that predate the
          // attempt counter: observed brackets still count every attempt.
          (modelRoundTrips.length > 0 ? modelRoundTrips.length : 1);
        const runUsage = usage ?? {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          model: loopOpts.model,
        };
        // The engine never reported a `usage` event for this run (killed for
        // silence before any provider response, or the loop threw before
        // returning). `runUsage`'s token fields are placeholder zeros in that
        // case, not measured values — the tracking events below must omit them
        // rather than report a fabricated 0.
        const usageReported = usage?.usageReported === true;
        const engineName =
          typeof loopOpts.engine?.name === "string"
            ? loopOpts.engine.name
            : undefined;
        // Measured model time when the engine bracketed its round-trips.
        //
        // The fallback backs tool time out of the run instead, which is an
        // estimate and behaves like one: it has to net out overlapping tools,
        // skip tools PostHog will not receive, and clamp at zero. Engines that
        // report `model_stream` need none of that, so `latency_source` records
        // which of the two a given `$ai_latency` came from.
        const derivedLlmDurationMs =
          measuredModelDurationMs ??
          Math.max(
            0,
            totalDurationMs -
              coveredDurationMs(spanIntervals(emittedToolSpans)),
          );

        // One generation per model round-trip, so a trace reads as the run
        // actually happened: call, its tools, next call. An engine that never
        // brackets its calls records no round-trips and falls back to a single
        // generation covering the run — an aggregate, and visibly one.
        const generations =
          modelRoundTrips.length > 0
            ? modelRoundTrips.map((trip, index) => ({
                spanId: trip.spanId,
                model: trip.usage?.model ?? runUsage.model,
                createdAt: trip.start,
                latencyMs: Math.max(0, trip.end - trip.start),
                callUsage: trip.usage,
                stopReason: trip.stopReason,
                // The engine reported this call's usage as the call happened,
                // so its presence IS the report — the loop's aggregate return
                // value never arrives when a later call throws, and gating on
                // it dropped the tokens of every call that had succeeded.
                tokensKnown: trip.usage !== undefined,
                input: trip.input,
                assistantText: trip.assistantText.join(""),
                toolSpans: collectedToolSpans.filter(
                  (span) => toolSpanRoundTrip.get(span.id) === index,
                ),
                toolDetails: [...generationToolCalls.entries()]
                  .filter(
                    ([counter]) => toolCounterRoundTrip.get(counter) === index,
                  )
                  .sort(([a], [b]) => a - b)
                  .map(([, detail]) => detail),
                isFirst: index === 0,
                // Only the last call can carry the run's failure: an earlier
                // one that had failed would have ended the run there.
                isLast: index === modelRoundTrips.length - 1,
              }))
            : [
                {
                  spanId: spanId(),
                  model: runUsage.model,
                  createdAt: runStart,
                  latencyMs: derivedLlmDurationMs,
                  callUsage: usage,
                  stopReason: undefined as string | undefined,
                  tokensKnown: usageReported,
                  input: requestMessages,
                  assistantText: assistantTextParts.join(""),
                  toolSpans: collectedToolSpans,
                  toolDetails: [...generationToolCalls.entries()]
                    .sort(([a], [b]) => a - b)
                    .map(([, detail]) => detail),
                  isFirst: true,
                  isLast: true,
                },
              ];

        for (const generation of generations) {
          const callUsage = generation.callUsage;
          let callCostCentsX100: number | undefined;
          if (calculateCost && callUsage && generation.tokensKnown) {
            try {
              callCostCentsX100 = calculateCost(
                callUsage.inputTokens,
                callUsage.outputTokens,
                callUsage.model,
                callUsage.cacheReadTokens,
                callUsage.cacheWriteTokens,
              );
              // Cost estimation is enrichment: a pricing-table miss leaves the
              // generation without a cost rather than failing the trace.
            } catch {} // coercion-ok: see above
          }
          // `$ai_is_error` on a generation means the MODEL call failed —
          // a provider error, a dropped stream, an SDK throw. A tool that
          // aborted the run, a step budget or a cut-off is the trace's failure
          // (and the tool span's), and painting the last generation red hides
          // which layer actually broke.
          //
          // Two ways to know it was the model: the run died with this call's
          // stream still open, or the engine never bracketed its calls at all
          // and nothing else can account for the failure — no run boundary, no
          // failed tool.
          const generationStatus =
            // The engine reported this call itself as failed. Its bracket
            // closes on the way out, so waiting for an open stream at
            // finalization would report a provider error as a healthy call —
            // and a later retry would leave the failed attempt green.
            generation.stopReason === "error" ||
            (generation.isLast && runStatus === "error" && modelCallFailed)
              ? "error"
              : "success";
          const generationError =
            generationStatus === "error" ? errorMessage : null;
          const generationContent = buildGenerationContent({
            config,
            messages: generation.input,
            assistantText: generation.assistantText,
            toolSpans: generation.toolSpans,
            toolCallIds: toolSpanCallId,
          });

          spans.push({
            id: generation.spanId,
            runId,
            threadId,
            userId,
            parentSpanId,
            spanType: "llm_call",
            name: generation.model,
            inputTokens: callUsage?.inputTokens ?? 0,
            outputTokens: callUsage?.outputTokens ?? 0,
            cacheReadTokens: callUsage?.cacheReadTokens ?? 0,
            cacheWriteTokens: callUsage?.cacheWriteTokens ?? 0,
            costCentsX100: callCostCentsX100 ?? 0,
            durationMs: generation.latencyMs,
            status: generationStatus,
            errorMessage: generationError,
            metadata: null,
            createdAt: generation.createdAt,
          });

          emitLlmGenerationTrackingEvent({
            runId,
            threadId,
            userId,
            parentSpanId,
            llmSpanId: generation.spanId,
            engineName,
            model: generation.model,
            inputTokens: generation.tokensKnown
              ? callUsage?.inputTokens
              : undefined,
            outputTokens: generation.tokensKnown
              ? callUsage?.outputTokens
              : undefined,
            cacheReadTokens: generation.tokensKnown
              ? callUsage?.cacheReadTokens
              : undefined,
            cacheWriteTokens: generation.tokensKnown
              ? callUsage?.cacheWriteTokens
              : undefined,
            costCentsX100: callCostCentsX100,
            durationMs: generation.latencyMs,
            llmDurationMs: generation.latencyMs,
            llmDurationMeasured: measuredModelDurationMs !== undefined,
            stopReason: generation.stopReason,
            // One request per generation now. `$ai_request_count` is what
            // PostHog multiplies by per-request pricing, so it counts this
            // call, not the run.
            llmCallCount: modelRoundTrips.length > 0 ? 1 : llmCallCount,
            firstTokenMs: generation.isFirst ? runFirstTokenMs : undefined,
            status: generationStatus,
            errorMessage: generationError,
            // A generation that streamed to completion answered 200; only the
            // call the run died in can claim the thrown error's status, and
            // only when the engine reported one.
            httpStatus:
              generationStatus === "error" ? errorHttpStatus : HTTP_STATUS_OK,
            toolCalls: generation.toolSpans.length,
            successfulTools: generation.toolSpans.filter(
              (span) => span.status === "success",
            ).length,
            failedTools: generation.toolSpans.filter(
              (span) => span.status === "error",
            ).length,
            tools: generation.toolDetails,
            toolsTruncated:
              toolInvocationCounter > MAX_TRACKED_GENERATION_TOOL_CALLS,
            // Only the layer that failed carries the run's terminal outcome;
            // on a healthy call `terminal_state: failed` reads as this call
            // having failed.
            terminalOutcome:
              generationStatus === "error"
                ? effectiveTerminalOutcome
                : undefined,
            delegation: opts.delegation,
            createdAt: generation.createdAt,
            experimentAssignments: opts.experimentAssignments,
            modelSelectionSource: opts.modelSelectionSource,
            browserSessionId,
            ...generationContent,
          });
        }
      }

      const parentSpan: TraceSpan = {
        id: parentSpanId,
        runId,
        threadId,
        userId,
        parentSpanId: null,
        spanType: "agent_run",
        name: spanName,
        inputTokens: usage?.inputTokens ?? 0,
        outputTokens: usage?.outputTokens ?? 0,
        cacheReadTokens: usage?.cacheReadTokens ?? 0,
        cacheWriteTokens: usage?.cacheWriteTokens ?? 0,
        costCentsX100,
        durationMs: totalDurationMs,
        status: runStatus,
        errorMessage,
        metadata: runMetadata,
        createdAt: runStart,
      };
      spans.push(parentSpan);

      // PostHog LLM analytics: the run is a `$ai_trace`, each tool call an
      // `$ai_span` under it. Emitted from the collected spans rather than from a
      // second instrumentation pass, so the tree PostHog shows and the tree we
      // persist cannot drift apart.
      try {
        const aiError =
          runStatus === "error"
            ? toAiErrorDetail(errorMessage, {
                state: effectiveTerminalOutcome?.state,
                code:
                  effectiveTerminalOutcome?.state === "failed" ||
                  effectiveTerminalOutcome?.state === "input_required"
                    ? effectiveTerminalOutcome.code
                    : undefined,
                retryable:
                  effectiveTerminalOutcome?.state === "failed"
                    ? effectiveTerminalOutcome.retryable
                    : undefined,
              })
            : undefined;
        const provider = llmProviderFromEngine(
          typeof loopOpts.engine?.name === "string"
            ? loopOpts.engine.name
            : undefined,
          usage?.model ?? loopOpts.model,
        );

        emitAiTraceEvent({
          runId,
          threadId,
          userId,
          spanName,
          model: usage?.model ?? loopOpts.model,
          provider,
          durationMs: totalDurationMs,
          isError: runStatus === "error",
          error: aiError,
          // What ended the run: our own budget or timeout (`run_timeout`,
          // `no_progress`), a terminal outcome code, or a failure with neither.
          errorType:
            runStatus === "error"
              ? (cutOffReason ??
                (effectiveTerminalOutcome?.state === "failed" ||
                effectiveTerminalOutcome?.state === "input_required"
                  ? effectiveTerminalOutcome.code
                  : undefined) ??
                effectiveTerminalOutcome?.state)
              : undefined,
          inputTokens: usage?.usageReported ? usage.inputTokens : undefined,
          outputTokens: usage?.usageReported ? usage.outputTokens : undefined,
          costUsd: usage?.usageReported
            ? costUsdFromCenticents(costCentsX100)
            : undefined,
          createdAt: runStart,
          browserSessionId,
          extraProperties: {
            ...trackingIdentityProperties(),
            source: "agent_observability",
            run_id: runId,
            thread_id: threadId,
            // Run totals. Each generation counts only the call it describes, so
            // without these the run-level numbers would have to be summed back
            // out of the children.
            llm_calls: llmCallCount || undefined,
            tool_calls: toolCallCount,
            successful_tools: successfulTools,
            failed_tools: failedTools,
            time_to_first_token_ms: runFirstTokenMs,
            latency_source:
              measuredModelDurationMs !== undefined ? "measured" : "derived",
            ...aiTraceMetadataProperties(runMetadata),
            // Present for planned boundaries too, which are not errors: the ratio
            // of run_timeout to no_progress is the signal, and it is unreadable
            // if only one side of it is recorded.
            ...(cutOffReason ? { terminal_reason: cutOffReason } : {}),
            // A truncated run must not read as a complete one.
            ...(droppedToolSpans > 0
              ? {
                  spans_dropped: droppedToolSpans,
                  spans_emitted: emittedToolSpans.length,
                }
              : {}),
          },
        });

        for (const span of emittedToolSpans) {
          // `span.errorMessage` is the raw tool result. It routinely contains
          // upstream response bodies with Authorization headers and standalone
          // API keys, so it gets the same redaction + bounding the generation
          // event's `tools[].error_message` already applies, and the same
          // `captureToolResults` gate — exporting it here otherwise reintroduced
          // the leak that gate exists to prevent. `$ai_is_error` still marks the
          // failure when the content is withheld.
          const toolErrorMessage =
            span.status === "error" &&
            span.errorMessage &&
            config.captureToolResults
              ? truncateToolErrorMessage(
                  redactToolErrorMessage(span.errorMessage),
                )
              : undefined;
          // "Withheld" and "never reported" are different failures to debug,
          // and a span that says only `$ai_is_error` tells the reader neither.
          const toolErrorDetail =
            span.status !== "error"
              ? undefined
              : toolErrorMessage
                ? toAiErrorDetail(toolErrorMessage)
                : span.errorMessage
                  ? {
                      message:
                        "error text withheld: captureToolResults is off for this app",
                    }
                  : undefined;
          // The same distinction on the output side, which had no marker at
          // all: a span with no `$ai_output_state` reads in PostHog as a tool
          // that returned nothing, and that is what "the tool output is
          // missing" looks like to a reader who has not seen this config. The
          // tool DID answer — this app does not export what it said.
          const toolOutputState = config.captureToolResults
            ? (toolErrorMessage ??
              (span.metadata as { output?: unknown } | null)?.output)
            : "[tool result withheld: captureToolResults is off for this app]";

          const requestingGeneration = toolSpanRoundTrip.get(span.id);
          emitAiSpanEvent({
            runId,
            threadId,
            userId,
            spanId: span.id,
            // Under the generation that asked for it, so PostHog draws the run
            // as call → tools → call. Falls back to the trace root when the
            // engine never bracketed its model calls and there is no
            // generation to hang the tool under.
            parentId:
              requestingGeneration !== undefined
                ? modelRoundTrips[requestingGeneration]?.spanId
                : undefined,
            spanName: span.name,
            latencySeconds: Math.round(span.durationMs) / 1000,
            isError: span.status === "error",
            error: toolErrorDetail,
            errorType: toolSpanErrorClass.get(span.id),
            createdAt: span.createdAt,
            browserSessionId,
            // `metadata.input` / `metadata.output` are already redacted and
            // only present when `captureToolArgs` / `captureToolResults` are
            // on; absent stays absent.
            inputState: (span.metadata as { input?: unknown } | null)?.input,
            outputState: toolOutputState,
            extraProperties: {
              ...trackingIdentityProperties(),
              source: "agent_observability",
              span_type: "tool_call",
            },
          });
        }
        // coercion-ok: a throw here would skip trace persistence below
      } catch {
        // LLM analytics must never affect the run or trace persistence.
      }

      const summary: TraceSummary = {
        runId,
        threadId,
        userId,
        totalSpans: spans.length,
        llmCalls: llmCallCount,
        toolCalls: toolCallCount,
        successfulTools,
        failedTools,
        totalDurationMs,
        totalCostCentsX100: costCentsX100,
        totalInputTokens: usage?.inputTokens ?? 0,
        totalOutputTokens: usage?.outputTokens ?? 0,
        model: usage?.model ?? loopOpts.model,
        createdAt: runStart,
      };

      writeTraceData(spans, summary, runId, config).catch(() => {});

      // OpenTelemetry export (no-op unless a provider is registered). Bracketed
      // model calls have already emitted live spans; engines without brackets
      // get one aggregate generation. End any tool/model spans still open and
      // then end the run span. Awaited so spans are emitted before return.
      try {
        if (interruptedModelRoundTrip !== null) {
          finishOtelModelSpan(interruptedModelRoundTrip, {
            status: "error",
            errorMessage:
              errorMessage ?? "Model stream interrupted before completion.",
            attributes: modelSpanAttributes(interruptedModelRoundTrip),
            endTime: runEnd,
          });
        }
        for (const [tripIndex, trip] of modelRoundTrips.entries()) {
          if (trip.stopReason && trip.stopReason !== "error") {
            finishOtelModelSpan(tripIndex, {
              status: "success",
              errorMessage: null,
              attributes: modelSpanAttributes(tripIndex),
              endTime: trip.end,
            });
          }
        }
        finishAwaitingOtelModelSpans(errorMessage);
        await Promise.all(
          [...pendingOtelModelSpans.values()].map((entry) => entry.spanPromise),
        );
        if (usage && modelRoundTrips.length === 0) {
          const aggregateLlmSpan = await withAgentSpanContext(otelRunSpan, () =>
            startAgentSpan("llm.call", {}, otelRunSpan),
          );
          endAgentSpan(aggregateLlmSpan, {
            status: runStatus,
            errorMessage,
            attributes: {
              "llm.model": usage.model,
              "llm.input_tokens": usage.inputTokens,
              "llm.output_tokens": usage.outputTokens,
              "llm.cache_read_tokens": usage.cacheReadTokens,
              "llm.cache_write_tokens": usage.cacheWriteTokens,
              "llm.cost_cents_x100": costCentsX100,
            },
          });
        }
        for (const modelSpan of openOtelModelSpans) {
          endAgentSpan(modelSpan, {
            status: "error",
            errorMessage: "Agent run ended before model_stream completed.",
          });
        }
        openOtelModelSpans.clear();
        for (const toolSpan of openOtelToolSpans) {
          endAgentSpan(toolSpan, {
            status: "error",
            errorMessage: "Agent run ended before tool_done.",
          });
        }
        openOtelToolSpans.clear();
        endAgentSpan(otelRunSpan, {
          status: runStatus,
          errorMessage,
          attributes: {
            "agent.llm_calls": llmCallCount,
            "agent.tool_calls": toolCallCount,
            "agent.successful_tools": successfulTools,
            "agent.failed_tools": failedTools,
            "agent.duration_ms": totalDurationMs,
            "agent.input_tokens": usage?.inputTokens ?? 0,
            "agent.output_tokens": usage?.outputTokens ?? 0,
            "agent.cost_cents_x100": costCentsX100,
            "agent.terminal_state": effectiveTerminalOutcome?.state,
            "agent.terminal_code":
              effectiveTerminalOutcome?.state === "failed" ||
              effectiveTerminalOutcome?.state === "input_required"
                ? effectiveTerminalOutcome.code
                : undefined,
          },
        });
        // coercion-ok: OTel export must never break the run.
      } catch {
        // OTel export must never break the run.
      }
    } catch (instrumentationError) {
      // Deliberately not rethrown and deliberately not silent: the run's own
      // outcome stands, and the telemetry failure is reported as its own.
      captureError(instrumentationError, {
        tags: { source: "agent-observability", phase: "trace-finalize" },
        aiTraceId: runId,
        extra: { runId, threadId },
      });
    }
  }

  // Classify only after the main loop has finished so the tiny managed Luna
  // request cannot contend with the user's response for a gateway slot. This
  // short, awaited tail keeps serverless runtimes alive long enough to emit the
  // event, while the response content has already streamed to the client.
  if (usage && opts.sentimentInput) {
    try {
      const precedingResponse = await precedingResponsePromise;
      if (precedingResponse) {
        const { inferAndTrackSentiment } = await import("./sentiment.js");
        await inferAndTrackSentiment({
          classifierModel: config.inferredSentimentModel,
          precedingResponseModel: precedingResponse.model,
          text: opts.sentimentInput,
          precedingRunId: precedingResponse.runId,
          classificationTriggerRunId: runId,
          threadId,
          userId,
          sampleRate: config.inferredSentimentSampleRate,
        });
      }
    } catch {
      // Optional inference must never alter the result of the main run.
    }
  }

  return usage!;
}

async function writeTraceData(
  spans: TraceSpan[],
  summary: TraceSummary,
  runId: string,
  config: ObservabilityConfig,
): Promise<void> {
  const { insertTraceSpan, upsertTraceSummary } = await import("./store.js");
  await Promise.all(spans.map((s) => insertTraceSpan(s).catch(() => {})));
  await upsertTraceSummary(summary).catch(() => {});

  // Fire automated evals after trace data is persisted
  try {
    const { evaluateRun } = await import("./evals.js");
    await evaluateRun(runId, { sampleRate: config.evalSampleRate });
  } catch {}
}
