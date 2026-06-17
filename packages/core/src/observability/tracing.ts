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
  end(): void;
}

/** OTel `SpanStatusCode` values, inlined so we don't need the api types here. */
export const SPAN_STATUS_OK = 1;
export const SPAN_STATUS_ERROR = 2;

/**
 * Cached tracer. `undefined` = not yet resolved; `null` = resolved to
 * "no tracer available" (api package missing or load failed).
 */
let cachedTracer: AgentTracer | null | undefined;

interface AgentTracer {
  startSpan(
    name: string,
    options?: { attributes?: Record<string, string | number | boolean> },
  ): AgentSpan;
}

/**
 * Resolve the OpenTelemetry tracer if `@opentelemetry/api` is installed.
 * Returns `null` (cached) when the package is unavailable so callers can
 * branch to a no-op cheaply on every subsequent call.
 */
async function resolveTracer(): Promise<AgentTracer | null> {
  if (cachedTracer !== undefined) return cachedTracer;
  try {
    // Optional dependency — guarded import. Absent ⇒ no-op everywhere.
    const otel: any = await import("@opentelemetry/api");
    const tracer = otel?.trace?.getTracer?.(TRACER_NAME);
    cachedTracer = (tracer as AgentTracer) ?? null;
  } catch {
    cachedTracer = null;
  }
  return cachedTracer;
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

/**
 * Start a span. When OTel isn't installed (or no provider is registered) this
 * returns `null` and the caller simply skips span bookkeeping — there is no
 * runtime cost beyond the cached null check.
 */
export async function startAgentSpan(
  name: string,
  attributes: Record<string, string | number | boolean | null | undefined> = {},
): Promise<AgentSpan | null> {
  const tracer = await resolveTracer();
  if (!tracer) return null;
  try {
    return tracer.startSpan(name, {
      attributes: pruneAttributes(attributes),
    });
  } catch {
    return null;
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
      span.end();
    } catch {
      // ignore
    }
  }
}

/** For tests — reset the cached tracer so a fresh provider can be detected. */
export function __resetAgentTracerCache(): void {
  cachedTracer = undefined;
}

/**
 * For tests — inject a tracer directly (e.g. an in-memory test provider's
 * tracer) without going through the `@opentelemetry/api` global. Pass `null`
 * to simulate "no tracer available".
 */
export function __setAgentTracerForTests(tracer: AgentTracer | null): void {
  cachedTracer = tracer;
}
