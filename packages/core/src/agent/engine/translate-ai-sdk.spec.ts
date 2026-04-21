import { describe, it, expect } from "vitest";
import {
  engineToolsToAISDK,
  engineMessagesToAISDK,
  aiSdkPartToEngineEvents,
  aiSdkStepToAssistantContent,
} from "./translate-ai-sdk.js";
import type { EngineTool, EngineMessage } from "./types.js";

describe("engineToolsToAISDK", () => {
  it("converts tools to AI SDK v6 format (plain JSON Schema)", () => {
    const tools: EngineTool[] = [
      {
        name: "search",
        description: "Search for something",
        inputSchema: {
          type: "object",
          properties: { q: { type: "string" } },
          required: ["q"],
        },
      },
    ];

    const result = engineToolsToAISDK(tools);
    expect(result).toHaveProperty("search");
    expect(result.search.description).toBe("Search for something");
    expect(result.search.inputSchema.properties).toHaveProperty("q");
  });

  it("wraps inputSchema with jsonSchema() when provided", () => {
    const tools: EngineTool[] = [
      {
        name: "greet",
        description: "Say hello",
        inputSchema: {
          type: "object",
          properties: { name: { type: "string" } },
          required: ["name"],
        },
      },
    ];

    const wrapped: Record<string, unknown>[] = [];
    const mockJsonSchema = (schema: Record<string, unknown>) => {
      wrapped.push(schema);
      return { _aiSdkWrapped: true, ...schema };
    };

    const result = engineToolsToAISDK(tools, mockJsonSchema);
    expect(wrapped).toHaveLength(1);
    expect(result.greet.inputSchema).toHaveProperty("_aiSdkWrapped", true);
    expect(result.greet.inputSchema.properties).toHaveProperty("name");
  });
});

describe("engineMessagesToAISDK", () => {
  it("converts user text message", () => {
    const messages: EngineMessage[] = [
      { role: "user", content: [{ type: "text", text: "Hi" }] },
    ];
    const result = engineMessagesToAISDK(messages);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("user");
    const content = result[0].content;
    const text =
      typeof content === "string" ? content : (content as any)?.[0]?.text;
    expect(text).toBe("Hi");
  });

  it("converts assistant message with tool-call (v6 input field)", () => {
    const messages: EngineMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "Calling tool" },
          {
            type: "tool-call",
            id: "tc-1",
            name: "search",
            input: { q: "test" },
          },
        ],
      },
    ];
    const result = engineMessagesToAISDK(messages);
    const content = result[0].content as any[];
    const tc = content.find((p: any) => p.type === "tool-call");
    expect(tc).toBeDefined();
    expect(tc.toolCallId).toBe("tc-1");
    expect(tc.toolName).toBe("search");
    expect(tc.input).toEqual({ q: "test" });
  });

  it("emits tool-results as a dedicated role:tool message (v6)", () => {
    const messages: EngineMessage[] = [
      {
        role: "user",
        content: [
          {
            type: "tool-result",
            toolCallId: "tc-1",
            toolName: "search",
            content: "42",
          },
        ],
      },
    ];
    const result = engineMessagesToAISDK(messages);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("tool");
    const tr = (result[0].content as any[]).find(
      (p: any) => p.type === "tool-result",
    );
    expect(tr).toBeDefined();
    expect(tr.toolCallId).toBe("tc-1");
    expect(tr.toolName).toBe("search");
    expect(tr.output).toEqual({ type: "text", value: "42" });
  });

  it("splits mixed user content into tool then user messages", () => {
    const messages: EngineMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "follow-up question" },
          {
            type: "tool-result",
            toolCallId: "tc-1",
            toolName: "search",
            content: "42",
          },
        ],
      },
    ];
    const result = engineMessagesToAISDK(messages);
    expect(result).toHaveLength(2);
    expect(result[0].role).toBe("tool");
    expect(result[1].role).toBe("user");
  });

  it("flags tool-result errors via output.type === 'error-text'", () => {
    const messages: EngineMessage[] = [
      {
        role: "user",
        content: [
          {
            type: "tool-result",
            toolCallId: "tc-1",
            toolName: "search",
            content: "boom",
            isError: true,
          },
        ],
      },
    ];
    const result = engineMessagesToAISDK(messages);
    expect(result[0].role).toBe("tool");
    const tr = (result[0].content as any[]).find(
      (p: any) => p.type === "tool-result",
    );
    expect(tr.output).toEqual({ type: "error-text", value: "boom" });
  });

  it("round-trips an Anthropic thinking signature through providerOptions", () => {
    const messages: EngineMessage[] = [
      {
        role: "assistant",
        content: [
          {
            type: "thinking",
            text: "reasoning about the problem",
            signature: "sig-abc",
          },
        ],
      },
    ];
    const result = engineMessagesToAISDK(messages);
    const reasoning = (result[0].content as any[]).find(
      (p: any) => p.type === "reasoning",
    );
    expect(reasoning).toBeDefined();
    expect(reasoning.text).toBe("reasoning about the problem");
    expect(reasoning.providerOptions?.anthropic?.signature).toBe("sig-abc");
  });
});

describe("aiSdkPartToEngineEvents (v6 stream protocol)", () => {
  it("emits text-delta from v6 text-delta part (uses `text` field)", () => {
    const events = aiSdkPartToEngineEvents({
      type: "text-delta",
      id: "t-1",
      text: "hello",
    });
    expect(events).toEqual([{ type: "text-delta", text: "hello" }]);
  });

  it("absorbs text-start / text-end lifecycle parts", () => {
    expect(aiSdkPartToEngineEvents({ type: "text-start", id: "t-1" })).toEqual(
      [],
    );
    expect(aiSdkPartToEngineEvents({ type: "text-end", id: "t-1" })).toEqual(
      [],
    );
  });

  it("emits thinking-delta from reasoning-delta part", () => {
    const events = aiSdkPartToEngineEvents({
      type: "reasoning-delta",
      id: "r-1",
      text: "I'm thinking...",
    });
    expect(events).toEqual([
      { type: "thinking-delta", text: "I'm thinking..." },
    ]);
  });

  it("absorbs reasoning-start / reasoning-end and tool-input-* lifecycle parts", () => {
    for (const type of [
      "reasoning-start",
      "reasoning-end",
      "tool-input-start",
      "tool-input-delta",
      "tool-input-end",
    ]) {
      expect(aiSdkPartToEngineEvents({ type, id: "x", delta: "y" })).toEqual(
        [],
      );
    }
  });

  it("converts tool-call to tool-call event (v6 input field)", () => {
    const events = aiSdkPartToEngineEvents({
      type: "tool-call",
      toolCallId: "tc-1",
      toolName: "search",
      input: { q: "test" },
    });
    expect(events).toEqual([
      {
        type: "tool-call",
        id: "tc-1",
        name: "search",
        input: { q: "test" },
      },
    ]);
  });

  it("converts finish event with totalUsage to usage + stop events", () => {
    const events = aiSdkPartToEngineEvents({
      type: "finish",
      finishReason: "stop",
      totalUsage: {
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
      },
    });
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      type: "usage",
      inputTokens: 10,
      outputTokens: 5,
    });
    expect(events[1]).toEqual({ type: "stop", reason: "end_turn" });
  });

  it("maps finishReason 'tool-calls' to tool_use stop", () => {
    const events = aiSdkPartToEngineEvents({
      type: "finish",
      finishReason: "tool-calls",
      totalUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    });
    const stop = events.find((e) => e.type === "stop");
    expect(stop).toBeDefined();
    if (stop?.type === "stop") expect(stop.reason).toBe("tool_use");
  });

  it("maps finishReason 'length' to max_tokens stop", () => {
    const events = aiSdkPartToEngineEvents({
      type: "finish",
      finishReason: "length",
    });
    const stop = events.find((e) => e.type === "stop");
    if (stop?.type === "stop") expect(stop.reason).toBe("max_tokens");
  });

  it("unpacks cacheReadTokens from v6 inputTokenDetails", () => {
    const events = aiSdkPartToEngineEvents({
      type: "finish-step",
      usage: {
        inputTokens: 100,
        outputTokens: 20,
        totalTokens: 120,
        inputTokenDetails: {
          cacheReadTokens: 50,
          cacheWriteTokens: 10,
          noCacheTokens: 40,
        },
      },
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "usage",
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 50,
      cacheWriteTokens: 10,
    });
  });

  it("falls back to deprecated cachedInputTokens on pre-v6 usage shapes", () => {
    const events = aiSdkPartToEngineEvents({
      type: "finish-step",
      usage: {
        inputTokens: 100,
        outputTokens: 20,
        cachedInputTokens: 25,
      },
    });
    expect(events[0]).toMatchObject({
      type: "usage",
      cacheReadTokens: 25,
    });
  });

  it("finish-step emits usage only, no stop (stop waits for finish)", () => {
    const events = aiSdkPartToEngineEvents({
      type: "finish-step",
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      finishReason: "stop",
    });
    expect(events.some((e) => e.type === "stop")).toBe(false);
    expect(events.some((e) => e.type === "usage")).toBe(true);
  });

  it("converts error part to stop-with-error event", () => {
    const events = aiSdkPartToEngineEvents({
      type: "error",
      error: new Error("some stream error"),
    });
    expect(events).toHaveLength(1);
    const stop = events[0];
    expect(stop.type).toBe("stop");
    if (stop.type === "stop") {
      expect(stop.reason).toBe("error");
      expect(stop.error).toContain("some stream error");
    }
  });

  it("silently absorbs unknown or non-engine-facing part types", () => {
    for (const type of [
      "start",
      "start-step",
      "source",
      "file",
      "raw",
      "abort",
      "zzz-unknown",
    ]) {
      expect(aiSdkPartToEngineEvents({ type })).toEqual([]);
    }
  });
});

describe("aiSdkStepToAssistantContent", () => {
  it("reconstructs content from v6 step.content array", () => {
    const parts = aiSdkStepToAssistantContent({
      content: [
        { type: "text", text: "hello" },
        {
          type: "tool-call",
          toolCallId: "tc-1",
          toolName: "search",
          input: { q: "test" },
        },
        {
          type: "reasoning",
          text: "thinking...",
          providerMetadata: { anthropic: { signature: "sig-1" } },
        },
      ],
    });
    expect(parts).toEqual([
      { type: "text", text: "hello" },
      {
        type: "tool-call",
        id: "tc-1",
        name: "search",
        input: { q: "test" },
      },
      { type: "thinking", text: "thinking...", signature: "sig-1" },
    ]);
  });

  it("returns an empty array for a malformed step with no content", () => {
    expect(aiSdkStepToAssistantContent({})).toEqual([]);
    expect(aiSdkStepToAssistantContent(null)).toEqual([]);
  });
});
