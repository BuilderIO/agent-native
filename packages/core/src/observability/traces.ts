import type {
  AgentLoopOutcome,
  AgentLoopUsage,
} from "../agent/production-agent.js";
import type { AgentChatEvent, AgentToolInput } from "../agent/types.js";
import { captureError } from "../server/capture-error.js";
import {
  getRequestContext,
  getRequestOrgId,
} from "../server/request-context.js";
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
  redactToolErrorMessage as redactToolErrorMessageText,
  sanitizeToolErrorMessage,
  TOOL_ERROR_CAPTURE_METADATA_KEY,
} from "./trace-error.js";
import { redactSensitiveFields } from "./trace-redaction.js";
export { redactSensitiveFields } from "./trace-redaction.js";
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

const EXPECTED_CONTINUATION_REASONS = new Set(["run_timeout", "auto_continue"]);
const HTTP_STATUS_OK = 200;

type GenerationToolCall = {
  name: string;
  started_offset_ms: number;
  duration_ms: number;
  status: "success" | "error";
  error_class: "tool_error" | "legacy_inferred_error" | "interrupted" | null;
  error_message?: string;
};

function redactToolErrorMessage(value: string): string {
  return redactToolErrorMessageText(value);
}

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
  inputTokens: number | undefined;
  outputTokens: number | undefined;
  cacheReadTokens: number | undefined;
  cacheWriteTokens: number | undefined;
  /** Same "unknown vs zero" rule as the token fields — cost is derived from
   *  them and is equally unmeasurable when they were never reported. */
  costCentsX100: number | undefined;
  durationMs: number;
  llmDurationMs: number;
  llmDurationMeasured: boolean;
  llmCallCount: number;
  stopReason?: string;
  /** Elapsed ms from run start to the first non-heartbeat engine event.
   *  Undefined when no such event ever arrived (the run never produced a
   *  token before being aborted) — never coerced to 0. */
  firstTokenMs: number | undefined;
  status: "success" | "error";
  errorMessage: string | null;
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
    $ai_error_type:
      args.status === "error" ? (terminalCode ?? "llm_error") : undefined,
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

function buildGenerationContent(args: {
  config: ObservabilityConfig;
  messages: unknown;
  assistantText: string;
  toolSpans: TraceSpan[];
  toolCallIds: Map<string, string>;
}): {
  aiInput?: unknown;
  aiOutputChoices?: unknown;
  aiInputTruncated?: boolean;
  aiOutputTruncated?: boolean;
} {
  const { config } = args;

  const input = config.capturePrompts
    ? boundAiContent(toPostHogMessages(redactSensitiveFields(args.messages)))
    : undefined;

  const toolCalls = args.toolSpans
    .slice(0, MAX_TRACKED_GENERATION_TOOL_CALLS)
    .map((span) => ({
      type: "function" as const,
      id: args.toolCallIds.get(span.id) ?? span.id,
      function: {
        name: span.name,
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

export async function getObservabilityConfig(): Promise<ObservabilityConfig> {
  const { getAppConfig } = await import("../app-config/store.js");
  const config = getAppConfig().observability;
  const { resolveInferredSentimentConfig } = await import("./sentiment.js");
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
  userId: string | null;
  config: ObservabilityConfig;
  spanName?: string;
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
  sentimentInput?: string;
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
  const orgId = getRequestOrgId() ?? null;
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

  const browserSessionId =
    opts.browserSessionId ?? getRequestContext()?.browserSessionId;

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
  const toolNameToCounters = new Map<string, number[]>();
  const toolCallIdToCounter = new Map<string, number>();
  const generationToolCalls = new Map<number, GenerationToolCall>();
  const assistantTextParts: string[] = [];
  let assistantTextLength = 0;

  let toolCallCount = 0;
  let successfulTools = 0;
  let failedTools = 0;
  let reportedToolFailures = 0;

  const modelRoundTrips: Array<{
    spanId: string;
    start: number;
    end: number;
    usage?: AgentLoopUsage;
    stopReason?: string;
    input?: unknown[];
    assistantText: string[];
  }> = [];
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
  const toolSpanRoundTrip = new Map<string, number>();
  const toolCounterRoundTrip = new Map<number, number>();
  const toolSpanErrorClass = new Map<string, string>();
  const toolSpanCallId = new Map<string, string>();

  const openOtelToolSpans = new Set<AgentSpan>();
  let usage: AgentLoopUsage | undefined;
  let runStatus: "success" | "error" = "success";
  let errorMessage: string | null = null;
  let runMetadata: Record<string, unknown> | null = opts.metadata ?? null;
  let terminalOutcome: AgentLoopOutcome | undefined;
  let errorHttpStatus: number | undefined;
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
        if (event.status === "start") {
          finishAwaitingOtelModelSpans();
          if (modelStreamOpenedAt === null) {
            modelStreamOpenedAt = Date.now();
            const tripIndex = modelRoundTrips.length;
            modelRoundTrips.push({
              spanId: spanId(),
              start: modelStreamOpenedAt,
              end: modelStreamOpenedAt,
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
            modelSpansAwaitingFinalError.add(tripIndex);
          }
          modelStreamOpenedAt = null;
        }
      }

      if (event.type === "tool_start") {
        const counter = toolInvocationCounter++;
        const sid = spanId();
        if (modelRoundTrips.length > 0) {
          toolSpanRoundTrip.set(sid, modelRoundTrips.length - 1);
          toolCounterRoundTrip.set(counter, modelRoundTrips.length - 1);
        }
        const entry: {
          spanId: string;
          callId?: string;
          startMs: number;
          toolName: string;
          input: AgentToolInput;
          otelSpan: AgentSpan | null;
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

        const toolErrorMessage =
          isError && config.captureToolResults
            ? sanitizeToolErrorMessage(event.result)
            : null;

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
            error_message: toolErrorMessage ?? undefined,
          });
        }

        const otelEndResult = {
          status: (isError ? "error" : "success") as "success" | "error",
          errorMessage: toolErrorMessage,
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
          spanMetadataFields.input = redactSensitiveFields(pending.input);
        }
        if (
          !isError &&
          config.captureToolResults &&
          typeof event.result === "string"
        ) {
          spanMetadataFields.output = sanitizeToolErrorMessage(event.result);
        }
        if (isError && config.captureToolResults) {
          spanMetadataFields[TOOL_ERROR_CAPTURE_METADATA_KEY] = 1;
        }
        const spanMetadata = Object.keys(spanMetadataFields).length
          ? spanMetadataFields
          : null;

        const toolSpanId = pending?.spanId ?? spanId();
        const modelCallId = pending?.callId ?? event.id;
        if (modelCallId) toolSpanCallId.set(toolSpanId, modelCallId);
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
          errorMessage: toolErrorMessage,
          metadata: spanMetadata,
          createdAt: pending?.startMs ?? finishedAt,
        };
        spans.push(span);
      }
    } catch {}

    loopOpts.send(event);
  };

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
    try {
      const runEnd = Date.now();
      const totalDurationMs = runEnd - runStart;

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
          const capturedInterruptedMessage = config.captureToolResults
            ? interruptedMessage
            : null;
          toolSpanErrorClass.set(pending.spanId, "interrupted");
          if (counter < MAX_TRACKED_GENERATION_TOOL_CALLS) {
            generationToolCalls.set(counter, {
              name: pending.toolName,
              started_offset_ms: Math.max(0, pending.startMs - runStart),
              duration_ms: Math.max(0, runEnd - pending.startMs),
              status: "error",
              error_class: "interrupted",
              error_message: capturedInterruptedMessage ?? undefined,
            });
          }
          if (pending.otelSpan) {
            openOtelToolSpans.delete(pending.otelSpan);
            endAgentSpan(pending.otelSpan, {
              status: "error",
              errorMessage: capturedInterruptedMessage,
              attributes: { "tool.name": pending.toolName },
            });
          } else {
            pending.endResult = {
              status: "error",
              errorMessage: capturedInterruptedMessage,
            };
          }
          const interruptedMetadata: Record<string, unknown> = {};
          if (config.captureToolArgs) {
            interruptedMetadata.input = redactSensitiveFields(pending.input);
          }
          if (config.captureToolResults) {
            interruptedMetadata[TOOL_ERROR_CAPTURE_METADATA_KEY] = 1;
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
            errorMessage: capturedInterruptedMessage,
            metadata: Object.keys(interruptedMetadata).length
              ? interruptedMetadata
              : null,
            createdAt: pending.startMs,
          });
        }
        pendingTools.clear();
        toolNameToCounters.clear();
        toolCallIdToCounter.clear();
      }

      let costCentsX100 = 0;
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
      const emittedToolSpans = (
        config.captureLlmSpans ? collectedToolSpans : []
      ).slice(0, MAX_AI_SPANS_PER_RUN);
      const droppedToolSpans =
        (config.captureLlmSpans ? collectedToolSpans.length : 0) -
        emittedToolSpans.length;

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
        const derivedLlmDurationMs =
          measuredModelDurationMs ??
          Math.max(
            0,
            totalDurationMs -
              coveredDurationMs(spanIntervals(emittedToolSpans)),
          );

        const generations =
          modelRoundTrips.length > 0
            ? modelRoundTrips.map((trip, index) => ({
                spanId: trip.spanId,
                model: trip.usage?.model ?? runUsage.model,
                createdAt: trip.start,
                latencyMs: Math.max(0, trip.end - trip.start),
                callUsage: trip.usage,
                stopReason: trip.stopReason,
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
          const generationStatus =
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
            llmCallCount: modelRoundTrips.length > 0 ? 1 : llmCallCount,
            firstTokenMs: generation.isFirst ? runFirstTokenMs : undefined,
            status: generationStatus,
            errorMessage: generationError,
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
            llm_calls: llmCallCount || undefined,
            tool_calls: toolCallCount,
            successful_tools: successfulTools,
            failed_tools: failedTools,
            time_to_first_token_ms: runFirstTokenMs,
            latency_source:
              measuredModelDurationMs !== undefined ? "measured" : "derived",
            ...aiTraceMetadataProperties(runMetadata),
            ...(cutOffReason ? { terminal_reason: cutOffReason } : {}),
            ...(droppedToolSpans > 0
              ? {
                  spans_dropped: droppedToolSpans,
                  spans_emitted: emittedToolSpans.length,
                }
              : {}),
          },
        });

        for (const span of emittedToolSpans) {
          const toolErrorMessage =
            span.status === "error" &&
            span.errorMessage &&
            config.captureToolResults
              ? sanitizeToolErrorMessage(span.errorMessage)
              : undefined;
          const toolErrorDetail =
            span.status !== "error"
              ? undefined
              : toolErrorMessage
                ? toAiErrorDetail(toolErrorMessage)
                : !config.captureToolResults
                  ? {
                      message:
                        "error text withheld: captureToolResults is off for this app",
                    }
                  : undefined;
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
        orgId,
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
      captureError(instrumentationError, {
        tags: { source: "agent-observability", phase: "trace-finalize" },
        aiTraceId: runId,
        extra: { runId, threadId },
      });
    }
  }

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
  await Promise.all(
    spans.map((span) =>
      insertTraceSpan({ ...span, orgId: summary.orgId ?? null }).catch(
        () => {},
      ),
    ),
  );
  await upsertTraceSummary(summary).catch(() => {});

  try {
    const { evaluateRun } = await import("./evals.js");
    await evaluateRun(runId, { sampleRate: config.evalSampleRate });
  } catch {}
}
