import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { isServerlessRuntime, registerObservabilityProvider, unregister } =
  vi.hoisted(() => {
    const unregister = vi.fn();
    return {
      unregister,
      isServerlessRuntime: vi.fn(() => false),
      registerObservabilityProvider: vi.fn(() => unregister),
    };
  });

vi.mock("@agent-native/core/server", () => ({
  isServerlessRuntime,
  registerObservabilityProvider,
}));

import { type AgentNativeOtelHandle, startAgentNativeOtel } from "./index.js";

const ENDPOINT = "https://collector.example.test/otlp";

const OTEL_KEYS = [
  "OTEL_EXPORTER_OTLP_ENDPOINT",
  "OTEL_EXPORTER_OTLP_METRICS_ENDPOINT",
  "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
  "OTEL_METRICS_EXPORTER",
  "OTEL_TRACES_EXPORTER",
  "OTEL_TRACES_SAMPLER",
  "OTEL_TRACES_SAMPLER_ARG",
];

let handle: AgentNativeOtelHandle | undefined;

beforeEach(() => {
  for (const key of OTEL_KEYS) vi.stubEnv(key, "");
});

afterEach(async () => {
  await handle?.shutdown();
  handle = undefined;
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

interface StartedSpan {
  isRecording(): boolean;
  end(): void;
}

function registered() {
  return registerObservabilityProvider.mock.calls[0]?.[0] as
    | {
        meterProvider?: { getMeter: unknown; forceFlush?: unknown };
        tracerProvider?: {
          getTracer: (name: string) => {
            startSpan(name: string): StartedSpan;
          };
          forceFlush?: unknown;
        };
      }
    | undefined;
}

describe("startAgentNativeOtel", () => {
  it("does nothing without an OTLP endpoint", () => {
    handle = startAgentNativeOtel();

    expect(handle).toBeUndefined();
    expect(registerObservabilityProvider).not.toHaveBeenCalled();
  });

  it("registers meter and tracer providers when an endpoint is set", () => {
    vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", ENDPOINT);
    handle = startAgentNativeOtel();

    expect(handle).toBeDefined();
    expect(registered()?.meterProvider?.getMeter).toBeTypeOf("function");
    expect(registered()?.tracerProvider?.getTracer).toBeTypeOf("function");
  });

  it("starts only the signal whose own endpoint is set", () => {
    vi.stubEnv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", `${ENDPOINT}/v1/traces`);
    handle = startAgentNativeOtel();

    expect(handle).toBeDefined();
    expect(registered()?.meterProvider).toBeUndefined();
    expect(registered()?.tracerProvider).toBeDefined();
  });

  it("exposes forceFlush to core when core reports a serverless runtime", () => {
    isServerlessRuntime.mockReturnValue(true);
    vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", ENDPOINT);
    handle = startAgentNativeOtel();

    expect(handle?.flushOnResponse).toBe(true);
    expect(registered()?.meterProvider?.forceFlush).toBeTypeOf("function");
    expect(registered()?.tracerProvider?.forceFlush).toBeTypeOf("function");
  });

  it("leaves long-running servers on the periodic export", () => {
    isServerlessRuntime.mockReturnValue(false);
    vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", ENDPOINT);
    handle = startAgentNativeOtel();

    expect(handle?.flushOnResponse).toBe(false);
    expect(registered()?.meterProvider?.forceFlush).toBeUndefined();
    expect(registered()?.tracerProvider?.forceFlush).toBeUndefined();
  });

  it("skips a signal whose exporter is set to none", () => {
    vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", ENDPOINT);
    vi.stubEnv("OTEL_TRACES_EXPORTER", "none");
    handle = startAgentNativeOtel();

    expect(registered()?.meterProvider).toBeDefined();
    expect(registered()?.tracerProvider).toBeUndefined();
  });

  it("rejects an exporter it cannot build instead of sending OTLP", () => {
    vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", ENDPOINT);
    vi.stubEnv("OTEL_METRICS_EXPORTER", "console");

    expect(() => startAgentNativeOtel()).toThrow(
      'OTEL_METRICS_EXPORTER="console" is not supported',
    );
    expect(registerObservabilityProvider).not.toHaveBeenCalled();
  });

  it("rejects an unsupported exporter even without an endpoint", () => {
    vi.stubEnv("OTEL_TRACES_EXPORTER", "console");

    expect(() => startAgentNativeOtel()).toThrow(
      'OTEL_TRACES_EXPORTER="console" is not supported',
    );
    expect(registerObservabilityProvider).not.toHaveBeenCalled();
  });

  it("applies OTEL_TRACES_SAMPLER to the tracer provider", () => {
    vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", ENDPOINT);
    vi.stubEnv("OTEL_TRACES_SAMPLER", "always_off");
    handle = startAgentNativeOtel();

    const span = registered()
      ?.tracerProvider?.getTracer("test")
      .startSpan("sampled-out");
    span?.end();

    expect(span?.isRecording()).toBe(false);
  });

  it("returns the running instance on a second call", () => {
    vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", ENDPOINT);
    handle = startAgentNativeOtel();

    expect(startAgentNativeOtel()).toBe(handle);
    expect(registerObservabilityProvider).toHaveBeenCalledOnce();
  });

  it("unregisters from core on shutdown", async () => {
    vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", ENDPOINT);
    handle = startAgentNativeOtel();

    await handle?.shutdown();
    handle = undefined;

    expect(unregister).toHaveBeenCalledOnce();
  });
});
