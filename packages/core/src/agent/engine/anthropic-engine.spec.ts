import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  createAnthropicEngine,
  ANTHROPIC_CAPABILITIES,
  ANTHROPIC_DEFAULT_MODEL,
} from "./anthropic-engine.js";
import type { EngineStreamOptions } from "./types.js";

// Helper to collect all events from an async iterable
async function collectEvents(iterable: AsyncIterable<any>) {
  const events: any[] = [];
  for await (const e of iterable) {
    events.push(e);
  }
  return events;
}

// Mock the SDK, run one stream() call, and return the request params the
// engine handed to client.messages.stream — used to assert cache_control
// placement without hitting the network.
async function captureRequestParams(opts: EngineStreamOptions): Promise<any> {
  const finalMsg = {
    content: [{ type: "text", text: "ok" }],
    stop_reason: "end_turn",
    usage: { input_tokens: 1, output_tokens: 1 },
  };
  const mockStream = {
    [Symbol.asyncIterator]: async function* () {},
    finalMessage: vi.fn().mockResolvedValue(finalMsg),
  };
  const streamSpy = vi.fn().mockReturnValue(mockStream);
  vi.doMock("@anthropic-ai/sdk", () => ({
    default: class MockAnthropic {
      messages = { stream: streamSpy };
    },
  }));
  vi.resetModules();
  const { createAnthropicEngine: freshCreate } =
    await import("./anthropic-engine.js");
  const engine = freshCreate({ apiKey: "test" });
  await collectEvents(engine.stream(opts));
  vi.doUnmock("@anthropic-ai/sdk");
  expect(streamSpy).toHaveBeenCalledTimes(1);
  return streamSpy.mock.calls[0][0];
}

describe("createAnthropicEngine", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock("@anthropic-ai/sdk");
  });

  it("creates engine with correct metadata", () => {
    const engine = createAnthropicEngine({ apiKey: "test-key" });
    expect(engine.name).toBe("anthropic");
    expect(engine.defaultModel).toBe(ANTHROPIC_DEFAULT_MODEL);
    expect(engine.capabilities).toMatchObject(ANTHROPIC_CAPABILITIES);
  });

  it("stream emits text-delta events from SDK chunks", async () => {
    // Mock the Anthropic SDK — stream() returns an object that is both
    // iterable (yields chunks) and has a finalMessage() method.
    const finalMsg = {
      content: [{ type: "text", text: "Hello, world!" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 20, output_tokens: 10 },
    };

    const chunks = [
      {
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Hello, " },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "world!" },
      },
      {
        type: "message_delta",
        delta: { stop_reason: "end_turn" },
        usage: { output_tokens: 10 },
      },
      { type: "message_stop" },
    ];

    const mockStream = {
      [Symbol.asyncIterator]: async function* () {
        for (const chunk of chunks) yield chunk;
      },
      finalMessage: vi.fn().mockResolvedValue(finalMsg),
    };

    vi.doMock("@anthropic-ai/sdk", () => ({
      default: class MockAnthropic {
        messages = { stream: vi.fn().mockReturnValue(mockStream) };
      },
    }));

    vi.resetModules();
    const { createAnthropicEngine: freshCreate } =
      await import("./anthropic-engine.js");
    const engine = freshCreate({ apiKey: "test" });

    const opts: EngineStreamOptions = {
      model: "claude-haiku-4-5-20251001",
      systemPrompt: "You are helpful.",
      messages: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
      tools: [],
      abortSignal: new AbortController().signal,
    };

    const events = await collectEvents(engine.stream(opts));
    const textDeltas = events.filter((e) => e.type === "text-delta");
    const texts = textDeltas.map((e: any) => e.text).join("");
    expect(texts).toBe("Hello, world!");

    const stopEvent = events.find((e) => e.type === "stop");
    expect(stopEvent).toBeDefined();
    expect(stopEvent?.reason).toBe("end_turn");

    vi.doUnmock("@anthropic-ai/sdk");
  });

  it("adds a moving cache breakpoint on the last user message's last content block", async () => {
    const requestParams = await captureRequestParams({
      model: "claude-haiku-4-5-20251001",
      systemPrompt: "You are helpful.",
      messages: [
        { role: "user", content: [{ type: "text", text: "First" }] },
        { role: "assistant", content: [{ type: "text", text: "Reply" }] },
        {
          role: "user",
          content: [
            { type: "text", text: "Part one" },
            { type: "text", text: "Part two" },
          ],
        },
      ],
      tools: [],
      abortSignal: new AbortController().signal,
    });

    const messages = requestParams.messages;
    // Only the LAST user message's LAST content block carries the breakpoint.
    expect(messages[0].content[0].cache_control).toBeUndefined();
    expect(messages[1].content[0].cache_control).toBeUndefined();
    expect(messages[2].content[0].cache_control).toBeUndefined();
    expect(messages[2].content[1].cache_control).toEqual({
      type: "ephemeral",
    });
    // System prompt keeps its own breakpoint.
    expect(requestParams.system[0].cache_control).toEqual({
      type: "ephemeral",
    });
  });

  it("places the message breakpoint on the last user message even when the thread ends with an assistant turn", async () => {
    const requestParams = await captureRequestParams({
      model: "claude-haiku-4-5-20251001",
      systemPrompt: "You are helpful.",
      messages: [
        { role: "user", content: [{ type: "text", text: "Hi" }] },
        { role: "assistant", content: [{ type: "text", text: "Draft" }] },
      ],
      tools: [],
      abortSignal: new AbortController().signal,
    });

    const messages = requestParams.messages;
    expect(messages[0].content[0].cache_control).toEqual({
      type: "ephemeral",
    });
    expect(messages[1].content[0].cache_control).toBeUndefined();
  });

  it("threads the model id into the max_tokens ceiling (128K-capable models)", async () => {
    const base: EngineStreamOptions = {
      model: "claude-opus-4-8",
      systemPrompt: "You are helpful.",
      messages: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
      tools: [],
      abortSignal: new AbortController().signal,
      maxOutputTokens: 128_000,
    };
    // 128K-table model keeps the full explicit value…
    const highParams = await captureRequestParams(base);
    expect(highParams.max_tokens).toBe(128_000);
    // …while a 64K-table model clamps the same request to its ceiling.
    const lowParams = await captureRequestParams({
      ...base,
      model: "claude-haiku-4-5-20251001",
    });
    expect(lowParams.max_tokens).toBe(64_000);
  });

  it("clamps an explicit large thinking budget so it leaves headroom under max_tokens", async () => {
    const requestParams = await captureRequestParams({
      model: "claude-opus-4-8",
      systemPrompt: "You are helpful.",
      messages: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
      tools: [],
      abortSignal: new AbortController().signal,
      maxOutputTokens: 32_000,
      providerOptions: {
        anthropic: {
          thinking: { type: "enabled", budgetTokens: 100_000 },
        },
      },
    });

    expect(requestParams.max_tokens).toBe(32_000);
    // Unclamped this would have been 100_000 (> max_tokens, invalid per the
    // Anthropic API contract). It must stay strictly below max_tokens and
    // leave at least max(8000, 40% of max_tokens) for the actual response.
    expect(requestParams.thinking.budget_tokens).toBeLessThan(32_000);
    expect(
      requestParams.max_tokens - requestParams.thinking.budget_tokens,
    ).toBeGreaterThanOrEqual(8000);
  });

  it("leaves a small, already-safe thinking budget unchanged", async () => {
    const requestParams = await captureRequestParams({
      model: "claude-opus-4-8",
      systemPrompt: "You are helpful.",
      messages: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
      tools: [],
      abortSignal: new AbortController().signal,
      maxOutputTokens: 32_000,
      providerOptions: {
        anthropic: {
          thinking: { type: "enabled", budgetTokens: 2_000 },
        },
      },
    });

    expect(requestParams.thinking.budget_tokens).toBe(2_000);
  });

  it("adds no cache_control anywhere when cacheControl is disabled", async () => {
    const requestParams = await captureRequestParams({
      model: "claude-haiku-4-5-20251001",
      systemPrompt: "You are helpful.",
      messages: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
      tools: [],
      abortSignal: new AbortController().signal,
      providerOptions: { anthropic: { cacheControl: false } },
    });

    expect(requestParams.system[0].cache_control).toBeUndefined();
    expect(requestParams.messages[0].content[0].cache_control).toBeUndefined();
  });

  it("tags upstream 429 rate limits with http_429 + statusCode so retries kick in", async () => {
    // The Anthropic SDK reports an empty-body rate limit as a bare
    // "429 status code (no body)" message. Without forwarding the structured
    // status, isRetryableError couldn't classify it and the run failed hard.
    class MockRateLimitError extends Error {
      status = 429;
      constructor() {
        super("429 status code (no body)");
      }
    }
    const mockStream = {
      [Symbol.asyncIterator]: async function* () {
        throw new MockRateLimitError();
      },
      finalMessage: vi.fn(),
    };
    vi.doMock("@anthropic-ai/sdk", () => ({
      default: class MockAnthropic {
        messages = { stream: vi.fn().mockReturnValue(mockStream) };
      },
    }));

    vi.resetModules();
    const { createAnthropicEngine: freshCreate } =
      await import("./anthropic-engine.js");
    const engine = freshCreate({ apiKey: "test" });
    const opts: EngineStreamOptions = {
      model: "claude-haiku-4-5-20251001",
      systemPrompt: "Test",
      messages: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
      tools: [],
      abortSignal: new AbortController().signal,
    };

    // The engine yields the terminal stop event and then rethrows the raw SDK
    // error, so collect events defensively.
    const events: any[] = [];
    await expect(async () => {
      for await (const e of engine.stream(opts)) events.push(e);
    }).rejects.toThrow();

    const stopEvent = events.find((e) => e.type === "stop");
    expect(stopEvent?.reason).toBe("error");
    expect(stopEvent?.error).toBe("429 status code (no body)");
    expect(stopEvent?.errorCode).toBe("http_429");
    expect(stopEvent?.statusCode).toBe(429);

    vi.doUnmock("@anthropic-ai/sdk");
  });

  it("tags Anthropic APIConnectionError as provider_network_error", async () => {
    class MockConnectionError extends Error {
      constructor() {
        super("Connection error.");
        this.name = "APIConnectionError";
      }
    }
    const mockStream = {
      [Symbol.asyncIterator]: async function* () {
        throw new MockConnectionError();
      },
      finalMessage: vi.fn(),
    };
    vi.doMock("@anthropic-ai/sdk", () => ({
      default: class MockAnthropic {
        messages = { stream: vi.fn().mockReturnValue(mockStream) };
      },
    }));

    vi.resetModules();
    const { createAnthropicEngine: freshCreate } =
      await import("./anthropic-engine.js");
    const engine = freshCreate({ apiKey: "test" });
    const opts: EngineStreamOptions = {
      model: "claude-haiku-4-5-20251001",
      systemPrompt: "Test",
      messages: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
      tools: [],
      abortSignal: new AbortController().signal,
    };

    const events: any[] = [];
    await expect(async () => {
      for await (const e of engine.stream(opts)) events.push(e);
    }).rejects.toThrow("Connection error.");

    const stopEvent = events.find((e) => e.type === "stop");
    expect(stopEvent?.reason).toBe("error");
    expect(stopEvent?.error).toBe("Connection error.");
    expect(stopEvent?.errorCode).toBe("provider_network_error");
    expect(stopEvent?.providerRetryable).toBe(true);

    vi.doUnmock("@anthropic-ai/sdk");
  });

  it("stream emits stop with error when API key is missing", async () => {
    const engine = createAnthropicEngine({});
    const opts: EngineStreamOptions = {
      model: "claude-haiku-4-5-20251001",
      systemPrompt: "Test",
      messages: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
      tools: [],
      abortSignal: new AbortController().signal,
    };

    const events = await collectEvents(engine.stream(opts));
    const stopEvent = events.find((e) => e.type === "stop");
    expect(stopEvent?.reason).toBe("error");
    expect(stopEvent?.error).toContain("Agent settings > LLM");
    expect(stopEvent?.error).not.toContain("ANTHROPIC_API_KEY");
    expect(stopEvent?.errorCode).toBe("missing_credentials");
  });

  it("does not use deploy-level Anthropic keys when env fallback is disabled", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-deploy");
    const engine = createAnthropicEngine({ allowEnvFallback: false });
    const opts: EngineStreamOptions = {
      model: "claude-haiku-4-5-20251001",
      systemPrompt: "Test",
      messages: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
      tools: [],
      abortSignal: new AbortController().signal,
    };

    const events = await collectEvents(engine.stream(opts));
    const stopEvent = events.find((e) => e.type === "stop");
    expect(stopEvent?.reason).toBe("error");
    expect(stopEvent?.errorCode).toBe("missing_credentials");
  });
});
