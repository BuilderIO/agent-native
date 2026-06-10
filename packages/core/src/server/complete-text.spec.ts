import { describe, expect, it } from "vitest";
import type {
  AgentEngine,
  EngineStreamOptions,
} from "../agent/engine/index.js";
import { completeText } from "./complete-text.js";

function createFakeEngine(
  stream: (opts: EngineStreamOptions) => AsyncIterable<any>,
): AgentEngine {
  return {
    name: "fake",
    label: "Fake",
    defaultModel: "fake-default",
    supportedModels: ["fake-default", "fake-override"],
    capabilities: {
      thinking: false,
      promptCaching: false,
      vision: false,
      computerUse: false,
      parallelToolCalls: false,
    },
    stream,
  };
}

describe("completeText", () => {
  it("runs one tool-free engine call and returns final assistant text", async () => {
    const calls: EngineStreamOptions[] = [];
    const engine = createFakeEngine(async function* (opts) {
      calls.push(opts);
      yield { type: "text-delta", text: "draft" };
      yield {
        type: "assistant-content",
        parts: [{ type: "text", text: "final" }],
      };
      yield {
        type: "usage",
        inputTokens: 3,
        outputTokens: 5,
        totalTokens: 8,
      };
      yield { type: "stop", reason: "end_turn" };
    });

    const result = await completeText({
      engine,
      model: "fake-override",
      systemPrompt: "Be terse.",
      input: "Summarize this.",
      apiKey: "test-key",
      maxOutputTokens: 128,
      temperature: 0,
    });

    expect(result).toMatchObject({
      text: "final",
      engine: "fake",
      model: "fake-override",
      stopReason: "end_turn",
      usage: { inputTokens: 3, outputTokens: 5, totalTokens: 8 },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      model: "fake-override",
      systemPrompt: "Be terse.",
      tools: [],
      maxOutputTokens: 128,
      temperature: 0,
    });
    expect(calls[0]?.messages).toEqual([
      {
        role: "user",
        content: [{ type: "text", text: "Summarize this." }],
      },
    ]);
  });

  it("falls back to streamed text when no assistant-content arrives", async () => {
    const engine = createFakeEngine(async function* () {
      yield { type: "text-delta", text: "hello " };
      yield { type: "text-delta", text: "world" };
      yield { type: "stop", reason: "end_turn" };
    });

    const result = await completeText({
      engine,
      input: "Say hi.",
      apiKey: "test-key",
    });

    expect(result.text).toBe("hello world");
    expect(result.content).toEqual([{ type: "text", text: "hello world" }]);
  });

  it("appends input after explicit messages", async () => {
    const calls: EngineStreamOptions[] = [];
    const engine = createFakeEngine(async function* (opts) {
      calls.push(opts);
      yield {
        type: "assistant-content",
        parts: [{ type: "text", text: "ok" }],
      };
      yield { type: "stop", reason: "end_turn" };
    });

    await completeText({
      engine,
      messages: [
        { role: "user", content: "Classify this." },
        { role: "assistant", content: "Ready." },
      ],
      input: "urgent",
      apiKey: "test-key",
    });

    expect(calls[0]?.messages).toEqual([
      { role: "user", content: [{ type: "text", text: "Classify this." }] },
      { role: "assistant", content: [{ type: "text", text: "Ready." }] },
      { role: "user", content: [{ type: "text", text: "urgent" }] },
    ]);
  });

  it("throws structured engine errors from stop(error)", async () => {
    const engine = createFakeEngine(async function* () {
      yield {
        type: "stop",
        reason: "error",
        error: "quota exceeded",
        errorCode: "credits-limit-monthly",
        statusCode: 402,
      };
    });

    await expect(
      completeText({ engine, input: "Try.", apiKey: "test-key" }),
    ).rejects.toMatchObject({
      name: "EngineError",
      message: "quota exceeded",
      errorCode: "credits-limit-monthly",
      statusCode: 402,
    });
  });

  it("requires input or messages", async () => {
    const engine = createFakeEngine(async function* () {
      yield { type: "stop", reason: "end_turn" };
    });

    await expect(completeText({ engine, apiKey: "test-key" })).rejects.toThrow(
      /requires `input` or at least one message/,
    );
  });
});
