import { afterEach, describe, expect, it } from "vitest";

import {
  type AgentSpan,
  SPAN_STATUS_ERROR,
  SPAN_STATUS_OK,
  __resetAgentTracerCache,
  __setAgentTraceRuntimeForTests,
  __setAgentTracerForTests,
  endAgentSpan,
  startAgentSpan,
  withAgentSpanContext,
} from "./tracing.js";

/**
 * In-memory test tracer standing in for a registered OpenTelemetry provider.
 * Records every span and its attributes/status so we can assert the helper
 * emits the expected span names and attributes when a provider IS present.
 */
interface RecordedSpan {
  name: string;
  attributes: Record<string, string | number | boolean>;
  status?: { code: number; message?: string };
  exceptions: Array<{ name?: string; message: string }>;
  ended: boolean;
}

function createTestTracer() {
  const spans: RecordedSpan[] = [];
  const tracer = {
    startSpan(
      name: string,
      options?: { attributes?: Record<string, string | number | boolean> },
    ): AgentSpan {
      const recorded: RecordedSpan = {
        name,
        attributes: { ...(options?.attributes ?? {}) },
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
        end() {
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
    // Must not throw.
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
