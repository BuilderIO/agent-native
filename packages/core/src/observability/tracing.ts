const TRACER_NAME = "@agent-native/core/agent-loop";

export interface AgentSpan {
  setAttribute(key: string, value: string | number | boolean): void;
  setAttributes(attributes: Record<string, string | number | boolean>): void;
  setStatus(status: { code: number; message?: string }): void;
  recordException(exception: { name?: string; message: string }): void;
  end(endTime?: unknown): void;
}

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

let cachedRuntime: AgentTraceRuntime | null | undefined;

async function resolveRuntime(): Promise<AgentTraceRuntime | null> {
  if (cachedRuntime !== undefined) return cachedRuntime;
  try {
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

export function __resetAgentTracerCache(): void {
  cachedRuntime = undefined;
}

export function __setAgentTracerForTests(tracer: AgentTracer | null): void {
  cachedRuntime = tracer ? { tracer } : null;
}

export function __setAgentTraceRuntimeForTests(
  runtime: AgentTraceRuntime | null,
): void {
  cachedRuntime = runtime;
}
