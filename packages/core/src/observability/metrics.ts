/**
 * OpenTelemetry metrics emitted by the framework.
 *
 * Recorded for every request, independent of the tracking layer's sampling,
 * so ratio alerts need no extrapolation. Instrument names and attribute keys
 * are a public contract bound by dashboards and alerts: rename nothing without
 * a migration plan.
 */

import { CORE_ACTION_GROUPS } from "../framework-tools.js";
import {
  getRegisteredObservabilityProvider,
  type ObservabilityMeterProvider,
} from "./otel-provider.js";

const METER_NAME = "@agent-native/core";

// The SDK default is dense below 100ms, which serverless requests don't need.
const HTTP_SERVER_DURATION_BUCKETS_S = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

// Coarser than the GenAI conventions' advice: every model a process calls
// mints a full set of bucket series, and model calls take seconds, not ms.
const GEN_AI_OPERATION_DURATION_BUCKETS_S = [
  0.5, 1, 2.5, 5, 10, 20, 40, 80, 160,
];
const GEN_AI_TOKEN_USAGE_BUCKETS = [
  64, 256, 1_024, 4_096, 16_384, 65_536, 262_144, 1_048_576,
];

export const OBSERVABILITY_FLUSH_TIMEOUT_MS = 2_000;

// A timer that fires this much past its deadline means the process was frozen
// mid-flush (the runtime suspended it after the response), not that the export
// was slow.
const FLUSH_SUSPENDED_SLACK_MS = 1_000;

const KNOWN_HTTP_METHODS = new Set([
  "CONNECT",
  "DELETE",
  "GET",
  "HEAD",
  "OPTIONS",
  "PATCH",
  "POST",
  "PUT",
  "TRACE",
]);

type MetricAttributes = Record<string, string | number>;

interface MetricHistogram {
  record(value: number, attributes?: MetricAttributes): void;
}

interface MetricCounter {
  add(value: number, attributes?: MetricAttributes): void;
}

interface Meter {
  createHistogram(
    name: string,
    options?: {
      description?: string;
      unit?: string;
      advice?: { explicitBucketBoundaries?: number[] };
    },
  ): MetricHistogram;
  createCounter(
    name: string,
    options?: { description?: string; unit?: string },
  ): MetricCounter;
}

interface Instruments {
  meterProvider: ObservabilityMeterProvider;
  httpServerRequestDuration: MetricHistogram;
  genAiOperationDuration: MetricHistogram;
  genAiTokenUsage: MetricHistogram;
  agentRuns: MetricCounter;
  toolCalls: MetricCounter;
  flushFailures: MetricCounter;
  traceWriteFailures: MetricCounter;
}

let cachedInstruments: Instruments | undefined;

function instruments(): Instruments | undefined {
  const meterProvider = getRegisteredObservabilityProvider()?.meterProvider;
  if (!meterProvider) return undefined;
  if (cachedInstruments?.meterProvider === meterProvider) {
    return cachedInstruments;
  }
  const meter = meterProvider.getMeter(METER_NAME) as Meter;
  cachedInstruments = {
    meterProvider,
    httpServerRequestDuration: meter.createHistogram(
      "http.server.request.duration",
      {
        description: "Duration of HTTP server requests.",
        unit: "s",
        advice: { explicitBucketBoundaries: HTTP_SERVER_DURATION_BUCKETS_S },
      },
    ),
    genAiOperationDuration: meter.createHistogram(
      "gen_ai.client.operation.duration",
      {
        description: "GenAI operation duration.",
        unit: "s",
        advice: {
          explicitBucketBoundaries: GEN_AI_OPERATION_DURATION_BUCKETS_S,
        },
      },
    ),
    genAiTokenUsage: meter.createHistogram("gen_ai.client.token.usage", {
      description: "Number of input and output tokens used.",
      unit: "{token}",
      advice: { explicitBucketBoundaries: GEN_AI_TOKEN_USAGE_BUCKETS },
    }),
    agentRuns: meter.createCounter("agent_native.agent.runs", {
      description: "Agent runs that reached a terminal state.",
    }),
    toolCalls: meter.createCounter("agent_native.tool.calls", {
      description: "Agent tool calls that finished or were interrupted.",
    }),
    flushFailures: meter.createCounter(
      "agent_native.telemetry.flush_failures",
      {
        description:
          "Telemetry flushes that timed out or failed; their points were dropped.",
      },
    ),
    traceWriteFailures: meter.createCounter(
      "agent_native.observability.trace_write_failures",
      {
        description:
          "Runs whose trace spans or summary could not be persisted; their trace is incomplete or missing.",
      },
    ),
  };
  return cachedInstruments;
}

function httpRequestMethod(method: string): string {
  const upper = method.toUpperCase();
  return KNOWN_HTTP_METHODS.has(upper) ? upper : "_OTHER";
}

export interface HttpServerRequestMetric {
  method: string;
  statusCode: number;
  durationMs: number;
  /**
   * A value from the closed set `httpRouteForRequest()` documents, or a
   * trusted action's declared template. Never a raw path: arbitrary request
   * paths would mint a series each.
   */
  route?: string;
}

export function recordHttpServerRequest(
  request: HttpServerRequestMetric,
): void {
  const recorded = instruments();
  if (!recorded) return;
  recorded.httpServerRequestDuration.record(
    Math.max(0, request.durationMs) / 1_000,
    {
      "http.request.method": httpRequestMethod(request.method),
      "http.response.status_code": request.statusCode,
      ...(request.route ? { "http.route": request.route } : {}),
      ...(request.statusCode >= 500
        ? { "error.type": String(request.statusCode) }
        : {}),
    },
  );
}

/**
 * Engines that accept custom model ids pass any caller-supplied string
 * through, so a model outside the engine's supported list collapses to
 * `_OTHER` instead of minting a series per string. Spans keep the exact id.
 */
function boundedModel(
  model: string,
  supportedModels: readonly string[] | undefined,
): string {
  return model === "auto" || supportedModels?.includes(model)
    ? model
    : "_OTHER";
}

export interface GenAiChatMetric {
  requestModel: string;
  /** The engine name; a closed, registered set. */
  providerName?: string;
  supportedModels?: readonly string[];
  durationMs?: number;
  failed?: boolean;
  inputTokens?: number;
  outputTokens?: number;
}

/** One model round trip (`gen_ai.operation.name=chat`). */
export function recordGenAiChat(call: GenAiChatMetric): void {
  const recorded = instruments();
  if (!recorded) return;
  const attributes: MetricAttributes = {
    "gen_ai.operation.name": "chat",
    "gen_ai.request.model": boundedModel(
      call.requestModel,
      call.supportedModels,
    ),
    ...(call.providerName ? { "gen_ai.provider.name": call.providerName } : {}),
  };
  if (call.durationMs !== undefined) {
    recorded.genAiOperationDuration.record(
      Math.max(0, call.durationMs) / 1_000,
      call.failed ? { ...attributes, "error.type": "_OTHER" } : attributes,
    );
  }
  for (const [tokenType, tokens] of [
    ["input", call.inputTokens],
    ["output", call.outputTokens],
  ] as const) {
    if (tokens === undefined || !Number.isFinite(tokens)) continue;
    recorded.genAiTokenUsage.record(Math.max(0, tokens), {
      ...attributes,
      "gen_ai.token.type": tokenType,
    });
  }
}

// `error:<code>` and `aborted:<reason>` carry open-ended suffixes; every other
// terminal reason is from a closed set.
function boundedTerminalReason(reason: string): string {
  const separator = reason.indexOf(":");
  return separator === -1 ? reason : reason.slice(0, separator);
}

export interface AgentRunMetric {
  status: string;
  terminalReason: string;
  requestModel?: string;
  providerName?: string;
  supportedModels?: readonly string[];
}

export function recordAgentRun(run: AgentRunMetric): void {
  instruments()?.agentRuns.add(1, {
    status: run.status,
    terminal_reason: boundedTerminalReason(run.terminalReason),
    ...(run.requestModel
      ? {
          "gen_ai.request.model": boundedModel(
            run.requestModel,
            run.supportedModels,
          ),
        }
      : {}),
    ...(run.providerName ? { "gen_ai.provider.name": run.providerName } : {}),
  });
}

export interface AgentToolCallMetric {
  toolName: string;
  /** A bounded failure class; omit on success. */
  errorType?: string;
}

/** App-defined tool names collapse to `other` so they cannot mint series. */
export function recordAgentToolCall(call: AgentToolCallMetric): void {
  instruments()?.toolCalls.add(1, {
    "gen_ai.tool.name": Object.hasOwn(CORE_ACTION_GROUPS, call.toolName)
      ? call.toolName
      : "other",
    ...(call.errorType ? { "error.type": call.errorType } : {}),
  });
}

export type TraceWriteStage = "spans" | "summary" | "thread_org" | "write";

/** Counted once per failed stage of a run, never per span. */
export function recordTraceWriteFailure(
  stage: TraceWriteStage,
  error: unknown,
): void {
  instruments()?.traceWriteFailures.add(1, {
    "agent_native.observability.stage": stage,
    "error.type": flushErrorType(error),
  });
}

function flushErrorType(error: unknown): string {
  return error instanceof Error && error.name ? error.name : "unknown";
}

type TelemetrySignal = "metrics" | "traces";

function recordFlushFailure(signal: TelemetrySignal, errorType: string): void {
  instruments()?.flushFailures.add(1, {
    "agent_native.telemetry.signal": signal,
    "error.type": errorType,
  });
}

/**
 * Export buffered telemetry before a serverless function can freeze. Never
 * delays a request by more than OBSERVABILITY_FLUSH_TIMEOUT_MS; each provider
 * that times out or fails drops its points and is counted separately on
 * `agent_native.telemetry.flush_failures`, which the next flush exports.
 */
export async function flushObservability(): Promise<void> {
  const provider = getRegisteredObservabilityProvider();
  if (!provider) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const startedAt = Date.now();
  const timeout = new Promise<string>((resolve) => {
    timer = setTimeout(() => {
      const late =
        Date.now() - startedAt - OBSERVABILITY_FLUSH_TIMEOUT_MS >
        FLUSH_SUSPENDED_SLACK_MS;
      resolve(late ? "suspended" : "timeout");
    }, OBSERVABILITY_FLUSH_TIMEOUT_MS);
    timer.unref?.();
  });
  try {
    // One provider failing must not end the wait for the other: the response
    // hook returning early lets the runtime freeze mid-export.
    const flushes = [
      ["metrics", provider.meterProvider],
      ["traces", provider.tracerProvider],
    ] as const;
    const failures = await Promise.all(
      flushes.map(([, signalProvider]) =>
        Promise.race([
          (async () => {
            await signalProvider?.forceFlush?.();
            return undefined;
          })().catch(flushErrorType),
          timeout,
        ]),
      ),
    );
    failures.forEach((failure, index) => {
      if (failure) recordFlushFailure(flushes[index][0], failure);
    });
  } finally {
    clearTimeout(timer);
  }
}
