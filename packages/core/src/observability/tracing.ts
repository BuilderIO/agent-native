/**
 * Optional OpenTelemetry layer for the agent loop.
 *
 * The framework's primary trace store is the in-house `agent_trace_spans` /
 * `agent_trace_summaries` tables (see `traces.ts`). This module adds an
 * OPTIONAL, no-op-unless-configured OpenTelemetry export on top of that, so a
 * host that already runs an OTel collector can see agent runs, model calls, and
 * tool calls alongside the rest of their distributed traces.
 *
 * Design constraints:
 *   - `@opentelemetry/api` is an OPTIONAL dependency. If it isn't installed the
 *     helpers degrade to silent no-ops — nothing here ever throws into the agent
 *     loop.
 *   - The API package ships a default NO-OP tracer. Until a host registers a
 *     real `TracerProvider` (via `@opentelemetry/sdk-node` or similar, which
 *     core deliberately does NOT depend on), `tracer.startSpan(...)` returns a
 *     no-op span and the cost is a couple of property reads. We never register a
 *     provider ourselves — instrumentation is opt-in by the embedding app.
 *   - Heavy SDK packages (`@opentelemetry/sdk-*`, exporters) are NOT added to
 *     core. The host owns the provider/exporter wiring; core only emits spans.
 */

const TRACER_NAME = "@agent-native/core/agent-loop";

/**
 * Minimal structural subset of the OpenTelemetry `Span` we use. Declared
 * locally so this module type-checks even when `@opentelemetry/api` isn't
 * installed (it's an optional dependency).
 */
export interface AgentSpan {
  setAttribute(key: string, value: string | number | boolean): void;
  setAttributes(attributes: Record<string, string | number | boolean>): void;
  /** OTel `SpanStatusCode`: 1 = OK, 2 = ERROR. */
  setStatus(status: { code: number; message?: string }): void;
  recordException(exception: { name?: string; message: string }): void;
  end(endTime?: unknown): void;
}

/** OTel `SpanStatusCode` values, inlined so we don't need the api types here. */
export const SPAN_STATUS_OK = 1;
export const SPAN_STATUS_ERROR = 2;

interface AgentTracer {
  startSpan(
    name: string,
    options?: {
      attributes?: Record<string, string | number | boolean>;
      startTime?: unknown;
    },
    context?: unknown,
  ): AgentSpan;
}

interface AgentTraceRuntime {
  tracer: AgentTracer;
  context?: {
    active(): unknown;
    with<T>(context: unknown, callback: () => T): T;
  };
  trace?: {
    setSpan(context: unknown, span: AgentSpan): unknown;
  };
}

/**
 * Cached OTel runtime. `undefined` = not yet resolved; `null` = resolved to
 * "no runtime available" (api package missing or load failed).
 */
let cachedRuntime: AgentTraceRuntime | null | undefined;

/**
 * Resolve the OpenTelemetry tracer if `@opentelemetry/api` is installed.
 * Returns `null` (cached) when the package is unavailable so callers can
 * branch to a no-op cheaply on every subsequent call.
 */
async function resolveRuntime(): Promise<AgentTraceRuntime | null> {
  if (cachedRuntime !== undefined) return cachedRuntime;
  try {
    // Optional dependency — guarded import. Absent ⇒ no-op everywhere.
    const otel: any = await import("@opentelemetry/api");
    const tracer = otel?.trace?.getTracer?.(TRACER_NAME);
    cachedRuntime = tracer
      ? {
          tracer: tracer as AgentTracer,
          ...(otel?.context?.active && otel?.context?.with
            ? { context: otel.context }
            : {}),
          ...(otel?.trace?.setSpan ? { trace: otel.trace } : {}),
        }
      : null;
  } catch {
    cachedRuntime = null;
  }
  return cachedRuntime;
}

/** Drop sentinel/zero token counts so spans aren't cluttered with noise. */
function pruneAttributes(
  attributes: Record<string, string | number | boolean | null | undefined>,
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (value === null || value === undefined) continue;
    out[key] = value;
  }
  return out;
}

// Keep this list explicit. Tracking names can be caller-controlled, so a
// name-based fallback would turn arbitrary event names into OTel span names.
const TRACKING_SPAN_NAMES = new Map([
  ["action.response", "action.client"],
  ["action_completed", "action.server"],
  ["action_failed", "action.server"],
  ["http.response", "http.server"],
  ["$ai_generation", "llm.generation"],
  ["$ai_trace", "llm.trace"],
  ["agent_run_terminal", "agent.run.terminal"],
  ["$a2a_invocation", "a2a.invocation"],
  ["$a2a_read_invoke", "a2a.read"],
]);
export type TrackingEventOrigin = "client" | "server";
export interface TrackingEventScope {
  pending: Set<Promise<void>>;
}

const pendingTrackingEvents = new Set<Promise<void>>();

export function createTrackingEventScope(): TrackingEventScope {
  return { pending: new Set() };
}

function numericDuration(properties: Record<string, unknown>): number | null {
  const duration = properties.duration_ms;
  return typeof duration === "number" &&
    Number.isFinite(duration) &&
    duration >= 0
    ? duration
    : null;
}

function trackingAttributeValue(
  value: unknown,
): string | number | boolean | undefined {
  return typeof value === "string" ||
    (typeof value === "number" && Number.isFinite(value)) ||
    typeof value === "boolean"
    ? value
    : undefined;
}

function clientTrackingSpanAttributes(
  properties: Record<string, unknown>,
): Record<string, string | number | boolean> {
  const attributes: Record<string, string | number | boolean> = {};
  const assignNumber = (attribute: string, key: string) => {
    const value = properties[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      attributes[attribute] = value;
    }
  };
  const assignBoolean = (attribute: string, key: string) => {
    const value = properties[key];
    if (typeof value === "boolean") attributes[attribute] = value;
  };

  assignBoolean("agent.success", "success");
  assignBoolean("agent.sampled", "sampled");
  assignNumber("agent.sample_rate", "sample_rate");
  for (const key of [
    "duration_ms",
    "ttfb_ms",
    "body_ms",
    "server_duration_ms",
    "network_overhead_ms",
    "framework_ready_wait_ms",
    "db_operation_wall_ms",
    "db_operation_count",
    "cold_start",
  ]) {
    assignNumber(`agent.${key}`, key);
  }

  const statusCode = properties.status_code;
  if (
    typeof statusCode === "number" &&
    Number.isInteger(statusCode) &&
    statusCode >= 100 &&
    statusCode <= 599
  ) {
    attributes["http.status_code"] = statusCode;
    attributes["http.status_class"] = `${Math.floor(statusCode / 100)}xx`;
  }
  return attributes;
}

function trackingSpanAttributes(
  name: string,
  properties: Record<string, unknown>,
  origin?: TrackingEventOrigin,
): Record<string, string | number | boolean> {
  const attributes: Record<string, string | number | boolean> =
    origin === "client" ? {} : { "agent.event_name": name };
  if (origin) attributes["agent.telemetry_source"] = origin;
  if (origin === "client") {
    return {
      ...attributes,
      ...clientTrackingSpanAttributes(properties),
    };
  }
  const assign = (attribute: string, key: string, value = properties[key]) => {
    const normalized = trackingAttributeValue(value);
    if (normalized !== undefined) attributes[attribute] = normalized;
  };

  assign("agent.source", "source");
  if (name !== "$a2a_read_invoke") {
    assign("agent.action", "action_name", properties.action);
  }
  assign("agent.action_source", "action_source");
  assign("agent.caller", "caller");
  assign("agent.outcome", "outcome");
  assign("agent.success", "success");
  assign("agent.sample_rate", "sample_rate");
  assign("agent.sampled", "sampled");
  assign("http.method", "method");
  assign("http.route", "route_template");
  assign("http.status_code", "status_code");
  assign("http.status_class", "status_class");
  assign("agent.duration_ms", "duration_ms");
  assign("agent.ttfb_ms", "ttfb_ms");
  assign("agent.body_ms", "body_ms");
  assign("agent.server_duration_ms", "server_duration_ms");
  assign("agent.network_overhead_ms", "network_overhead_ms");
  assign("agent.framework_ready_wait_ms", "framework_ready_wait_ms");
  assign("agent.db_operation_wall_ms", "db_operation_wall_ms");
  assign("agent.db_operation_count", "db_operation_count");
  assign("agent.cold_start", "cold_start");
  return attributes;
}

function trackingSpanStatus(
  properties: Record<string, unknown>,
): "success" | "error" {
  if (properties.success === false) return "error";
  const statusCode = properties.status_code;
  if (typeof statusCode === "number" && statusCode >= 400) return "error";
  if (properties.$ai_is_error === true) return "error";
  const status = properties.status;
  if (
    typeof status === "string" &&
    /^(?:aborted|error|errored|failed|truncated)$/i.test(status)
  ) {
    return "error";
  }
  const outcome = properties.outcome;
  return typeof outcome === "string" &&
    /(?:cancel|error|fail|network|timeout)/i.test(outcome)
    ? "error"
    : "success";
}

/**
 * Mirror timing-bearing tracking events into OTel without exporting analytics
 * clicks or user content as spans. The tracking event remains the aggregate
 * metrics path; this is only a best-effort trace/debug signal.
 */
export async function recordTrackingEvent(
  name: string,
  properties: Record<string, unknown> = {},
  origin?: TrackingEventOrigin,
): Promise<void> {
  const normalizedName = name.trim();
  const durationMs = numericDuration(properties);
  const spanName = TRACKING_SPAN_NAMES.get(normalizedName);
  if (!spanName || durationMs === null) {
    return;
  }

  try {
    const endTime = Date.now();
    const span = await startAgentSpan(
      spanName,
      trackingSpanAttributes(normalizedName, properties, origin),
      null,
      endTime - durationMs,
    );
    endAgentSpan(span, {
      status: trackingSpanStatus(properties),
      endTime,
    });
    // coercion-ok: optional OTel export must never affect analytics or request handling.
  } catch {
    // Optional OTel export must never affect analytics or request handling.
  }
}

/** Queue server mirrors so a request boundary can await their completion. */
export function queueTrackingEvent(
  name: string,
  properties: Record<string, unknown> = {},
  origin: TrackingEventOrigin = "server",
  scope?: TrackingEventScope,
): void {
  const pending = recordTrackingEvent(name, properties, origin);
  const pendingEvents = scope?.pending ?? pendingTrackingEvents;
  pendingEvents.add(pending);
  void pending.then(
    () => pendingEvents.delete(pending),
    () => pendingEvents.delete(pending),
  );
}

export async function flushTrackingEvents(
  scope?: TrackingEventScope,
): Promise<void> {
  await Promise.allSettled([...(scope?.pending ?? pendingTrackingEvents)]);
}

/**
 * Start a span. When OTel isn't installed (or no provider is registered) this
 * returns `null` and the caller simply skips span bookkeeping — there is no
 * runtime cost beyond the cached null check.
 */
export async function startAgentSpan(
  name: string,
  attributes: Record<string, string | number | boolean | null | undefined> = {},
  parentSpan: AgentSpan | null = null,
  startTime?: unknown,
): Promise<AgentSpan | null> {
  const runtime = await resolveRuntime();
  if (!runtime) return null;
  try {
    let parentContext: unknown;
    if (parentSpan && runtime.context && runtime.trace) {
      try {
        parentContext = runtime.trace.setSpan(
          runtime.context.active(),
          parentSpan,
        );
      } catch {
        // coercion-ok: explicit OTel parent setup must never break the agent loop.
      }
    }
    return runtime.tracer.startSpan(
      name,
      {
        attributes: pruneAttributes(attributes),
        ...(startTime === undefined ? {} : { startTime }),
      },
      parentContext,
    );
  } catch {
    return null;
  }
}

/**
 * Run a callback with the supplied span installed as the active OTel span so
 * spans created by the callback become descendants of it. The bridge is
 * deliberately best-effort: telemetry setup must never change agent behavior.
 */
export function withAgentSpanContext<T>(
  span: AgentSpan | null,
  callback: () => T,
): T {
  if (!span) return callback();
  const runtime = cachedRuntime;
  if (!runtime?.context || !runtime.trace) return callback();

  let callbackEntered = false;
  try {
    const context = runtime.trace.setSpan(runtime.context.active(), span);
    return runtime.context.with(context, () => {
      callbackEntered = true;
      return callback();
    });
  } catch (error) {
    if (callbackEntered) throw error;
    // coercion-ok: optional OTel context setup must never break the agent loop.
    return callback();
  }
}

/**
 * Finish a span, setting OK/ERROR status and recording the error message when
 * present. Safe to call with `null` (no-op) and never throws.
 */
export function endAgentSpan(
  span: AgentSpan | null,
  result: {
    status?: "success" | "error";
    errorMessage?: string | null;
    attributes?: Record<string, string | number | boolean | null | undefined>;
    endTime?: number;
  } = {},
): void {
  if (!span) return;
  try {
    if (result.attributes) {
      span.setAttributes(pruneAttributes(result.attributes));
    }
    if (result.status === "error") {
      span.setStatus({
        code: SPAN_STATUS_ERROR,
        message: result.errorMessage ?? undefined,
      });
      if (result.errorMessage) {
        span.recordException({ message: result.errorMessage });
      }
    } else {
      span.setStatus({ code: SPAN_STATUS_OK });
    }
  } catch {
    // Never let span finalization break the agent loop.
  } finally {
    try {
      span.end(result.endTime);
    } catch {
      // ignore
    }
  }
}

/** For tests — reset the cached tracer so a fresh provider can be detected. */
export function __resetAgentTracerCache(): void {
  cachedRuntime = undefined;
}

/**
 * For tests — inject a tracer directly (e.g. an in-memory test provider's
 * tracer) without going through the `@opentelemetry/api` global. Pass `null`
 * to simulate "no tracer available".
 */
export function __setAgentTracerForTests(tracer: AgentTracer | null): void {
  cachedRuntime = tracer ? { tracer } : null;
}

/** For tests — inject a runtime with an active-context implementation. */
export function __setAgentTraceRuntimeForTests(
  runtime: AgentTraceRuntime | null,
): void {
  cachedRuntime = runtime;
}
