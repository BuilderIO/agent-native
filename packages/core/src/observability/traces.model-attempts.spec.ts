import { afterEach, expect, it, vi } from "vitest";

import {
  EngineError,
  startModelDispatch,
  type AgentEngine,
  type EngineEvent,
} from "../agent/engine/types.js";
import type { ModelAttemptMetrics } from "../agent/model-attempt.js";
import { runAgentLoop } from "../agent/production-agent.js";
import { observabilityConfig } from "../app-config/observability.js";
import * as store from "./store.js";
import { instrumentAgentLoop } from "./traces.js";
import type { TraceSpan } from "./types.js";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it.each(["retry", "early settings failure"])(
  "preserves model-attempt measurements through %s without capturing content",
  async (mode) => {
    vi.useFakeTimers({ now: 1_000_000 });
    const spans: TraceSpan[] = [];
    vi.spyOn(store, "insertTraceSpan").mockImplementation(async (span) => {
      spans.push(span);
    });
    vi.spyOn(store, "upsertTraceSummary").mockResolvedValue(undefined);
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    let calls = 0;
    const engine: AgentEngine = {
      name: "test",
      label: "Test",
      defaultModel: "test",
      supportedModels: ["test"],
      capabilities: {
        thinking: true,
        promptCaching: false,
        vision: true,
        computerUse: false,
        parallelToolCalls: false,
      },
      async *stream(options): AsyncIterable<EngineEvent> {
        calls++;
        await sleep(20);
        await startModelDispatch(options, () => undefined);
        await sleep(10);
        yield { type: "gateway-heartbeat" };
        if (calls === 1) {
          await sleep(2_000);
          throw new EngineError("Synthetic timeout", {
            errorCode: "provider_network_error",
            providerRetryable: true,
          });
        }
        await sleep(100);
        yield { type: "thinking-delta", text: "private reasoning" };
        await sleep(200);
        yield { type: "text-delta", text: "café" };
        await sleep(30);
        yield { type: "text-delta", text: "!" };
        await sleep(50);
        yield { type: "usage", inputTokens: 23, outputTokens: 7 };
        yield { type: "stop", reason: "end_turn" };
      },
    };
    const run = instrumentAgentLoop({
      runAgentLoop: (options) =>
        runAgentLoop({
          ...options,
          onModelSettings: () => {
            if (mode === "early settings failure" && calls === 1) {
              throw new Error("Synthetic settings failure");
            }
          },
        }),
      loopOpts: {
        engine,
        model: "test",
        systemPrompt: "private café",
        tools: [
          { name: "read", description: "private schema", inputSchema: {} },
        ],
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "private document" }],
          },
          {
            role: "assistant",
            content: [
              { type: "tool-call", id: "doc", name: "get-document", input: {} },
              { type: "tool-call", id: "skill", name: "resources", input: {} },
            ],
          },
          {
            role: "user",
            content: [
              {
                type: "tool-result",
                toolCallId: "doc",
                toolName: "get-document",
                toolInput: "{}",
                content: "café",
              },
              {
                type: "tool-result",
                toolCallId: "skill",
                toolName: "resources",
                toolInput: "{}",
                content: "rules",
              },
            ],
          },
        ],
        onModelAttempt: async () => {
          throw new Error("Synthetic observer failure");
        },
        actions: {},
        signal: new AbortController().signal,
        send: () => {},
      },
      runId: "run-attempt-measurement",
      threadId: null,
      userId: null,
      config: {
        ...observabilityConfig.parse({}),
        enabled: true,
        capturePrompts: false,
        inferredSentimentEnabled: false,
        inferredSentimentSampleRate: 0,
      },
    });
    const settled = run.then(
      () => null,
      (error: unknown) => error,
    );
    await vi.waitFor(() => expect(calls).toBeGreaterThan(0));
    await vi.advanceTimersByTimeAsync(20_000);
    const error = await settled;
    await vi.advanceTimersByTimeAsync(0);
    const models = spans.filter((s) => s.spanType === "llm_call");
    if (mode === "early settings failure") {
      expect(error).toMatchObject({ message: "Synthetic settings failure" });
      expect(calls).toBe(1);
      expect(models).toHaveLength(1);
      const earlier = models[0]?.metadata?.modelAttempt as
        | ModelAttemptMetrics
        | undefined;
      if (!earlier || earlier.dispatchedAtMs === undefined) {
        throw new Error("Missing original attempt dispatch");
      }
      expect(earlier.retry).toBe(0);
      expect(earlier.firstEventAtMs).toBeUndefined();
      expect(earlier.usageReported).toBe(false);
      expect(earlier.endedAtMs - earlier.dispatchedAtMs).toBe(2_010);
      return;
    }
    expect(error).toBeNull();
    expect(models).toHaveLength(2);
    const first = models[0]?.metadata?.modelAttempt as
      | ModelAttemptMetrics
      | undefined;
    const second = models[1]?.metadata?.modelAttempt as
      | ModelAttemptMetrics
      | undefined;
    if (!first || !second)
      throw new Error("Missing model-attempt measurements");
    const required = (value: number | undefined): number => {
      if (value === undefined) throw new Error("Missing observed timestamp");
      return value;
    };
    expect(first).toMatchObject({
      retry: 0,
      streamedThinkingBytes: 0,
      streamedTextBytes: 0,
    });
    expect(first.firstEventAtMs).toBeUndefined();
    expect(first.endedAtMs - required(first.dispatchedAtMs)).toBe(2_010);
    expect(first.retryWaitMs).toBeGreaterThan(0);
    expect(second.startedAtMs).toBe(first.endedAtMs + first.retryWaitMs);
    expect(required(second.dispatchedAtMs) - second.startedAtMs).toBe(20);
    expect(
      required(second.firstEventAtMs) - required(second.dispatchedAtMs),
    ).toBe(110);
    expect(second.firstThinkingAtMs).toBe(second.firstEventAtMs);
    expect(
      required(second.firstTextAtMs) - required(second.dispatchedAtMs),
    ).toBe(310);
    expect(required(second.lastTextAtMs) - required(second.firstTextAtMs)).toBe(
      30,
    );
    expect(second.endedAtMs - required(second.dispatchedAtMs)).toBe(390);
    expect(second.streamedTextBytes).toBe(6);
    expect(second).toMatchObject({
      request: {
        systemPromptBytes: 13,
        toolCount: 1,
        messageCount: 3,
        toolResultBytes: { "get-document": 5, resources: 5 },
      },
    });
    expect(first.usageReported).toBe(false);
    expect(second.usageReported).toBe(true);
    expect(calls).toBe(2);
    expect(models[1]).toMatchObject({ inputTokens: 23, outputTokens: 7 });
    expect(JSON.stringify(models.map((s) => s.metadata))).not.toMatch(
      /private|café/,
    );
  },
);
