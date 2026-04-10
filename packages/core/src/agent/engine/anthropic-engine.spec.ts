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

describe("createAnthropicEngine", () => {
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
      default: vi.fn().mockImplementation(() => ({
        messages: { stream: vi.fn().mockReturnValue(mockStream) },
      })),
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
    expect(stopEvent?.error).toContain("ANTHROPIC_API_KEY");
  });
});
