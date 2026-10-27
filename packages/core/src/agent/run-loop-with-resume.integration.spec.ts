import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import type {
  AgentEngine,
  EngineEvent,
  EngineMessage,
} from "./engine/types.js";
import { AGENT_INTERNAL_CONTINUE_PROMPT } from "./production-agent.js";
import { runAgentLoopDirectWithSoftTimeout } from "./run-loop-with-resume.js";

function fakeEngineWithGatewayTimeoutThenSuccess(): {
  engine: AgentEngine;
  callsRef: { value: number };
} {
  const callsRef = { value: 0 };
  const engine: AgentEngine = {
    name: "fake-builder",
    label: "Fake Builder Gateway",
    defaultModel: "test-model",
    supportedModels: ["test-model"],
    capabilities: {
      thinking: false,
      promptCaching: true,
      vision: false,
      computerUse: false,
      parallelToolCalls: false,
    },
    async *stream(): AsyncIterable<EngineEvent> {
      callsRef.value += 1;
      if (callsRef.value === 1) {
        yield {
          type: "text-delta",
          text: "Sure, I can help create that design—",
        };
        yield {
          type: "stop",
          reason: "error",
          error: "Builder gateway timed out after 45s",
          errorCode: "builder_gateway_timeout",
        };
        return;
      }
      yield {
        type: "text-delta",
        text: "Here is your design (resumed cleanly).",
      };
      yield {
        type: "assistant-content",
        parts: [
          {
            type: "text",
            text: "Here is your design (resumed cleanly).",
          },
        ],
      };
      yield {
        type: "usage",
        inputTokens: 1200,
        outputTokens: 80,
        cacheReadTokens: 1100,
        cacheWriteTokens: 0,
      };
      yield { type: "stop", reason: "end_turn" };
    },
  };
  return { engine, callsRef };
}

describe("end-to-end: gateway timeout → resume", () => {
  beforeEach(() => {
    vi.stubEnv("AGENT_RUN_SOFT_TIMEOUT_MS", "60000");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("recovers a chat that hits a Builder gateway timeout mid-stream", async () => {
    const { engine, callsRef } = fakeEngineWithGatewayTimeoutThenSuccess();

    const messages: EngineMessage[] = [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Create a SaaS landing page design.",
          },
        ],
      },
    ];

    const sentEvents: EngineEvent[] = [];
    const usage = await runAgentLoopDirectWithSoftTimeout(
      {
        engine,
        model: "test-model",
        systemPrompt: "You are a design agent.",
        tools: [],
        messages,
        actions: {},
        send: (event) => {
          sentEvents.push(event);
        },
        signal: new AbortController().signal,
      },
      60_000,
    );

    expect(callsRef.value).toBe(2);

    const continuationMessages = messages.filter(
      (m) =>
        m.role === "user" &&
        m.content.some(
          (c) =>
            c.type === "text" &&
            c.text.startsWith(AGENT_INTERNAL_CONTINUE_PROMPT) &&
            c.text.includes("upstream gateway timeout"),
        ),
    );
    expect(continuationMessages).toHaveLength(1);

    expect(usage.inputTokens).toBe(1200);
    expect(usage.outputTokens).toBe(80);
    expect(usage.cacheReadTokens).toBe(1100);
    expect(usage.model).toBe("test-model");

    const finalText = sentEvents
      .filter((e) => e.type === "text")
      .map((e) => (e as { type: "text"; text: string }).text)
      .join("");
    expect(finalText).toContain("Here is your design (resumed cleanly).");
  });

  it("recovers a chat where the engine's transport interruption is not engine-level retryable", async () => {
    let calls = 0;
    const engine: AgentEngine = {
      name: "fake-anthropic",
      label: "Fake Anthropic Direct",
      defaultModel: "test-model",
      supportedModels: ["test-model"],
      capabilities: {
        thinking: false,
        promptCaching: true,
        vision: false,
        computerUse: false,
        parallelToolCalls: false,
      },
      async *stream(): AsyncIterable<EngineEvent> {
        calls += 1;
        if (calls === 1) {
          throw new Error("stream closed unexpectedly");
        }
        yield { type: "text-delta", text: "Recovered." };
        yield {
          type: "assistant-content",
          parts: [{ type: "text", text: "Recovered." }],
        };
        yield {
          type: "usage",
          inputTokens: 100,
          outputTokens: 5,
          cacheReadTokens: 90,
          cacheWriteTokens: 0,
        };
        yield { type: "stop", reason: "end_turn" };
      },
    };

    const messages: EngineMessage[] = [
      { role: "user", content: [{ type: "text", text: "go" }] },
    ];

    const usage = await runAgentLoopDirectWithSoftTimeout(
      {
        engine,
        model: "test-model",
        systemPrompt: "You are an agent.",
        tools: [],
        messages,
        actions: {},
        send: () => {},
        signal: new AbortController().signal,
      },
      60_000,
    );

    expect(calls).toBe(2);
    expect(usage.inputTokens).toBe(100);

    const networkContinuation = messages.find(
      (m) =>
        m.role === "user" &&
        m.content.some(
          (c) =>
            c.type === "text" &&
            c.text.startsWith(AGENT_INTERNAL_CONTINUE_PROMPT) &&
            c.text.includes("transport-level interruption"),
        ),
    );
    expect(networkContinuation).toBeDefined();
  });
});
