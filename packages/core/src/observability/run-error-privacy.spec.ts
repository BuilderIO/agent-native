import { afterEach, describe, expect, it, vi } from "vitest";

import { EngineError } from "../agent/engine/types.js";
import { observabilityConfig } from "../app-config/observability.js";
import {
  registerTrackingProvider,
  unregisterTrackingProvider,
} from "../tracking/registry.js";
import type { TrackingEvent } from "../tracking/types.js";
import { emitAiTraceEvent } from "./posthog-ai.js";
import * as store from "./store.js";
import { instrumentAgentLoop } from "./traces.js";
import {
  __setAgentTracerForTests,
  __resetAgentTracerCache,
} from "./tracing.js";
import type { TraceSpan } from "./types.js";

const message = "Jane Doe's notes are locked";
const loopOpts: any = {
  engine: { name: "builder" },
  model: "gpt-test",
  systemPrompt: "",
  tools: [],
  messages: [],
  actions: {},
  send: () => {},
  signal: new AbortController().signal,
};

describe("run failure telemetry privacy", () => {
  afterEach(() => {
    unregisterTrackingProvider("run-error-privacy");
    vi.restoreAllMocks();
    __resetAgentTracerCache();
  });

  function capture() {
    const events: TrackingEvent[] = [];
    const spans: TraceSpan[] = [];
    registerTrackingProvider({
      name: "run-error-privacy",
      track: (event) => {
        events.push(event);
      },
    });
    vi.spyOn(store, "insertTraceSpan").mockImplementation(async (span) => {
      spans.push(span);
    });
    vi.spyOn(store, "upsertTraceSummary").mockResolvedValue(undefined);
    return { events, spans };
  }

  it("omits named failures from optional OpenTelemetry run, model, and tool exports", async () => {
    const { spans } = capture();
    const exported: unknown[] = [];
    __setAgentTracerForTests({
      startSpan: () => ({
        setAttribute: (key: string, value: unknown) => {
          exported.push({ key, value });
        },
        setAttributes: (attributes: unknown) => {
          exported.push(attributes);
        },
        setStatus: (status: unknown) => {
          exported.push(status);
        },
        recordException: (exception: unknown) => {
          exported.push(exception);
        },
        end: () => {},
      }),
    } as any);
    await instrumentAgentLoop({
      runAgentLoop: async ({ send }) => {
        send({ type: "model_stream", status: "start" });
        send({ type: "model_stream", status: "end", reason: "tool_use" });
        send({ type: "tool_start", tool: "read-notes", input: {} });
        send({
          type: "tool_done",
          tool: "read-notes",
          result: message,
          isError: true,
        });
        send({ type: "model_stream", status: "start" });
        throw new EngineError(message, { errorCode: "provider_config_error" });
      },
      loopOpts,
      runId: "run-otel-privacy",
      threadId: "thread-privacy",
      userId: null,
      config: {
        ...observabilityConfig.parse({}),
        enabled: true,
        captureToolResults: true,
        inferredSentimentEnabled: false,
      },
    }).catch(() => {});
    expect(exported.length).toBeGreaterThan(0);
    expect(JSON.stringify(exported)).not.toContain("Jane Doe");
    expect(exported).toContainEqual(
      expect.objectContaining({
        "agent.error_code": "provider_config_error",
        "agent.error_cause": "provider_config_error",
      }),
    );
    expect(
      spans
        .filter((span) => span.status === "error")
        .every((span) => span.errorMessage?.includes(message)),
    ).toBe(true);
  });

  it("labels OpenTelemetry tool and model failures by what failed", async () => {
    capture();
    const statuses = new Map<string, unknown>();
    __setAgentTracerForTests({
      startSpan: (name: string) => ({
        setAttribute: () => {},
        setAttributes: () => {},
        setStatus: (status: unknown) => {
          statuses.set(name, status);
        },
        recordException: () => {},
        end: () => {},
      }),
    } as any);
    await instrumentAgentLoop({
      runAgentLoop: async ({ send }) => {
        send({ type: "tool_start", tool: "read-notes", input: {} });
        send({
          type: "tool_done",
          tool: "read-notes",
          result: message,
          isError: true,
        });
        send({ type: "model_stream", status: "start" });
        throw new EngineError("upstream request failed", {
          errorCode: "provider_config_error",
        });
      },
      loopOpts,
      runId: "run-otel-labels",
      threadId: "thread-privacy",
      userId: null,
      config: {
        ...observabilityConfig.parse({}),
        enabled: true,
        inferredSentimentEnabled: false,
      },
    }).catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(statuses.get("execute_tool read-notes")).toMatchObject({
      message: "Tool call failed",
    });
    expect(statuses.get("chat gpt-test")).toMatchObject({
      message: "Agent run failed (provider_config_error)",
    });
  });

  it.each(["throw", "event", "outcome"] as const)(
    "omits named failure messages from generations and traces for %s",
    async (path) => {
      const { events, spans } = capture();
      await instrumentAgentLoop({
        runAgentLoop: async ({ send, onOutcome }) => {
          send({ type: "model_stream", status: "start" });
          if (path === "throw")
            throw new EngineError(message, {
              errorCode: "provider_config_error",
              statusCode: 500,
            });
          if (path === "event")
            send({
              type: "error",
              error: message,
              errorCode: "provider_config_error",
            });
          else
            onOutcome?.({
              state: "failed",
              code: "provider_config_error",
              message,
              retryable: false,
            });
          return {
            inputTokens: 1,
            outputTokens: 1,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            model: "gpt-test",
          };
        },
        loopOpts,
        runId: `run-privacy-${path}`,
        threadId: "thread-privacy",
        userId: null,
        config: {
          ...observabilityConfig.parse({}),
          enabled: true,
          capturePrompts: true,
          captureToolResults: true,
          inferredSentimentEnabled: false,
        },
        metadata: { error_message: message, errorMessage: message },
      }).catch((error) => {
        if (path !== "throw") throw error;
      });
      await vi.waitFor(() =>
        expect(
          events.filter((event) => event.name === "$ai_generation"),
        ).toHaveLength(1),
      );
      expect(JSON.stringify(events)).not.toContain("Jane Doe");
      for (const name of ["$ai_generation", "$ai_trace"]) {
        const properties = events.find(
          (event) => event.name === name,
        )?.properties;
        expect(properties).not.toHaveProperty("error_message");
        expect(properties).toMatchObject({
          $ai_error: {
            terminal_code: "provider_config_error",
            cause: "provider_config_error",
          },
        });
      }
      if (path === "throw")
        expect(
          events.find((event) => event.name === "$ai_generation")?.properties
            ?.$ai_http_status,
        ).toBe(500);
      expect(
        spans.find((span) => span.spanType === "agent_run")?.errorMessage,
      ).toBe(message);
    },
  );

  it.each([false, true])(
    "omits named tool failures with captureToolResults=%s",
    async (captureToolResults) => {
      const { events, spans } = capture();
      await instrumentAgentLoop({
        runAgentLoop: async ({ send }) => {
          send({
            type: "tool_start",
            id: "read-1",
            tool: "read-notes",
            input: {},
          });
          send({
            type: "tool_done",
            id: "read-1",
            tool: "read-notes",
            isError: true,
            result: message,
          });
          return {
            inputTokens: 1,
            outputTokens: 1,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            model: "gpt-test",
          };
        },
        loopOpts: {
          ...loopOpts,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "tool-result",
                  toolCallId: "read-previous",
                  content: message,
                  isError: true,
                },
              ],
            },
          ],
        },
        runId: "run-tool-privacy",
        threadId: "thread-privacy",
        userId: null,
        config: {
          ...observabilityConfig.parse({}),
          enabled: true,
          capturePrompts: true,
          captureToolResults,
          inferredSentimentEnabled: false,
        },
      });
      await vi.waitFor(() =>
        expect(events.some((event) => event.name === "$ai_span")).toBe(true),
      );
      expect(JSON.stringify(events)).not.toContain("Jane Doe");
      expect(
        events.find((event) => event.name === "$ai_span")?.properties,
      ).toMatchObject({ $ai_error: { terminal_code: "tool_error" } });
      expect(
        spans.find((span) => span.spanType === "tool_call")?.errorMessage,
      ).toContain(message);
    },
  );

  it("sanitizes error details at the AI event boundary", async () => {
    const { events } = capture();
    emitAiTraceEvent({
      runId: "run-boundary",
      threadId: null,
      userId: null,
      spanName: "agent_run",
      model: "gpt-test",
      provider: "builder",
      durationMs: 1,
      createdAt: Date.now(),
      isError: true,
      error: { message, terminal_code: "provider_config_error" },
    });
    await vi.waitFor(() => expect(events).toHaveLength(1));
    expect(JSON.stringify(events)).not.toContain("Jane Doe");
  });

  it("omits interrupted tool error text from generation summaries", async () => {
    const { events, spans } = capture();
    await instrumentAgentLoop({
      runAgentLoop: async ({ send }) => {
        send({ type: "tool_start", tool: "read-notes", input: {} });
        return {
          inputTokens: 1,
          outputTokens: 1,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          model: "gpt-test",
        };
      },
      loopOpts,
      runId: "run-interrupted-privacy",
      threadId: "thread-privacy",
      userId: null,
      config: {
        ...observabilityConfig.parse({}),
        enabled: true,
        captureToolResults: true,
        inferredSentimentEnabled: false,
      },
    });
    await vi.waitFor(() =>
      expect(events.some((event) => event.name === "$ai_generation")).toBe(
        true,
      ),
    );
    const tools = events.find((event) => event.name === "$ai_generation")
      ?.properties?.tools as Record<string, unknown>[];
    expect(tools[0]).toMatchObject({
      status: "error",
      error_class: "interrupted",
    });
    expect(tools[0]).not.toHaveProperty("error_message");
    expect(
      spans.find((span) => span.spanType === "tool_call")?.errorMessage,
    ).toBe("Tool call interrupted before completion");
  });
});
