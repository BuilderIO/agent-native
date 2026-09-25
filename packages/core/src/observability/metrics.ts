/**
 * OpenTelemetry metrics emitted by the framework.
 *
 * Recorded for every request, independent of the tracking layer's sampling,
 * so ratio alerts need no extrapolation. Instrument names and attribute keys
 * are a public contract bound by dashboards and alerts: rename nothing without
 * a migration plan.
 */

import {
  getRegisteredObservabilityProvider,
  type ObservabilityMeterProvider,
} from "./otel-provider.js";

const METER_NAME = "@agent-native/core";

// The SDK default is dense below 100ms, which serverless requests don't need.
const HTTP_SERVER_DURATION_BUCKETS_S = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

export const OBSERVABILITY_FLUSH_TIMEOUT_MS = 2_000;

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
  flushFailures: MetricCounter;
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
    flushFailures: meter.createCounter(
      "agent_native.telemetry.flush_failures",
      {
        description:
          "Telemetry flushes that timed out or failed; their points were dropped.",
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
   * A low-cardinality route template. Omit rather than pass a raw path:
   * arbitrary request paths would mint a series each.
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

function flushErrorType(error: unknown): string {
  return error instanceof Error && error.name ? error.name : "unknown";
}

function recordFlushFailure(errorType: string): void {
  instruments()?.flushFailures.add(1, { "error.type": errorType });
}

async function forceFlushProviders(): Promise<void> {
  const provider = getRegisteredObservabilityProvider();
  await Promise.all([
    provider?.meterProvider?.forceFlush?.(),
    provider?.tracerProvider?.forceFlush?.(),
  ]);
}

/**
 * Export buffered telemetry before a serverless function can freeze. Never
 * delays a request by more than OBSERVABILITY_FLUSH_TIMEOUT_MS; on timeout or
 * error the points are dropped and counted on
 * `agent_native.telemetry.flush_failures`, which the next flush exports.
 */
export async function flushObservability(): Promise<void> {
  if (!getRegisteredObservabilityProvider()) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(
      () => resolve("timeout"),
      OBSERVABILITY_FLUSH_TIMEOUT_MS,
    );
    timer.unref?.();
  });
  try {
    const outcome = await Promise.race([
      forceFlushProviders().then(() => "flushed" as const),
      timeout,
    ]);
    if (outcome === "timeout") recordFlushFailure("timeout");
  } catch (error) {
    recordFlushFailure(flushErrorType(error));
  } finally {
    clearTimeout(timer);
  }
}
