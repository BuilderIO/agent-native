import { afterEach, describe, expect, it, vi } from "vitest";

const { registerObservabilityProvider, unregister } = vi.hoisted(() => {
  const unregister = vi.fn();
  return {
    unregister,
    registerObservabilityProvider: vi.fn(() => unregister),
  };
});

vi.mock("@agent-native/core/server", () => ({
  registerObservabilityProvider,
}));

import { type AgentNativeOtelHandle, startAgentNativeOtel } from "./index.js";

const ENDPOINT = "https://collector.example.test/otlp";

let handle: AgentNativeOtelHandle | undefined;

afterEach(async () => {
  await handle?.shutdown();
  handle = undefined;
  vi.clearAllMocks();
});

function registered() {
  return registerObservabilityProvider.mock.calls[0]?.[0] as
    | {
        meterProvider?: { getMeter: unknown; forceFlush?: unknown };
        tracerProvider?: { getTracer: unknown; forceFlush?: unknown };
      }
    | undefined;
}

describe("startAgentNativeOtel", () => {
  it("does nothing without OTEL_EXPORTER_OTLP_ENDPOINT", () => {
    handle = startAgentNativeOtel({});

    expect(handle).toBeUndefined();
    expect(registerObservabilityProvider).not.toHaveBeenCalled();
  });

  it("registers meter and tracer providers when an endpoint is set", () => {
    handle = startAgentNativeOtel({ OTEL_EXPORTER_OTLP_ENDPOINT: ENDPOINT });

    expect(handle).toBeDefined();
    expect(registered()?.meterProvider?.getMeter).toBeTypeOf("function");
    expect(registered()?.tracerProvider?.getTracer).toBeTypeOf("function");
  });

  it("exposes forceFlush to core on serverless runtimes", () => {
    handle = startAgentNativeOtel({
      OTEL_EXPORTER_OTLP_ENDPOINT: ENDPOINT,
      NETLIFY: "true",
    });

    expect(handle?.flushOnResponse).toBe(true);
    expect(registered()?.meterProvider?.forceFlush).toBeTypeOf("function");
    expect(registered()?.tracerProvider?.forceFlush).toBeTypeOf("function");
  });

  it("leaves long-running servers on the periodic export", () => {
    handle = startAgentNativeOtel({ OTEL_EXPORTER_OTLP_ENDPOINT: ENDPOINT });

    expect(handle?.flushOnResponse).toBe(false);
    expect(registered()?.meterProvider?.forceFlush).toBeUndefined();
    expect(registered()?.tracerProvider?.forceFlush).toBeUndefined();
  });

  it("skips a signal whose exporter is set to none", () => {
    handle = startAgentNativeOtel({
      OTEL_EXPORTER_OTLP_ENDPOINT: ENDPOINT,
      OTEL_TRACES_EXPORTER: "none",
    });

    expect(registered()?.meterProvider).toBeDefined();
    expect(registered()?.tracerProvider).toBeUndefined();
  });

  it("returns the running instance on a second call", () => {
    handle = startAgentNativeOtel({ OTEL_EXPORTER_OTLP_ENDPOINT: ENDPOINT });

    expect(
      startAgentNativeOtel({ OTEL_EXPORTER_OTLP_ENDPOINT: ENDPOINT }),
    ).toBe(handle);
    expect(registerObservabilityProvider).toHaveBeenCalledOnce();
  });

  it("unregisters from core on shutdown", async () => {
    handle = startAgentNativeOtel({ OTEL_EXPORTER_OTLP_ENDPOINT: ENDPOINT });

    await handle?.shutdown();
    handle = undefined;

    expect(unregister).toHaveBeenCalledOnce();
  });
});
