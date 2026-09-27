import { afterEach, describe, expect, it } from "vitest";

import {
  type AgentSpan,
  SPAN_STATUS_ERROR,
  SPAN_STATUS_OK,
  __resetAgentTracerCache,
  __setAgentTraceRuntimeForTests,
  __setAgentTracerForTests,
  endAgentSpan,
  flushTrackingEvents,
  queueTrackingEvent,
  recordTrackingEvent,
  startAgentSpan,
  withAgentSpanContext,
} from "./tracing.js";

interface RecordedSpan {
  name: string;
  attributes: Record<string, string | number | boolean>;
  startTime?: unknown;
  endTime?: unknown;
  status?: { code: number; message?: string };
  exceptions: Array<{ name?: string; message: string }>;
  ended: boolean;
}

function createTestTracer() {
  const spans: RecordedSpan[] = [];
  const tracer = {
    startSpan(
      name: string,
      options?: {
        attributes?: Record<string, string | number | boolean>;
        startTime?: unknown;
      },
    ): AgentSpan {
      const recorded: RecordedSpan = {
        name,
        attributes: { ...(options?.attributes ?? {}) },
        startTime: options?.startTime,
        exceptions: [],
        ended: false,
      };
      spans.push(recorded);
      return {
        setAttribute(key, value) {
          recorded.attributes[key] = value;
        },
        setAttributes(attributes) {
          Object.assign(recorded.attributes, attributes);
        },
        setStatus(status) {
          recorded.status = status;
        },
        recordException(exception) {
          recorded.exceptions.push(exception);
        },
        end(endTime) {
          recorded.endTime = endTime;
          recorded.ended = true;
        },
      };
    },
  };
  return { tracer, spans };
}

afterEach(() => {
  __resetAgentTracerCache();
});

describe("tracing helper — no provider registered", () => {
  it("startAgentSpan returns null when no tracer is available", async () => {
    __setAgentTracerForTests(null);
    const span = await startAgentSpan("agent.run", { "agent.model": "x" });
    expect(span).toBeNull();
  });

  it("endAgentSpan no-ops safely on a null span", () => {
    expect(() =>
      endAgentSpan(null, { status: "error", errorMessage: "boom" }),
    ).not.toThrow();
  });
});

describe("tracing helper — test provider registered", () => {
  it("startAgentSpan creates a span with the given name and attributes", async () => {
    const { tracer, spans } = createTestTracer();
    __setAgentTracerForTests(tracer as any);

    const span = await startAgentSpan("tool.call", {
      "tool.name": "read",
      "agent.run_id": "run-1",
    });
    expect(span).not.toBeNull();
    expect(spans).toHaveLength(1);
    expect(spans[0].name).toBe("tool.call");
    expect(spans[0].attributes).toEqual({
      "tool.name": "read",
      "agent.run_id": "run-1",
    });
  });

  it("prunes null/undefined attributes", async () => {
    const { tracer, spans } = createTestTracer();
    __setAgentTracerForTests(tracer as any);

    await startAgentSpan("agent.run", {
      "agent.model": "claude",
      "agent.thread_id": undefined,
      "agent.user_id": null,
    });
    expect(spans[0].attributes).toEqual({ "agent.model": "claude" });
  });

  it("endAgentSpan sets OK status and ends the span on success", async () => {
    const { tracer, spans } = createTestTracer();
    __setAgentTracerForTests(tracer as any);

    const span = await startAgentSpan("llm.call");
    endAgentSpan(span, {
      status: "success",
      attributes: { "llm.input_tokens": 42 },
    });

    expect(spans[0].status?.code).toBe(SPAN_STATUS_OK);
    expect(spans[0].attributes["llm.input_tokens"]).toBe(42);
    expect(spans[0].ended).toBe(true);
    expect(spans[0].exceptions).toHaveLength(0);
  });

  it("endAgentSpan sets ERROR status and records the exception on error", async () => {
    const { tracer, spans } = createTestTracer();
    __setAgentTracerForTests(tracer as any);

    const span = await startAgentSpan("tool.call", { "tool.name": "db-exec" });
    endAgentSpan(span, { status: "error", errorMessage: "Error: failed" });

    expect(spans[0].status?.code).toBe(SPAN_STATUS_ERROR);
    expect(spans[0].status?.message).toBe("Error: failed");
    expect(spans[0].exceptions).toEqual([{ message: "Error: failed" }]);
    expect(spans[0].ended).toBe(true);
  });

  it("mirrors timing tracking events into low-cardinality OTel spans", async () => {
    const { tracer, spans } = createTestTracer();
    __setAgentTracerForTests(tracer as any);

    await recordTrackingEvent(
      "http.response",
      {
        source: "server",
        action_name: "list-visual-plans",
        method: "GET",
        path: "/_agent-native/actions/list-visual-plans",
        route_template: "/_agent-native/actions/:action",
        status_code: 200,
        duration_ms: 42,
        request_id: "request-1",
      },
      "server",
    );

    expect(spans[0]).toMatchObject({
      name: "http.server",
      attributes: {
        "agent.event_name": "http.response",
        "agent.source": "server",
        "agent.telemetry_source": "server",
        "agent.action": "list-visual-plans",
        "http.method": "GET",
        "http.route": "/_agent-native/actions/:action",
        "http.status_code": 200,
        "agent.duration_ms": 42,
      },
      status: { code: SPAN_STATUS_OK },
      ended: true,
    });
    expect(spans[0]?.startTime).toEqual(expect.any(Number));
    expect(spans[0]?.endTime).toEqual(expect.any(Number));
  });

  it("marks client transport failures as OTel errors", async () => {
    const { tracer, spans } = createTestTracer();
    __setAgentTracerForTests(tracer as any);

    await recordTrackingEvent(
      "action.response",
      {
        action: "get-deck",
        outcome: "network-error",
        caller: "frontend",
        path: "/users/customer-secret",
        success: false,
        status_code: 100001,
        duration_ms: 18,
      },
      "client",
    );

    expect(spans[0]).toMatchObject({
      name: "action.client",
      attributes: {
        "agent.success": false,
      },
      status: { code: SPAN_STATUS_ERROR },
      ended: true,
    });
    expect(spans[0]?.attributes).not.toHaveProperty("agent.action");
    expect(spans[0]?.attributes).not.toHaveProperty("agent.event_name");
    expect(spans[0]?.attributes).not.toHaveProperty("agent.outcome");
    expect(spans[0]?.attributes).not.toHaveProperty("http.route");
    expect(spans[0]?.attributes).not.toHaveProperty("http.status_code");
    expect(spans[0]?.attributes).not.toHaveProperty("http.status_class");
  });

  it("does not export client-provided string dimensions", async () => {
    const { tracer, spans } = createTestTracer();
    __setAgentTracerForTests(tracer as any);

    await recordTrackingEvent(
      "action.response",
      {
        action: "customer-secret",
        caller: "attacker-controlled",
        outcome: "arbitrary-user-content",
        path: "/customer-secret",
        duration_ms: 18,
      },
      "client",
    );

    expect(spans[0]?.attributes).toEqual(
      expect.not.objectContaining({
        "agent.action": "customer-secret",
        "agent.caller": "attacker-controlled",
        "agent.outcome": "arbitrary-user-content",
        "http.route": "/customer-secret",
      }),
    );
  });

  it("does not export unresolved direct A2A action names", async () => {
    const { tracer, spans } = createTestTracer();
    __setAgentTracerForTests(tracer as any);

    await recordTrackingEvent(
      "$a2a_read_invoke",
      { action: "caller-controlled-action", duration_ms: 18 },
      "server",
    );

    expect(spans[0]?.attributes).not.toHaveProperty("agent.action");
  });

  it("does not turn ordinary analytics events into spans", async () => {
    const { tracer, spans } = createTestTracer();
    __setAgentTracerForTests(tracer as any);

    await recordTrackingEvent("share_link_copied", {
      resource_id: "resource-1",
    });

    expect(spans).toHaveLength(0);
  });

  it("does not turn arbitrary duration events into spans", async () => {
    const { tracer, spans } = createTestTracer();
    __setAgentTracerForTests(tracer as any);

    await recordTrackingEvent("request_123", { duration_ms: 42 });

    expect(spans).toHaveLength(0);
  });

  it("flushes queued server tracking spans", async () => {
    const { tracer, spans } = createTestTracer();
    __setAgentTracerForTests(tracer as any);

    queueTrackingEvent("http.response", { duration_ms: 42 }, "server");
    await flushTrackingEvents();

    expect(spans[0]?.ended).toBe(true);
  });

  it("installs a span as the active context for child spans", async () => {
    const { tracer } = createTestTracer();
    let activeSpan: AgentSpan | null = null;
    __setAgentTraceRuntimeForTests({
      tracer: tracer as any,
      context: {
        active: () => activeSpan,
        with<T>(context: unknown, callback: () => T): T {
          const previous = activeSpan;
          activeSpan = context as AgentSpan;
          let result: T;
          try {
            result = callback();
          } catch (error) {
            activeSpan = previous;
            throw error;
          }
          if (
            typeof (result as unknown as { then?: unknown } | null | undefined)
              ?.then === "function"
          ) {
            return (result as unknown as Promise<unknown>).finally(() => {
              activeSpan = previous;
            }) as T;
          }
          activeSpan = previous;
          return result;
        },
      },
      trace: {
        setSpan: (_context: unknown, span: AgentSpan) => span,
      },
    });

    const rootSpan = await startAgentSpan("agent.run");
    await withAgentSpanContext(rootSpan, async () => {
      expect(activeSpan).toBe(rootSpan);
      await Promise.resolve();
      expect(activeSpan).toBe(rootSpan);
    });
    expect(activeSpan).toBeNull();
  });
});
