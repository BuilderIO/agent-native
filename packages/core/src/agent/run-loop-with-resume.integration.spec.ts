/**
 * End-to-end integration test for the resume-on-error pipeline.
 *
 * Unlike `run-loop-with-resume.spec.ts`, this file does NOT mock
 * `runAgentLoop` — it uses the real one with a fake AgentEngine that
 * simulates the exact failure mode Sajal hit in the design app:
 *
 *   1. First LLM call streams a partial assistant turn, then errors with
 *      `builder_gateway_timeout` (the same error code the real Builder gateway
 *      emits when it times out at 45s).
 *   2. `runAgentLoop`'s engine-level retry sees `builder_gateway_timeout` is
 *      excluded from `isRetryableError`, so it rethrows immediately instead of
 *      burning the per-call retry budget.
 *   3. `runAgentLoopDirectWithSoftTimeout` catches the rethrown error,
 *      recognizes it via `isResumableEngineError`, appends a continuation
 *      message describing the cut-off, and runs another LLM call.
 *   4. The second call (where Anthropic prompt caching would rescue the
 *      latency in production) succeeds and returns a final answer.
 *
 * Failing this test means the resume pipeline is broken end-to-end and
 * Sajal's bug ("AI never creates a design") would still happen.
 */

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
        // Stream a partial response, THEN emit the gateway timeout — this
        // mirrors the real failure shape: the gateway started returning
        // tokens, then severed the connection at 45s before the LLM was
        // done.
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
      // Second call (the resume): mirrors a healthy Anthropic response after
      // the prompt-cache rescue. Emit a complete final answer + end_turn.
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
        // High cache-read on the resume call — the whole point of the resume
        // path: prefix is cached, so the second call is dramatically faster.
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

    // Engine was invoked twice — once for the timeout, once for the resume.
    expect(callsRef.value).toBe(2);

    // Resume path appended a continuation note describing the cut-off
    // BETWEEN the two LLM calls. This is what makes the resume coherent: the
    // agent sees "you got cut off, continue" rather than starting fresh.
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

    // Successful resume call's usage is what's surfaced to the caller — the
    // failed first call should not have produced usage tokens (it errored).
    expect(usage.inputTokens).toBe(1200);
    expect(usage.outputTokens).toBe(80);
    expect(usage.cacheReadTokens).toBe(1100);
    expect(usage.model).toBe("test-model");

    // The final user-visible text from the resumed call should appear in the
    // outbound event stream — confirming events from the post-resume call
    // actually flowed through to `send` and would reach the client UI.
    const finalText = sentEvents
      .filter((e) => e.type === "text")
      .map((e) => (e as { type: "text"; text: string }).text)
      .join("");
    expect(finalText).toContain("Here is your design (resumed cleanly).");
  });

  it("recovers a chat where the engine's transport interruption is not engine-level retryable", async () => {
    // "stream closed unexpectedly" is recognized by isResumableEngineError
    // (the wrapper level) but NOT by isRetryableError (the engine level).
    // This is the right case to exercise the wrapper's resume path without
    // burning ~14s of engine-level retry backoff inside the test runner.
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

    // Continuation should be tagged as a network interruption, not a gateway
    // timeout — the message-based fallback distinguishes the two.
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
