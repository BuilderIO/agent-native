import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  METRICS_FLUSH_MIN_INTERVAL_MS,
  OBSERVABILITY_FLUSH_TIMEOUT_MS,
  __resetFlushFailureLogForTests,
  flushObservability,
  recordActionChangeMarkerFailure,
  recordAgentRun,
  recordAgentToolCall,
  recordGenAiChat,
  recordHttpServerRequest,
} from "./metrics.js";
import {
  type ObservabilityProvider,
  registerObservabilityProvider,
} from "./otel-provider.js";
import { __resetAgentTracerCache, startAgentSpan } from "./tracing.js";

interface Recorded {
  instrument: string;
  value: number;
  attributes?: Record<string, string | number>;
}

function createTestMeterProvider(forceFlush?: () => Promise<void>): NonNullable<
  ObservabilityProvider["meterProvider"]
> & {
  recorded: Recorded[];
  created: Array<{ name: string; options?: unknown }>;
} {
  const recorded: Recorded[] = [];
  const created: Array<{ name: string; options?: unknown }> = [];
  const meter = {
    createHistogram(name: string, options?: unknown) {
      created.push({ name, options });
      return {
        record: (value: number, attributes?: Record<string, string | number>) =>
          recorded.push({ instrument: name, value, attributes }),
      };
    },
    createCounter(name: string, options?: unknown) {
      created.push({ name, options });
      return {
        add: (value: number, attributes?: Record<string, string | number>) =>
          recorded.push({ instrument: name, value, attributes }),
      };
    },
  };
  return {
    recorded,
    created,
    getMeter: () => meter,
    ...(forceFlush ? { forceFlush } : {}),
  };
}

let unregister: (() => void) | undefined;

function register(provider: ObservabilityProvider) {
  unregister = registerObservabilityProvider(provider);
}

afterEach(() => {
  unregister?.();
  unregister = undefined;
  vi.useRealTimers();
});

describe("recordHttpServerRequest", () => {
  it("is a no-op when no provider is registered", () => {
    expect(() =>
      recordHttpServerRequest({
        method: "GET",
        statusCode: 200,
        durationMs: 5,
      }),
    ).not.toThrow();
  });

  it("records duration in seconds with Stable HTTP semconv attributes", () => {
    const meterProvider = createTestMeterProvider();
    register({ meterProvider });

    recordHttpServerRequest({
      method: "post",
      statusCode: 201,
      durationMs: 250,
      route: "/_agent-native/actions/:action",
    });

    expect(meterProvider.recorded).toEqual([
      {
        instrument: "http.server.request.duration",
        value: 0.25,
        attributes: {
          "http.request.method": "POST",
          "http.response.status_code": 201,
          "http.route": "/_agent-native/actions/:action",
        },
      },
    ]);
  });

  it("declares the eight-bucket histogram in seconds", () => {
    const meterProvider = createTestMeterProvider();
    register({ meterProvider });

    recordHttpServerRequest({ method: "GET", statusCode: 200, durationMs: 1 });

    expect(meterProvider.created).toContainEqual({
      name: "http.server.request.duration",
      options: expect.objectContaining({
        unit: "s",
        advice: {
          explicitBucketBoundaries: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
        },
      }),
    });
  });

  it("sets error.type to the status code for 5xx only", () => {
    const meterProvider = createTestMeterProvider();
    register({ meterProvider });

    recordHttpServerRequest({ method: "GET", statusCode: 503, durationMs: 1 });
    recordHttpServerRequest({ method: "GET", statusCode: 404, durationMs: 1 });

    expect(meterProvider.recorded[0].attributes?.["error.type"]).toBe("503");
    expect(meterProvider.recorded[1].attributes).not.toHaveProperty(
      "error.type",
    );
  });

  it("buckets unknown methods as _OTHER and omits a missing route", () => {
    const meterProvider = createTestMeterProvider();
    register({ meterProvider });

    recordHttpServerRequest({
      method: "PROPFIND",
      statusCode: 405,
      durationMs: 1,
    });

    expect(meterProvider.recorded[0].attributes).toEqual({
      "http.request.method": "_OTHER",
      "http.response.status_code": 405,
    });
  });

  it("creates instruments against a newly registered provider", () => {
    const first = createTestMeterProvider();
    register({ meterProvider: first });
    recordHttpServerRequest({ method: "GET", statusCode: 200, durationMs: 1 });

    const second = createTestMeterProvider();
    register({ meterProvider: second });
    recordHttpServerRequest({ method: "GET", statusCode: 200, durationMs: 1 });

    expect(first.recorded).toHaveLength(1);
    expect(second.recorded).toHaveLength(1);
  });
});

describe("GenAI and agent metrics", () => {
  it("records a chat call's duration and both token types", () => {
    const meterProvider = createTestMeterProvider();
    register({ meterProvider });

    recordGenAiChat({
      requestModel: "claude-test",
      providerName: "anthropic",
      supportedModels: ["claude-test"],
      durationMs: 1_500,
      inputTokens: 120,
      outputTokens: 30,
    });

    const attributes = {
      "gen_ai.operation.name": "chat",
      "gen_ai.request.model": "claude-test",
      "gen_ai.provider.name": "anthropic",
    };
    expect(meterProvider.recorded).toEqual([
      {
        instrument: "gen_ai.client.operation.duration",
        value: 1.5,
        attributes,
      },
      {
        instrument: "gen_ai.client.token.usage",
        value: 120,
        attributes: { ...attributes, "gen_ai.token.type": "input" },
      },
      {
        instrument: "gen_ai.client.token.usage",
        value: 30,
        attributes: { ...attributes, "gen_ai.token.type": "output" },
      },
    ]);
  });

  it("marks a failed chat call with error.type and skips unknown tokens", () => {
    const meterProvider = createTestMeterProvider();
    register({ meterProvider });

    recordGenAiChat({
      requestModel: "m",
      supportedModels: ["m"],
      durationMs: 10,
      failed: true,
    });

    expect(meterProvider.recorded).toEqual([
      {
        instrument: "gen_ai.client.operation.duration",
        value: 0.01,
        attributes: {
          "gen_ai.operation.name": "chat",
          "gen_ai.request.model": "m",
          "error.type": "_OTHER",
        },
      },
    ]);
  });

  it("collapses models outside the engine's supported list to _OTHER", () => {
    const meterProvider = createTestMeterProvider();
    register({ meterProvider });

    recordGenAiChat({
      requestModel: "caller-supplied-model",
      supportedModels: ["claude-test"],
      durationMs: 10,
    });
    recordAgentRun({
      status: "completed",
      terminalReason: "done",
      requestModel: "caller-supplied-model",
      supportedModels: [],
    });

    expect(
      meterProvider.recorded.map(
        (entry) => entry.attributes?.["gen_ai.request.model"],
      ),
    ).toEqual(["_OTHER", "_OTHER"]);
  });

  it("drops the open-ended suffix from terminal reasons", () => {
    const meterProvider = createTestMeterProvider();
    register({ meterProvider });

    recordAgentRun({
      status: "errored",
      terminalReason: "error:provider_rate_limited",
      requestModel: "claude-test",
      supportedModels: ["claude-test"],
    });
    recordAgentRun({ status: "completed", terminalReason: "done" });

    expect(meterProvider.recorded).toEqual([
      {
        instrument: "agent_native.agent.runs",
        value: 1,
        attributes: {
          status: "errored",
          terminal_reason: "error",
          "gen_ai.request.model": "claude-test",
        },
      },
      {
        instrument: "agent_native.agent.runs",
        value: 1,
        attributes: { status: "completed", terminal_reason: "done" },
      },
    ]);
  });

  it("keeps built-in tool names and collapses app tools to other", () => {
    const meterProvider = createTestMeterProvider();
    register({ meterProvider });

    recordAgentToolCall({ toolName: "explain-access" });
    recordAgentToolCall({ toolName: "my-app-tool", errorType: "tool_error" });
    recordAgentToolCall({ toolName: "toString" });

    expect(meterProvider.recorded.map((r) => r.attributes)).toEqual([
      { "gen_ai.tool.name": "explain-access" },
      { "gen_ai.tool.name": "other", "error.type": "tool_error" },
      { "gen_ai.tool.name": "other" },
    ]);
  });
});

describe("recordActionChangeMarkerFailure", () => {
  it("counts one failed marker write by error name", () => {
    const meterProvider = createTestMeterProvider();
    register({ meterProvider });

    recordActionChangeMarkerFailure(new TypeError("database unavailable"));

    expect(meterProvider.recorded).toEqual([
      {
        instrument: "agent_native.action_change.marker_failures",
        value: 1,
        attributes: { "error.type": "TypeError" },
      },
    ]);
  });
});

describe("flushObservability", () => {
  it("force-flushes both providers", async () => {
    const meterFlush = vi.fn(async () => {});
    const traceFlush = vi.fn(async () => {});
    register({
      meterProvider: createTestMeterProvider(meterFlush),
      tracerProvider: { getTracer: () => ({}), forceFlush: traceFlush },
    });

    await flushObservability();

    expect(meterFlush).toHaveBeenCalledOnce();
    expect(traceFlush).toHaveBeenCalledOnce();
  });

  it("gives up after the timeout and counts the dropped flush", async () => {
    vi.useFakeTimers();
    const meterProvider = createTestMeterProvider(
      () => new Promise<void>(() => {}),
    );
    register({ meterProvider });

    const flushed = flushObservability();
    await vi.advanceTimersByTimeAsync(OBSERVABILITY_FLUSH_TIMEOUT_MS);
    await flushed;

    expect(meterProvider.recorded).toContainEqual({
      instrument: "agent_native.telemetry.flush_failures",
      value: 1,
      attributes: {
        "agent_native.telemetry.signal": "metrics",
        "error.type": "timeout",
      },
    });
  });

  it("logs a timed-out flush once per process, outside the OTLP export", async () => {
    vi.useFakeTimers();
    __resetFlushFailureLogForTests();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const meterProvider = createTestMeterProvider(
      () => new Promise<void>(() => undefined),
    );
    register({ meterProvider });

    for (let i = 0; i < 2; i++) {
      const flushed = flushObservability();
      await vi.advanceTimersByTimeAsync(METRICS_FLUSH_MIN_INTERVAL_MS);
      await flushed;
    }

    const lines = warn.mock.calls
      .map((call) => String(call[0]))
      .filter((line) => line.includes("agent-native.telemetry_flush_failed"))
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      signal: "metrics",
      error_type: "timeout",
      timeout_ms: OBSERVABILITY_FLUSH_TIMEOUT_MS,
    });
    warn.mockRestore();
  });

  it("caps distinct flush-failure kinds it logs per process", async () => {
    vi.useFakeTimers();
    __resetFlushFailureLogForTests();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let attempt = 0;
    const meterProvider = createTestMeterProvider(async () => {
      const error = new Error("export failed");
      error.name = `ExportError${attempt++}`;
      throw error;
    });
    register({ meterProvider });

    for (let i = 0; i < 20; i++) {
      await flushObservability();
      vi.setSystemTime(Date.now() + METRICS_FLUSH_MIN_INTERVAL_MS);
    }
    expect(attempt).toBe(20);

    const lines = warn.mock.calls.filter((call) =>
      String(call[0]).includes("agent-native.telemetry_flush_failed"),
    );
    expect(lines).toHaveLength(8);
    warn.mockRestore();
  });

  it("counts a flush whose timer fired long after its deadline as suspended", async () => {
    vi.useFakeTimers();
    const meterProvider = createTestMeterProvider(
      () => new Promise<void>(() => {}),
    );
    register({ meterProvider });

    const flushed = flushObservability();
    // A frozen process: wall-clock time passes but no timers run.
    vi.setSystemTime(Date.now() + 60_000);
    await vi.advanceTimersByTimeAsync(OBSERVABILITY_FLUSH_TIMEOUT_MS);
    await flushed;

    expect(meterProvider.recorded).toContainEqual({
      instrument: "agent_native.telemetry.flush_failures",
      value: 1,
      attributes: {
        "agent_native.telemetry.signal": "metrics",
        "error.type": "suspended",
      },
    });
  });

  it("counts a failed flush by error name instead of throwing", async () => {
    const meterProvider = createTestMeterProvider(async () => {
      throw new TypeError("exporter blew up");
    });
    register({ meterProvider });

    await expect(flushObservability()).resolves.toBeUndefined();

    expect(meterProvider.recorded).toContainEqual({
      instrument: "agent_native.telemetry.flush_failures",
      value: 1,
      attributes: {
        "agent_native.telemetry.signal": "metrics",
        "error.type": "TypeError",
      },
    });
  });

  it("waits for the other provider when one flush fails", async () => {
    vi.useFakeTimers();
    let traceFlushed = false;
    const meterProvider = createTestMeterProvider(async () => {
      throw new TypeError("exporter blew up");
    });
    register({
      meterProvider,
      tracerProvider: {
        getTracer: () => ({}),
        forceFlush: () =>
          new Promise<void>((resolve) =>
            setTimeout(() => {
              traceFlushed = true;
              resolve();
            }, 500),
          ),
      },
    });

    let settled = false;
    const flushed = flushObservability().then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(400);
    await flushed;

    expect(traceFlushed).toBe(true);
    expect(meterProvider.recorded).toEqual([
      {
        instrument: "agent_native.telemetry.flush_failures",
        value: 1,
        attributes: {
          "agent_native.telemetry.signal": "metrics",
          "error.type": "TypeError",
        },
      },
    ]);
  });

  it("counts each provider's failure independently under the timeout", async () => {
    vi.useFakeTimers();
    const meterProvider = createTestMeterProvider(async () => {
      throw new TypeError("exporter blew up");
    });
    register({
      meterProvider,
      tracerProvider: {
        getTracer: () => ({}),
        forceFlush: () => new Promise<void>(() => {}),
      },
    });

    const flushed = flushObservability();
    await vi.advanceTimersByTimeAsync(OBSERVABILITY_FLUSH_TIMEOUT_MS);
    await flushed;

    expect(meterProvider.recorded).toEqual([
      {
        instrument: "agent_native.telemetry.flush_failures",
        value: 1,
        attributes: {
          "agent_native.telemetry.signal": "metrics",
          "error.type": "TypeError",
        },
      },
      {
        instrument: "agent_native.telemetry.flush_failures",
        value: 1,
        attributes: {
          "agent_native.telemetry.signal": "traces",
          "error.type": "timeout",
        },
      },
    ]);
  });

  it("exports metrics at most once per interval and spans on every call", async () => {
    vi.useFakeTimers();
    const meterFlush = vi.fn(async () => {});
    const traceFlush = vi.fn(async () => {});
    register({
      meterProvider: createTestMeterProvider(meterFlush),
      tracerProvider: { getTracer: () => ({}), forceFlush: traceFlush },
    });

    await flushObservability();
    vi.setSystemTime(Date.now() + METRICS_FLUSH_MIN_INTERVAL_MS - 1);
    await flushObservability();
    expect(meterFlush).toHaveBeenCalledTimes(1);
    expect(traceFlush).toHaveBeenCalledTimes(2);

    vi.setSystemTime(Date.now() + 1);
    await flushObservability();
    expect(meterFlush).toHaveBeenCalledTimes(2);
    expect(traceFlush).toHaveBeenCalledTimes(3);
  });

  it("does not retry a failed metric export before the interval", async () => {
    vi.useFakeTimers();
    const meterFlush = vi.fn(async () => {
      throw new TypeError("collector down");
    });
    register({ meterProvider: createTestMeterProvider(meterFlush) });

    for (let i = 0; i < 5; i++) await flushObservability();

    expect(meterFlush).toHaveBeenCalledOnce();
  });

  it("exports at once for a newly registered meter provider", async () => {
    const first = vi.fn(async () => {});
    const second = vi.fn(async () => {});
    register({ meterProvider: createTestMeterProvider(first) });
    await flushObservability();
    register({ meterProvider: createTestMeterProvider(second) });
    await flushObservability();

    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
  });

  it("does not count a flush that finished in time", async () => {
    const meterProvider = createTestMeterProvider(async () => {});
    register({ meterProvider });

    await flushObservability();

    expect(meterProvider.recorded).toEqual([]);
  });
});

describe("registerObservabilityProvider tracing", () => {
  beforeEach(() => {
    __resetAgentTracerCache();
  });

  afterEach(() => {
    __resetAgentTracerCache();
  });

  it("starts spans on the registered tracer provider", async () => {
    const started: string[] = [];
    const span = {
      setAttribute() {},
      setAttributes() {},
      setStatus() {},
      recordException() {},
      end() {},
    };
    register({
      tracerProvider: {
        getTracer: () => ({
          startSpan: (name: string) => {
            started.push(name);
            return span;
          },
        }),
      },
    });

    await startAgentSpan("agent.run");

    expect(started).toEqual(["agent.run"]);
  });

  it("stops using a provider once it is unregistered", async () => {
    const started: string[] = [];
    register({
      tracerProvider: {
        getTracer: () => ({
          startSpan: (name: string) => {
            started.push(name);
            return {
              setAttribute() {},
              setAttributes() {},
              setStatus() {},
              recordException() {},
              end() {},
            };
          },
        }),
      },
    });
    await startAgentSpan("agent.run");
    unregister?.();
    unregister = undefined;

    await startAgentSpan("agent.run");

    expect(started).toEqual(["agent.run"]);
  });
});
