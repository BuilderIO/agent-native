import { randomUUID } from "node:crypto";

import {
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

type Env = Record<string, string | undefined>;

function signalEnabled(env: Env, key: string): boolean {
  return env[key]?.trim().toLowerCase() !== "none";
}

// Serverless functions freeze between invocations, so a periodic reader never
// fires and core must flush on every response. A long-running server exports
// on the timer instead of once per request.
function isServerlessRuntime(env: Env): boolean {
  return Boolean(
    env.NETLIFY ||
    env.AWS_LAMBDA_FUNCTION_NAME ||
    env.LAMBDA_TASK_ROOT ||
    env.VERCEL,
  );
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
 * A no-op returning `undefined` unless `OTEL_EXPORTER_OTLP_ENDPOINT` is set.
 * Exporters read the standard `OTEL_EXPORTER_OTLP_*` variables, the resource
 * reads `OTEL_SERVICE_NAME` and `OTEL_RESOURCE_ATTRIBUTES`, and the trace
 * sampler reads `OTEL_TRACES_SAMPLER` / `OTEL_TRACES_SAMPLER_ARG`. Set
 * `OTEL_METRICS_EXPORTER=none` or `OTEL_TRACES_EXPORTER=none` to turn off one
 * signal. Calling it again returns the running instance.
 */
export function startAgentNativeOtel(
  env: Env = process.env,
): AgentNativeOtelHandle | undefined {
  if (started) return started;
  if (!env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim()) return undefined;

  const resource = buildResource();
  const flushOnResponse = isServerlessRuntime(env);
  const provider: ObservabilityProvider = {};
  const shutdowns: Array<() => Promise<void>> = [];

  if (signalEnabled(env, "OTEL_METRICS_EXPORTER")) {
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

  if (signalEnabled(env, "OTEL_TRACES_EXPORTER")) {
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
