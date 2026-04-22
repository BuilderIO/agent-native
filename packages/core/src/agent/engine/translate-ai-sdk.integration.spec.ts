/**
 * Integration test for the AI SDK translator.
 *
 * Unlike translate-ai-sdk.spec.ts — which tests the translator against
 * synthetic TextStreamPart objects in isolation — this spec drives real
 * `streamText` with `MockLanguageModelV3` from `ai/test`. It exercises the
 * full pipeline: mock LM parts → streamText transformation → our translator.
 *
 * This is our insurance against AI SDK minor-version drift: if Vercel changes
 * the fullStream event shapes subtly between v6 patches, these tests fail
 * loudly, unlike the unit specs which would happily keep passing against
 * stale fixtures.
 */
import { describe, it, expect } from "vitest";
import { streamText } from "ai";
import { MockLanguageModelV3, convertArrayToReadableStream } from "ai/test";
import { aiSdkPartToEngineEvents } from "./translate-ai-sdk.js";
import type { EngineEvent } from "./types.js";

function mockModel(parts: any[]) {
  return new MockLanguageModelV3({
    doStream: async () => ({ stream: convertArrayToReadableStream(parts) }),
  });
}

async function collect(result: {
  fullStream: AsyncIterable<unknown>;
}): Promise<EngineEvent[]> {
  const events: EngineEvent[] = [];
  for await (const part of result.fullStream) {
    for (const e of aiSdkPartToEngineEvents(part)) events.push(e);
  }
  return events;
}

/** Build a LanguageModelV3Usage with the common fields set. */
function usage(
  input: number,
  output: number,
  extra: { cacheRead?: number; reasoning?: number } = {},
) {
  return {
    inputTokens: {
      total: input,
      noCache: input - (extra.cacheRead ?? 0),
      cacheRead: extra.cacheRead,
      cacheWrite: undefined,
    },
    outputTokens: {
      total: output,
      text: output - (extra.reasoning ?? 0),
      reasoning: extra.reasoning,
    },
  };
}

/** Build a finish stream-part. */
function finish(
  reason:
    | "stop"
    | "tool-calls"
    | "length"
    | "content-filter"
    | "error"
    | "other",
  u: ReturnType<typeof usage>,
) {
  return {
    type: "finish" as const,
    usage: u,
    finishReason: { unified: reason, raw: reason },
  };
}

describe("translate-ai-sdk integration (streamText + MockLanguageModelV3)", () => {
  it("translates a plain text response into text-delta + usage + stop", async () => {
    const model = mockModel([
      { type: "stream-start", warnings: [] },
      { type: "text-start", id: "t1" },
      { type: "text-delta", id: "t1", delta: "hello" },
      { type: "text-delta", id: "t1", delta: " world" },
      { type: "text-end", id: "t1" },
      finish("stop", usage(5, 2)),
    ]);

    const events = await collect(streamText({ model, prompt: "hi" }));

    const deltas = events.filter((e) => e.type === "text-delta");
    expect(deltas.map((e: any) => e.text).join("")).toBe("hello world");
    expect(events.find((e) => e.type === "usage")).toMatchObject({
      inputTokens: 5,
      outputTokens: 2,
    });
    expect(events.find((e) => e.type === "stop")).toMatchObject({
      reason: "end_turn",
    });
  });

  it("maps finishReason 'tool-calls' to tool_use stop and emits a tool-call event", async () => {
    const model = mockModel([
      { type: "stream-start", warnings: [] },
      { type: "tool-input-start", id: "tc1", toolName: "get_weather" },
      { type: "tool-input-delta", id: "tc1", delta: '{"city":"' },
      { type: "tool-input-delta", id: "tc1", delta: 'Paris"}' },
      { type: "tool-input-end", id: "tc1" },
      {
        type: "tool-call",
        toolCallId: "tc1",
        toolName: "get_weather",
        input: '{"city":"Paris"}',
      },
      finish("tool-calls", usage(8, 4)),
    ]);

    const events = await collect(streamText({ model, prompt: "weather" }));

    expect(events.find((e) => e.type === "tool-call")).toMatchObject({
      id: "tc1",
      name: "get_weather",
      input: { city: "Paris" },
    });
    expect(events.find((e) => e.type === "stop")).toMatchObject({
      reason: "tool_use",
    });
  });

  it("surfaces cacheRead tokens via cacheReadTokens on the usage event", async () => {
    const model = mockModel([
      { type: "stream-start", warnings: [] },
      { type: "text-start", id: "t1" },
      { type: "text-delta", id: "t1", delta: "ok" },
      { type: "text-end", id: "t1" },
      finish("stop", usage(100, 1, { cacheRead: 60 })),
    ]);

    const events = await collect(streamText({ model, prompt: "hi" }));
    expect(events.find((e) => e.type === "usage")).toMatchObject({
      inputTokens: 100,
      outputTokens: 1,
      cacheReadTokens: 60,
    });
  });

  it("emits a thinking-delta event for reasoning-delta parts", async () => {
    const model = mockModel([
      { type: "stream-start", warnings: [] },
      { type: "reasoning-start", id: "r1" },
      { type: "reasoning-delta", id: "r1", delta: "let me think" },
      { type: "reasoning-end", id: "r1" },
      { type: "text-start", id: "t1" },
      { type: "text-delta", id: "t1", delta: "the answer is 42" },
      { type: "text-end", id: "t1" },
      finish("stop", usage(5, 10, { reasoning: 4 })),
    ]);

    const events = await collect(streamText({ model, prompt: "q" }));
    const thinking = events.filter((e) => e.type === "thinking-delta");
    expect(thinking.map((e: any) => e.text).join("")).toBe("let me think");
  });

  it("maps a stream-level error into a stop-with-error event", async () => {
    const model = mockModel([
      { type: "stream-start", warnings: [] },
      { type: "error", error: new Error("upstream blew up") },
    ]);

    const events = await collect(streamText({ model, prompt: "boom" }));
    const stop = events.find((e) => e.type === "stop");
    expect(stop).toMatchObject({ reason: "error" });
    if (stop?.type === "stop") {
      expect(stop.error).toContain("upstream blew up");
    }
  });
});
