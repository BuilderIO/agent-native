import { afterEach, describe, expect, it, vi } from "vitest";

import type { AgentEngine, EngineEvent } from "./engine/types.js";
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
});
