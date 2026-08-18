import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  createAnthropicEngine,
  ANTHROPIC_CAPABILITIES,
  ANTHROPIC_DEFAULT_MODEL,
} from "./anthropic-engine.js";
import { SYSTEM_PROMPT_CACHE_SPLIT } from "./prompt-cache.js";
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
    // The 1h stable-prefix TTL is opt-in (`stablePrefixCacheControl`), so the
    // breakpoint assertions below have to ask for it explicitly — without this
    // they assert the opted-in shape against the default one.
    vi.stubEnv("AGENT_PROMPT_CACHE_TTL", "1h");
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
    // System prompt keeps its own breakpoint, on the long TTL.
    expect(requestParams.system[0].cache_control).toEqual({
      type: "ephemeral",
      ttl: "1h",
    });
  });

  it("caches the stable prefix for 1h and leaves the moving breakpoint at the default TTL", async () => {
    const requestParams = await captureRequestParams({
      model: "claude-haiku-4-5-20251001",
      systemPrompt: "You are helpful.",
      messages: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
      tools: [
        {
          name: "a",
          description: "a",
          inputSchema: { type: "object", properties: {} },
        },
        {
          name: "b",
          description: "b",
          inputSchema: { type: "object", properties: {} },
        },
      ],
      abortSignal: new AbortController().signal,
    });

    expect(requestParams.system[0].cache_control).toEqual({
      type: "ephemeral",
      ttl: "1h",
    });
    expect(requestParams.tools[0].cache_control).toBeUndefined();
    expect(requestParams.tools[1].cache_control).toEqual({
      type: "ephemeral",
      ttl: "1h",
    });
    // The per-iteration breakpoint must NOT pay the 2x long-TTL write premium.
    expect(requestParams.messages[0].content[0].cache_control).toEqual({
      type: "ephemeral",
    });
  });

  it("splits the system prompt at the cache sentinel so only the stable prefix carries the breakpoint", async () => {
    const requestParams = await captureRequestParams({
      model: "claude-haiku-4-5-20251001",
      systemPrompt: `stable${SYSTEM_PROMPT_CACHE_SPLIT}volatile`,
      messages: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
      tools: [],
      abortSignal: new AbortController().signal,
    });

    expect(requestParams.system).toEqual([
      {
        type: "text",
        text: "stable",
        cache_control: { type: "ephemeral", ttl: "1h" },
      },
      { type: "text", text: "volatile" },
    ]);
    // The sentinel itself never reaches the model.
    expect(
      requestParams.system
        .map((b: any) => b.text)
        .join("")
        .includes(SYSTEM_PROMPT_CACHE_SPLIT),
    ).toBe(false);
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

  it.each([429, 529])(
    "tags upstream %i backpressure with a structured status so retries kick in",
    async (status) => {
      // The Anthropic SDK reports an empty-body rate limit as a bare
      // "429 status code (no body)" message. Without forwarding the structured
      // status, isRetryableError couldn't classify it and the run failed hard.
      class MockRateLimitError extends Error {
        status = status;
        constructor() {
          super(`${status} status code (no body)`);
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
      expect(stopEvent?.error).toBe(`${status} status code (no body)`);
      expect(stopEvent?.errorCode).toBe(`http_${status}`);
      expect(stopEvent?.statusCode).toBe(status);

      vi.doUnmock("@anthropic-ai/sdk");
    },
  );

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

  it("records the cause chain behind a bare 'Connection error.' without changing its classification", async () => {
    class MockConnectionError extends Error {
      constructor(cause: unknown) {
        super("Connection error.", { cause });
        this.name = "APIConnectionError";
      }
    }
    const socket = Object.assign(new Error("other side closed"), {
      code: "UND_ERR_SOCKET",
    });
    const mockStream = {
      [Symbol.asyncIterator]: async function* () {
        throw new MockConnectionError(
          new Error("fetch failed", { cause: socket }),
        );
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
    expect(stopEvent?.error).toBe(
      "Connection error. (cause: fetch failed <- UND_ERR_SOCKET other side closed)",
    );
    expect(stopEvent?.errorCode).toBe("provider_network_error");
    expect(stopEvent?.providerRetryable).toBe(true);

    vi.doUnmock("@anthropic-ai/sdk");
  });

  it("caps the SDK's own retry layer so it does not multiply the loop's retries", async () => {
    const constructorArgs: any[] = [];
    const mockStream = {
      [Symbol.asyncIterator]: async function* () {},
      finalMessage: vi.fn().mockResolvedValue({
        content: [{ type: "text", text: "ok" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    };
    vi.doMock("@anthropic-ai/sdk", () => ({
      default: class MockAnthropic {
        messages = { stream: vi.fn().mockReturnValue(mockStream) };
        constructor(args: any) {
          constructorArgs.push(args);
        }
      },
    }));

    vi.resetModules();
    const { createAnthropicEngine: freshCreate } =
      await import("./anthropic-engine.js");
    const engine = freshCreate({ apiKey: "test" });
    await collectEvents(
      engine.stream({
        model: "claude-haiku-4-5-20251001",
        systemPrompt: "Test",
        messages: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
        tools: [],
        abortSignal: new AbortController().signal,
      }),
    );

    expect(constructorArgs[0]?.maxRetries).toBe(1);

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
    expect(stopEvent?.error).toContain("Manage agent > LLM");
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

  it("defaults to adaptive thinking at high effort for an effort-capable model", async () => {
    const requestParams = await captureRequestParams({
      model: "claude-sonnet-5",
      systemPrompt: "You are helpful.",
      messages: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
      tools: [],
      abortSignal: new AbortController().signal,
    });

    expect(requestParams.thinking).toEqual({ type: "adaptive" });
    expect(requestParams.output_config).toEqual({ effort: "high" });
  });

  it("uses manual thinking for Claude Haiku 4.5 instead of adaptive thinking", async () => {
    const requestParams = await captureRequestParams({
      model: "claude-haiku-4-5-20251001",
      systemPrompt: "You are helpful.",
      messages: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
      tools: [],
      abortSignal: new AbortController().signal,
      maxOutputTokens: 32_000,
    });

    expect(requestParams.thinking).toEqual({
      type: "enabled",
      budget_tokens: 8_000,
    });
    expect(requestParams.output_config).toBeUndefined();
  });

  it("does not enable thinking by default for a non-reasoning model", async () => {
    const requestParams = await captureRequestParams({
      model: "claude-3-5-haiku-20241022",
      systemPrompt: "You are helpful.",
      messages: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
      tools: [],
      abortSignal: new AbortController().signal,
    });

    expect(requestParams.thinking).toBeUndefined();
  });

  it("keeps explicit high effort behavior (adaptive thinking + output_config)", async () => {
    const requestParams = await captureRequestParams({
      model: "claude-sonnet-5",
      systemPrompt: "You are helpful.",
      messages: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
      tools: [],
      abortSignal: new AbortController().signal,
      reasoningEffort: "high",
    });

    expect(requestParams.thinking).toEqual({ type: "adaptive" });
    expect(requestParams.output_config).toEqual({ effort: "high" });
  });

  it("does not default to thinking when effort is explicitly none", async () => {
    const requestParams = await captureRequestParams({
      model: "claude-sonnet-5",
      systemPrompt: "You are helpful.",
      messages: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
      tools: [],
      abortSignal: new AbortController().signal,
      reasoningEffort: "none",
    });

    expect(requestParams.thinking).toBeUndefined();
    expect(requestParams.output_config).toBeUndefined();
  });

  it("respects an explicit providerOptions.anthropic.thinking config instead of defaulting", async () => {
    const requestParams = await captureRequestParams({
      model: "claude-sonnet-5",
      systemPrompt: "You are helpful.",
      messages: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
      tools: [],
      abortSignal: new AbortController().signal,
      maxOutputTokens: 32_000,
      providerOptions: {
        anthropic: {
          thinking: { type: "enabled", budgetTokens: 4_000 },
        },
      },
    });

    expect(requestParams.thinking).toEqual({
      type: "enabled",
      budget_tokens: 4_000,
    });
    expect(requestParams.output_config).toBeUndefined();
  });
});

describe("createAnthropicEngine first-event deadline", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock("@anthropic-ai/sdk");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("aborts with a retryable network error when the stream produces no chunks within 120s", async () => {
    let capturedSignal: AbortSignal | undefined;
    const mockStream = {
      [Symbol.asyncIterator]: async function* () {
        await new Promise((_resolve, reject) => {
          if (capturedSignal?.aborted) {
            reject(capturedSignal.reason ?? new Error("aborted"));
            return;
          }
          capturedSignal?.addEventListener(
            "abort",
            () => reject(capturedSignal!.reason ?? new Error("aborted")),
            { once: true },
          );
        });
      },
      finalMessage: vi.fn(),
    };
    const streamSpy = vi.fn((_params: any, opts: any) => {
      capturedSignal = opts?.signal;
      return mockStream;
    });
    vi.doMock("@anthropic-ai/sdk", () => ({
      default: class MockAnthropic {
        messages = { stream: streamSpy };
      },
    }));

    vi.resetModules();
    const { createAnthropicEngine: freshCreate } =
      await import("./anthropic-engine.js");
    const engine = freshCreate({ apiKey: "test" });
    vi.useFakeTimers();

    const opts: EngineStreamOptions = {
      model: "claude-haiku-4-5-20251001",
      systemPrompt: "You are helpful.",
      messages: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
      tools: [],
      abortSignal: new AbortController().signal,
    };

    // The engine yields the terminal stop event and then rethrows, so
    // collect events defensively (matches the pattern above).
    const events: any[] = [];
    let settledEarly = false;
    const runPromise = (async () => {
      for await (const e of engine.stream(opts)) events.push(e);
    })();
    void runPromise
      .catch(() => {})
      .then(() => {
        settledEarly = true;
      });

    await vi.advanceTimersByTimeAsync(119_000);
    expect(settledEarly).toBe(false);

    await vi.advanceTimersByTimeAsync(1_000);
    await expect(runPromise).rejects.toThrow();

    const stop = events.find((e) => e.type === "stop");
    expect(stop?.reason).toBe("error");
    expect(stop?.errorCode).toBe("provider_network_error");
    expect(stop?.providerRetryable).toBe(true);
    expect(stop?.error).toContain("120s");

    vi.doUnmock("@anthropic-ai/sdk");
  });

  it("does not abort once the stream has produced a chunk", async () => {
    const finalMsg = {
      content: [{ type: "text", text: "Hello" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 5, output_tokens: 2 },
    };
    const mockStream = {
      [Symbol.asyncIterator]: async function* () {
        yield {
          type: "content_block_start",
          index: 0,
          content_block: { type: "text", text: "" },
        };
        yield {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "Hello" },
        };
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

    const events = await collectEvents(
      engine.stream({
        model: "claude-haiku-4-5-20251001",
        systemPrompt: "You are helpful.",
        messages: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
        tools: [],
        abortSignal: new AbortController().signal,
      }),
    );

    const stop = events.find((e) => e.type === "stop");
    expect(stop?.reason).toBe("end_turn");
    expect(stop?.errorCode).toBeUndefined();
    expect(mockStream.finalMessage).toHaveBeenCalledTimes(1);

    vi.doUnmock("@anthropic-ai/sdk");
  });
});

describe("createAnthropicEngine streamed tool-input reconciliation", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock("@anthropic-ai/sdk");
  });

  afterEach(() => {
    vi.doUnmock("@anthropic-ai/sdk");
  });

  async function runToolInputStream(
    argsDeltas: string[],
    finalContent: unknown[],
  ) {
    const mockStream = {
      [Symbol.asyncIterator]: async function* () {
        yield {
          type: "content_block_start",
          index: 0,
          content_block: {
            type: "tool_use",
            id: "toolu_01",
            name: "create_document",
          },
        };
        for (const partial_json of argsDeltas) {
          yield {
            type: "content_block_delta",
            index: 0,
            delta: { type: "input_json_delta", partial_json },
          };
        }
        yield { type: "message_stop" };
      },
      finalMessage: vi.fn().mockResolvedValue({
        content: finalContent,
        stop_reason: "tool_use",
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    };
    vi.doMock("@anthropic-ai/sdk", () => ({
      default: class MockAnthropic {
        messages = { stream: vi.fn().mockReturnValue(mockStream) };
      },
    }));
    vi.resetModules();
    const { createAnthropicEngine: freshCreate } =
      await import("./anthropic-engine.js");
    return collectEvents(
      freshCreate({ apiKey: "test" }).stream({
        model: "claude-haiku-4-5-20251001",
        systemPrompt: "You are helpful.",
        messages: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
        tools: [],
        abortSignal: new AbortController().signal,
      }),
    );
  }

  it("assembles a tool call from multiple argument deltas when the final message omits it", async () => {
    const events = await runToolInputStream(
      ['{"title":"Q', '3 plan"', "}"],
      [],
    );

    expect(events.find((e) => e.type === "tool-call")).toEqual({
      type: "tool-call",
      id: "toolu_01",
      name: "create_document",
      input: { title: "Q3 plan" },
    });
    expect(
      events.find((e) => e.type === "assistant-content")?.parts,
    ).toContainEqual({
      type: "tool-call",
      id: "toolu_01",
      name: "create_document",
      input: { title: "Q3 plan" },
    });
  });

  it("reports a tool call truncated mid-arguments as an in-band tool-call error", async () => {
    const events = await runToolInputStream(['{"title":"Q'], []);

    expect(events.find((e) => e.type === "tool-call-error")).toMatchObject({
      id: "toolu_01",
      name: "create_document",
      input: '{"title":"Q',
    });
    expect(events.some((e) => e.type === "tool-call")).toBe(false);
  });

  it("leaves a tool call the final message already carries alone", async () => {
    const events = await runToolInputStream(
      ['{"title":"Q3 plan"}'],
      [
        {
          type: "tool_use",
          id: "toolu_01",
          name: "create_document",
          input: { title: "Q3 plan" },
        },
      ],
    );

    expect(events.some((e) => e.type === "tool-call")).toBe(false);
    expect(events.some((e) => e.type === "tool-call-error")).toBe(false);
    expect(events.find((e) => e.type === "assistant-content")?.parts).toEqual([
      {
        type: "tool-call",
        id: "toolu_01",
        name: "create_document",
        input: { title: "Q3 plan" },
      },
    ]);
  });

  it("recovers complete streamed arguments when the final message carries an empty input", async () => {
    const input = {
      id: "ext-1",
      operation: "edit",
      payloadJson: "{}",
    };
    const events = await runToolInputStream(
      [JSON.stringify(input)],
      [
        {
          type: "tool_use",
          id: "toolu_01",
          name: "create_document",
          input: {},
        },
      ],
    );

    expect(events.some((e) => e.type === "tool-call")).toBe(false);
    expect(events.find((e) => e.type === "assistant-content")?.parts).toEqual([
      {
        type: "tool-call",
        id: "toolu_01",
        name: "create_document",
        input,
      },
    ]);
  });
});
