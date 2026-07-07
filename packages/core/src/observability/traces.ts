import type { AgentLoopUsage } from "../agent/production-agent.js";
import type { AgentChatEvent, AgentToolInput } from "../agent/types.js";
import { type AgentSpan, endAgentSpan, startAgentSpan } from "./tracing.js";
import type { TraceSpan, TraceSummary, ObservabilityConfig } from "./types.js";
import { DEFAULT_OBSERVABILITY_CONFIG } from "./types.js";

function spanId(): string {
  return `span-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeTrackingSlug(value: string | undefined): string | undefined {
  const raw = value?.trim().toLowerCase();
  if (!raw) return undefined;
  return raw
    .replace(/^@agent-native\//, "")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function appSlugFromUrl(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  try {
    const raw = /^[a-z][a-z0-9+.-]*:\/\//i.test(value)
      ? value
      : `https://${value}`;
    const hostname = new URL(raw).hostname.toLowerCase();
    if (hostname.endsWith(".agent-native.com")) {
      return normalizeTrackingSlug(
        hostname.slice(0, -".agent-native.com".length),
      );
    }
    return normalizeTrackingSlug(hostname.split(".")[0]);
  } catch {
    return undefined;
  }
}

function trackingIdentityProperties(): Record<string, string> {
  const packageApp = normalizeTrackingSlug(process.env.npm_package_name);
  const urlApp =
    appSlugFromUrl(process.env.APP_URL) ||
    appSlugFromUrl(process.env.BETTER_AUTH_URL) ||
    appSlugFromUrl(process.env.URL) ||
    appSlugFromUrl(process.env.DEPLOY_URL) ||
    appSlugFromUrl(process.env.VERCEL_PROJECT_PRODUCTION_URL) ||
    appSlugFromUrl(process.env.VERCEL_URL);
  const app =
    normalizeTrackingSlug(process.env.AGENT_NATIVE_APP) ||
    normalizeTrackingSlug(process.env.VITE_AGENT_NATIVE_APP) ||
    urlApp ||
    packageApp ||
    normalizeTrackingSlug(process.env.APP_NAME);
  const template =
    normalizeTrackingSlug(process.env.AGENT_NATIVE_TEMPLATE) ||
    normalizeTrackingSlug(process.env.VITE_AGENT_NATIVE_TEMPLATE) ||
    normalizeTrackingSlug(process.env.APP_TEMPLATE) ||
    normalizeTrackingSlug(process.env.VITE_APP_TEMPLATE) ||
    app;

  return {
    ...(app ? { app, agent_native_app: app } : {}),
    ...(template ? { template, agent_native_template: template } : {}),
  };
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

function emitLlmGenerationTrackingEvent(args: {
  runId: string;
  threadId: string | null;
  userId: string | null;
  parentSpanId: string;
  llmSpanId: string;
  engineName: string | undefined;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costCentsX100: number;
  durationMs: number;
  status: "success" | "error";
  errorMessage: string | null;
  toolCalls: number;
  successfulTools: number;
  failedTools: number;
  createdAt: number;
}): void {
  const provider = llmProviderFromEngine(args.engineName, args.model);
  const costUsd = costUsdFromCenticents(args.costCentsX100);
  const error = args.errorMessage ?? undefined;
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
    total_tokens: args.inputTokens + args.outputTokens,
    cache_read_tokens: args.cacheReadTokens,
    cache_write_tokens: args.cacheWriteTokens,
    cost_cents_x100: args.costCentsX100,
    cost_usd: costUsd,
    duration_ms: args.durationMs,
    status: args.status,
    tool_calls: args.toolCalls,
    successful_tools: args.successfulTools,
    failed_tools: args.failedTools,
    created_at: new Date(args.createdAt).toISOString(),
    created_at_ms: args.createdAt,
    $ai_trace_id: args.runId,
    $ai_session_id: args.threadId ?? undefined,
    $ai_span_id: args.llmSpanId,
    $ai_span_name: "agent_run",
    $ai_parent_id: args.parentSpanId,
    $ai_model: args.model,
    $ai_provider: provider,
    $ai_input_tokens: args.inputTokens,
    $ai_output_tokens: args.outputTokens,
    $ai_latency: Math.round((args.durationMs / 1000) * 1000) / 1000,
    $ai_is_error: args.status === "error",
    $ai_error: error,
    $ai_cache_read_input_tokens: args.cacheReadTokens,
    $ai_cache_creation_input_tokens: args.cacheWriteTokens,
    $ai_request_count: 1,
    $ai_total_cost_usd: costUsd,
  };
  if (error) properties.error_message = error;

  for (const key of Object.keys(properties)) {
    if (properties[key] === undefined) delete properties[key];
  }

  try {
    void import("../tracking/registry.js")
      .then(({ track }) => {
        track("$ai_generation", properties, {
          userId: args.userId ?? undefined,
        });
      })
      .catch(() => {});
  } catch {
    // Tracking must never affect the agent run or trace persistence.
  }
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
  try {
    const { getSetting } = await import("../settings/store.js");
    const stored = await getSetting("observability-config");
    if (stored) {
      return {
        ...DEFAULT_OBSERVABILITY_CONFIG,
        ...stored,
      } as ObservabilityConfig;
    }
  } catch {}
  return DEFAULT_OBSERVABILITY_CONFIG;
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
    providerOptions?: any;
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
    providerOptions?: any;
  };
  runId: string;
  threadId: string | null;
  /** Owner of this run; persisted on every span + summary so dashboard
   *  reads can filter to a single user. Null for unauthenticated callers
   *  (background tasks, etc.) — those rows aren't returned by per-user
   *  reads. */
  userId: string | null;
  config: ObservabilityConfig;
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
  const runStart = Date.now();
  const parentSpanId = spanId();

  // Optional OpenTelemetry root span for this run. No-ops unless a host has
  // installed `@opentelemetry/api` and registered a provider. The promise is
  // resolved before the loop runs so child tool/model spans can parent under
  // it conceptually (we keep them flat in the same tracer, which is enough
  // for the dashboards an embedding app would build).
  const otelRunSpanPromise = startAgentSpan("agent.run", {
    "agent.run_id": runId,
    "agent.thread_id": threadId ?? undefined,
    "agent.user_id": userId ?? undefined,
    "agent.model": loopOpts.model,
  });

  const spans: TraceSpan[] = [];
  let toolInvocationCounter = 0;
  // Keyed by counter to handle concurrent calls to the same tool name
  const pendingTools = new Map<
    number,
    {
      spanId: string;
      startMs: number;
      toolName: string;
      input: AgentToolInput;
      otelSpan: AgentSpan | null;
      endResult?: { status: "success" | "error"; errorMessage: string | null };
    }
  >();
  // Secondary index: tool name → FIFO queue of pending invocation counters.
  // tool_start/tool_done events carry only the tool name (no call id), so to
  // pair starts and dones correctly when the agent runs concurrent calls to the
  // same tool name (read-only / parallelSafe batches via Promise.all), we keep a
  // queue per name and match each done to the OLDEST still-pending start.
  const toolNameToCounters = new Map<string, number[]>();

  let toolCallCount = 0;
  let successfulTools = 0;
  let failedTools = 0;

  // Track in-flight OTel tool spans so they're all ended even if the loop
  // throws before a matching `tool_done` arrives.
  const openOtelToolSpans = new Set<AgentSpan>();

  const instrumentedSend = (event: AgentChatEvent): void => {
    try {
      if (event.type === "tool_start") {
        const counter = toolInvocationCounter++;
        const sid = spanId();
        // Start the OTel tool span synchronously-ish: kick off the async
        // resolution and stash the span once it lands. Tool spans are short
        // and the api tracer is synchronous in practice, but we tolerate the
        // microtask gap by recording the span on the pending entry when ready.
        const entry: {
          spanId: string;
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
          startMs: Date.now(),
          toolName: event.tool,
          input: event.input,
          otelSpan: null,
        };
        pendingTools.set(counter, entry);
        void startAgentSpan("tool.call", {
          "tool.name": event.tool,
        }).then((span) => {
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
        const counter = queue?.shift();
        const pending =
          counter !== undefined ? pendingTools.get(counter) : undefined;
        if (counter !== undefined) {
          pendingTools.delete(counter);
          if (queue && queue.length === 0)
            toolNameToCounters.delete(event.tool);
        }
        toolCallCount++;

        const isError =
          typeof event.result === "string" &&
          (event.result.startsWith("Error") ||
            event.result.startsWith("Error running "));
        if (isError) failedTools++;
        else successfulTools++;

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

        const span: TraceSpan = {
          id: pending?.spanId ?? spanId(),
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
          durationMs: pending ? Date.now() - pending.startMs : 0,
          status: isError ? "error" : "success",
          errorMessage: isError ? event.result : null,
          metadata:
            config.captureToolArgs && pending
              ? // Strip Authorization/api-key/token-shaped values before
                // persisting (M14 in the MCP/A2A audit). Tool-runtime
                // execution still sees the unredacted input — only the
                // long-lived span row is sanitized.
                {
                  input: redactSensitiveFields(pending.input) as Record<
                    string,
                    string
                  >,
                }
              : null,
          createdAt: Date.now(),
        };
        spans.push(span);
      }
    } catch {}

    loopOpts.send(event);
  };

  let usage: AgentLoopUsage | undefined;
  let runStatus: "success" | "error" = "success";
  let errorMessage: string | null = null;
  let runMetadata: Record<string, unknown> | null = null;
  try {
    usage = await runAgentLoop({ ...loopOpts, send: instrumentedSend });
  } catch (err: any) {
    const classification = opts.classifyError?.(err) ?? null;
    runStatus = classification?.status ?? "error";
    errorMessage =
      classification?.errorMessage === undefined
        ? (err?.message ?? String(err))
        : classification.errorMessage;
    runMetadata = classification?.metadata ?? null;
    throw err;
  } finally {
    const runEnd = Date.now();
    const totalDurationMs = runEnd - runStart;

    let costCentsX100 = 0;
    try {
      const { calculateCost } = await import("../usage/store.js");
      if (usage) {
        costCentsX100 = calculateCost(
          usage.inputTokens,
          usage.outputTokens,
          usage.model,
          usage.cacheReadTokens,
          usage.cacheWriteTokens,
        );
      }
    } catch {}

    let llmCallCount = 0;
    if (usage) {
      llmCallCount = 1;
      const llmSpanId = spanId();
      const llmSpan: TraceSpan = {
        id: llmSpanId,
        runId,
        threadId,
        userId,
        parentSpanId,
        spanType: "llm_call",
        name: usage.model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheReadTokens: usage.cacheReadTokens,
        cacheWriteTokens: usage.cacheWriteTokens,
        costCentsX100,
        durationMs: totalDurationMs,
        status: runStatus,
        errorMessage,
        metadata: null,
        createdAt: runStart,
      };
      spans.push(llmSpan);
      emitLlmGenerationTrackingEvent({
        runId,
        threadId,
        userId,
        parentSpanId,
        llmSpanId,
        engineName:
          typeof loopOpts.engine?.name === "string"
            ? loopOpts.engine.name
            : undefined,
        model: usage.model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheReadTokens: usage.cacheReadTokens,
        cacheWriteTokens: usage.cacheWriteTokens,
        costCentsX100,
        durationMs: totalDurationMs,
        status: runStatus,
        errorMessage,
        toolCalls: toolCallCount,
        successfulTools,
        failedTools,
        createdAt: runStart,
      });
    }

    const parentSpan: TraceSpan = {
      id: parentSpanId,
      runId,
      threadId,
      userId,
      parentSpanId: null,
      spanType: "agent_run",
      name: "agent_run",
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

    // OpenTelemetry export (no-op unless a provider is registered). Emit a
    // self-contained `llm.call` span carrying model + token usage, end any
    // tool spans still open (loop threw mid-tool), and end the run span. Awaited
    // so the spans are emitted before the function returns; cheap when no-op.
    try {
      if (usage) {
        endAgentSpan(await startAgentSpan("llm.call", {}), {
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
      for (const toolSpan of openOtelToolSpans) {
        endAgentSpan(toolSpan, {
          status: "error",
          errorMessage: "Agent run ended before tool_done.",
        });
      }
      openOtelToolSpans.clear();
      endAgentSpan(await otelRunSpanPromise, {
        status: runStatus,
        errorMessage,
        attributes: {
          "agent.tool_calls": toolCallCount,
          "agent.successful_tools": successfulTools,
          "agent.failed_tools": failedTools,
          "agent.duration_ms": totalDurationMs,
          "agent.input_tokens": usage?.inputTokens ?? 0,
          "agent.output_tokens": usage?.outputTokens ?? 0,
          "agent.cost_cents_x100": costCentsX100,
        },
      });
    } catch {
      // OTel export must never break the run.
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
