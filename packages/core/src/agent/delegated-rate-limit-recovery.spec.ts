import { afterEach, describe, expect, it, vi } from "vitest";

import { PROVIDER_RATE_LIMITED_ERROR_CODE } from "./engine/error-detail.js";
import type { AgentEngine, EngineEvent } from "./engine/types.js";
import { PROVIDER_RATE_LIMITED_TERMINAL_MESSAGE } from "./production-agent.js";
import { runAgentLoopDirectWithSoftTimeout } from "./run-loop-with-resume.js";
import type { AgentChatEvent } from "./types.js";

describe("delegated provider backpressure recovery", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("continues once after four inner 429 attempts exhaust, then completes", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);

    let streamCalls = 0;
    const engine: AgentEngine = {
      name: "test",
      label: "Test",
      defaultModel: "test-model",
      supportedModels: ["test-model"],
      capabilities: {
        thinking: false,
        promptCaching: false,
        vision: false,
        computerUse: false,
        parallelToolCalls: false,
      },
      async *stream(): AsyncIterable<EngineEvent> {
        streamCalls++;
        if (streamCalls <= 4) {
          yield {
            type: "stop",
            reason: "error",
            error: "429 status code (no body)",
            errorCode: "http_429",
            statusCode: 429,
          };
          return;
        }
        yield {
          type: "assistant-content",
          parts: [{ type: "text", text: "finished" }],
        };
        yield { type: "stop", reason: "end_turn" };
      },
    };
    const events: AgentChatEvent[] = [];

    const run = runAgentLoopDirectWithSoftTimeout(
      {
        engine,
        model: "test-model",
        systemPrompt: "system",
        tools: [],
        messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
        actions: {},
        send: (event) => events.push(event),
        signal: new AbortController().signal,
      },
      120_000,
      { backgroundFunction: true },
    );

    // Three in-loop backoffs (2s + 4s + 8s), then the one 20s outer cooldown.
    await vi.advanceTimersByTimeAsync(34_000);
    await run;

    expect(streamCalls).toBe(5);
    expect(events).toContainEqual({ type: "text", text: "finished" });
    expect(
      events.some(
        (event) => event.type === "error" || event.type === "loop_limit",
      ),
    ).toBe(false);
  });

  it("also recovers on the delegated FOREGROUND lane (no backgroundFunction) with ample budget", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);

    let streamCalls = 0;
    const engine: AgentEngine = {
      name: "test",
      label: "Test",
      defaultModel: "test-model",
      supportedModels: ["test-model"],
      capabilities: {
        thinking: false,
        promptCaching: false,
        vision: false,
        computerUse: false,
        parallelToolCalls: false,
      },
      async *stream(): AsyncIterable<EngineEvent> {
        streamCalls++;
        if (streamCalls <= 4) {
          yield {
            type: "stop",
            reason: "error",
            error: "429 status code (no body)",
            errorCode: "http_429",
            statusCode: 429,
          };
          return;
        }
        yield {
          type: "assistant-content",
          parts: [{ type: "text", text: "finished" }],
        };
        yield { type: "stop", reason: "end_turn" };
      },
    };
    const events: AgentChatEvent[] = [];

    // No `timeoutOptions` — this is the delegated FOREGROUND lane, which used
    // to never get the cooled-down retry at all.
    const run = runAgentLoopDirectWithSoftTimeout(
      {
        engine,
        model: "test-model",
        systemPrompt: "system",
        tools: [],
        messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
        actions: {},
        send: (event) => events.push(event),
        signal: new AbortController().signal,
      },
      120_000,
    );

    await vi.advanceTimersByTimeAsync(34_000);
    await run;

    expect(streamCalls).toBe(5);
    expect(events).toContainEqual({ type: "text", text: "finished" });
  });

  it("ends with the provider_rate_limited terminal shape once the one cooldown is also exhausted", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);

    let streamCalls = 0;
    const engine: AgentEngine = {
      name: "test",
      label: "Test",
      defaultModel: "test-model",
      supportedModels: ["test-model"],
      capabilities: {
        thinking: false,
        promptCaching: false,
        vision: false,
        computerUse: false,
        parallelToolCalls: false,
      },
      // Every attempt is rate limited — including the one post-cooldown
      // attempt, so the run never recovers.
      async *stream(): AsyncIterable<EngineEvent> {
        streamCalls++;
        yield {
          type: "stop",
          reason: "error",
          error: "429 status code (no body)",
          errorCode: "http_429",
          statusCode: 429,
        };
      },
    };
    const events: AgentChatEvent[] = [];

    const run = runAgentLoopDirectWithSoftTimeout(
      {
        engine,
        model: "test-model",
        systemPrompt: "system",
        tools: [],
        messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
        actions: {},
        send: (event) => events.push(event),
        signal: new AbortController().signal,
      },
      120_000,
      { backgroundFunction: true },
    );

    const rejected = expect(run).rejects.toMatchObject({
      message: PROVIDER_RATE_LIMITED_TERMINAL_MESSAGE,
      errorCode: PROVIDER_RATE_LIMITED_ERROR_CODE,
    });
    // The first round exhausts its own inner 429 retries (~14s), then the one
    // 20s outer cooldown, then a second round that ALSO exhausts its inner
    // retries (~14s) before giving up for good.
    await vi.advanceTimersByTimeAsync(60_000);
    await rejected;

    // The loop does not emit its own terminal `error` event: run-manager
    // builds it from the thrown code, and it must not carry `recoverable`, or
    // thread-data-builder would drop the one error the user needs to see.
    expect(events.some((event) => event.type === "error")).toBe(false);
  });
});
