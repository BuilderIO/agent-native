import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  OBSERVABILITY_FLUSH_TIMEOUT_MS,
  flushObservability,
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
      attributes: { "error.type": "timeout" },
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
      attributes: { "error.type": "TypeError" },
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
        attributes: { "error.type": "TypeError" },
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
        attributes: { "error.type": "TypeError" },
      },
      {
        instrument: "agent_native.telemetry.flush_failures",
        value: 1,
        attributes: { "error.type": "timeout" },
      },
    ]);
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
