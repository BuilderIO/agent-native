import { randomUUID } from "node:crypto";

import {
  isServerlessRuntime,
  registerObservabilityProvider,
  type ObservabilityMeterProvider,
  type ObservabilityProvider,
  type ObservabilityTracerProvider,
} from "@agent-native/core/server";
import { context } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-proto";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import {
  type Resource,
  defaultResource,
  detectResources,
  envDetector,
  resourceFromAttributes,
} from "@opentelemetry/resources";
import {
  AggregationTemporality,
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import {
  BasicTracerProvider,
  BatchSpanProcessor,
} from "@opentelemetry/sdk-trace-base";

const METRIC_EXPORT_INTERVAL_MS = 60_000;

export interface AgentNativeOtelHandle {
  readonly flushOnResponse: boolean;
  shutdown(): Promise<void>;
}

let started: AgentNativeOtelHandle | undefined;

type Signal = "METRICS" | "TRACES";

function envValue(key: string): string | undefined {
  return process.env[key]?.trim() || undefined;
}

// A signal exports when an OTLP endpoint applies to it: its own
// OTEL_EXPORTER_OTLP_<SIGNAL>_ENDPOINT or the shared base endpoint. An
// exporter this package cannot build fails startup instead of quietly shipping
// the signal to the collector over OTLP.
function signalEnabled(signal: Signal): boolean {
  const exporterKey = `OTEL_${signal}_EXPORTER`;
  const exporter = envValue(exporterKey)?.toLowerCase() ?? "otlp";
  if (exporter === "none") return false;
  const endpoint =
    envValue(`OTEL_EXPORTER_OTLP_${signal}_ENDPOINT`) ??
    envValue("OTEL_EXPORTER_OTLP_ENDPOINT");
  if (!endpoint) return false;
  if (exporter !== "otlp") {
    throw new Error(
      `${exporterKey}="${exporter}" is not supported by @agent-native/otel. Set it to "otlp" or "none".`,
    );
  }
  return true;
}

// Cumulative counters restart with every process, so each process must be its
// own series. OTEL_RESOURCE_ATTRIBUTES can still override the id.
function buildResource(): Resource {
  return defaultResource()
    .merge(resourceFromAttributes({ "service.instance.id": randomUUID() }))
    .merge(detectResources({ detectors: [envDetector] }));
}

function withoutForceFlush<
  T extends ObservabilityMeterProvider | ObservabilityTracerProvider,
>(provider: T): T {
  return new Proxy(provider, {
    get(target, property, receiver) {
      if (property === "forceFlush") return undefined;
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/**
 * Start the OpenTelemetry SDK and register it with `@agent-native/core`.
 *
 * A no-op returning `undefined` unless an OTLP endpoint is set, either the
 * shared `OTEL_EXPORTER_OTLP_ENDPOINT` or a signal's own
 * `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT` / `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`;
 * only signals with an endpoint start. Everything is read from `process.env`,
 * as the SDK itself does: exporters read the standard `OTEL_EXPORTER_OTLP_*`
 * variables, the resource reads `OTEL_SERVICE_NAME` and
 * `OTEL_RESOURCE_ATTRIBUTES`, and the trace sampler reads
 * `OTEL_TRACES_SAMPLER` / `OTEL_TRACES_SAMPLER_ARG`. Set
 * `OTEL_METRICS_EXPORTER=none` or `OTEL_TRACES_EXPORTER=none` to turn off one
 * signal; any exporter other than `otlp` or `none` throws. Calling it again
 * returns the running instance.
 */
export function startAgentNativeOtel(): AgentNativeOtelHandle | undefined {
  if (started) return started;
  const metricsEnabled = signalEnabled("METRICS");
  const tracesEnabled = signalEnabled("TRACES");
  if (!metricsEnabled && !tracesEnabled) return undefined;

  const resource = buildResource();
  // Serverless functions freeze between invocations, so a periodic reader
  // never fires and core must flush on every response. A long-running server
  // exports on the timer instead of once per request.
  const flushOnResponse = isServerlessRuntime();
  const provider: ObservabilityProvider = {};
  const shutdowns: Array<() => Promise<void>> = [];

  if (metricsEnabled) {
    const meterProvider = new MeterProvider({
      resource,
      readers: [
        new PeriodicExportingMetricReader({
          exporter: new OTLPMetricExporter({
            temporalityPreference: AggregationTemporality.CUMULATIVE,
          }),
          exportIntervalMillis: METRIC_EXPORT_INTERVAL_MS,
        }),
      ],
    });
    provider.meterProvider = flushOnResponse
      ? meterProvider
      : withoutForceFlush(meterProvider);
    shutdowns.push(() => meterProvider.shutdown());
  }

  if (tracesEnabled) {
    context.setGlobalContextManager(
      new AsyncLocalStorageContextManager().enable(),
    );
    const tracerProvider = new BasicTracerProvider({
      resource,
      spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter())],
    });
    provider.tracerProvider = flushOnResponse
      ? tracerProvider
      : withoutForceFlush(tracerProvider);
    shutdowns.push(() => tracerProvider.shutdown());
  }

  const unregister = registerObservabilityProvider(provider);
  const handle: AgentNativeOtelHandle = {
    flushOnResponse,
    async shutdown() {
      unregister();
      if (started === handle) started = undefined;
      await Promise.all(shutdowns.map((shutdown) => shutdown()));
    },
  };
  started = handle;
  return handle;
}
