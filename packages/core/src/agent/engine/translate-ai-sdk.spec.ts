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

  it("preserves full JSON Schema constraints when translating tools", () => {
    const tools: EngineTool[] = [
      {
        name: "write",
        description: "Write something",
        inputSchema: {
          type: "object",
          properties: {
            sql: { type: "string", minLength: 1 },
            statements: { type: "string", pattern: "^\\[" },
          },
          additionalProperties: false,
          oneOf: [{ required: ["sql"] }, { required: ["statements"] }],
        },
      },
    ];

    const result = engineToolsToAISDK(tools);

    expect(result.write.inputSchema).toMatchObject({
      type: "object",
      additionalProperties: false,
      oneOf: [{ required: ["sql"] }, { required: ["statements"] }],
    });
    expect(result.write.inputSchema.properties.sql.minLength).toBe(1);
    expect(result.write.inputSchema.properties.statements.pattern).toBe("^\\[");
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

  it("converts user file parts", () => {
    const messages: EngineMessage[] = [
      {
        role: "user",
        content: [
          {
            type: "file",
            filename: "slides.pptx",
            mediaType:
              "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            data: "UEsDBA==",
          },
          { type: "text", text: "Use this deck" },
        ],
      },
    ];
    const result = engineMessagesToAISDK(messages);
    const content = result[0].content as any[];
    expect(content[0]).toEqual({
      type: "file",
      filename: "slides.pptx",
      mediaType:
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      data: "UEsDBA==",
    });
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
            toolInput: "{}",
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
            toolInput: "{}",
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
            toolInput: "{}",
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

describe("engineMessagesToAISDK tool-result images", () => {
  const messagesWithImages = (
    images: import("./types.js").EngineToolResultImagePart[],
    isError = false,
  ): EngineMessage[] => [
    {
      role: "user",
      content: [
        {
          type: "tool-result",
          toolCallId: "tc-1",
          toolName: "screenshot",
          toolInput: "{}",
          content: "Captured",
          images,
          ...(isError ? { isError: true } : {}),
        },
      ],
    },
  ];

  const firstToolResult = (result: any[]) =>
    (result[0].content as any[]).find((p: any) => p.type === "tool-result");

  it("emits content output with image-url and image-data when enabled", () => {
    const result = engineMessagesToAISDK(
      messagesWithImages([
        { url: "https://cdn.example.com/shot.png" },
        { data: "aGVsbG8=", mediaType: "image/jpeg" },
      ]),
      { toolResultImages: true },
    );
    expect(firstToolResult(result).output).toEqual({
      type: "content",
      value: [
        { type: "text", text: "Captured" },
        { type: "image-url", url: "https://cdn.example.com/shot.png" },
        { type: "image-data", data: "aGVsbG8=", mediaType: "image/jpeg" },
      ],
    });
  });

  it("degrades to plain text output when the flag is off (default)", () => {
    const result = engineMessagesToAISDK(
      messagesWithImages([{ url: "https://cdn.example.com/shot.png" }]),
    );
    expect(firstToolResult(result).output).toEqual({
      type: "text",
      value: "Captured",
    });
  });

  it("degrades to plain text output when all image entries are malformed", () => {
    const result = engineMessagesToAISDK(
      messagesWithImages([{ label: "nothing usable" } as any]),
      { toolResultImages: true },
    );
    expect(firstToolResult(result).output).toEqual({
      type: "text",
      value: "Captured",
    });
  });

  it("keeps error-text output for error results even with images", () => {
    const result = engineMessagesToAISDK(
      messagesWithImages([{ url: "https://cdn.example.com/shot.png" }], true),
      { toolResultImages: true },
    );
    expect(firstToolResult(result).output).toEqual({
      type: "error-text",
      value: "Captured",
    });
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

  it("absorbs reasoning boundaries and tool-input-end lifecycle parts", () => {
    for (const type of ["reasoning-start", "reasoning-end", "tool-input-end"]) {
      expect(aiSdkPartToEngineEvents({ type, id: "x", delta: "y" })).toEqual(
        [],
      );
    }
  });

  it("emits tool input progress while arguments are being assembled", () => {
    expect(
      aiSdkPartToEngineEvents({
        type: "tool-input-start",
        id: "tc-1",
        toolName: "create-document",
      }),
    ).toEqual([
      {
        type: "tool-input-start",
        id: "tc-1",
        name: "create-document",
      },
    ]);
    expect(
      aiSdkPartToEngineEvents({
        type: "tool-input-delta",
        id: "tc-1",
        delta: '{"title"',
      }),
    ).toEqual([
      {
        type: "tool-input-delta",
        id: "tc-1",
        text: '{"title"',
      },
    ]);
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

  it("converts AI SDK tool input errors into recoverable tool-call-error events", () => {
    const events = aiSdkPartToEngineEvents({
      type: "tool-input-error",
      toolCallId: "tc-1",
      toolName: "add-slide",
      input: { position: "x" },
      errorText: "position must be a number",
    });
    expect(events).toEqual([
      {
        type: "tool-call-error",
        id: "tc-1",
        name: "add-slide",
        input: { position: "x" },
        error: "position must be a number",
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
    // Usage is emitted from the terminal `finish` (totalUsage), not per-step,
    // to avoid double-counting tokens. The cache-detail unpacking is identical.
    const events = aiSdkPartToEngineEvents({
      type: "finish",
      finishReason: "stop",
      totalUsage: {
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
    const usage = events.find((e) => e.type === "usage");
    expect(usage).toMatchObject({
      type: "usage",
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 50,
      cacheWriteTokens: 10,
    });
  });

  it("falls back to deprecated cachedInputTokens on pre-v6 usage shapes", () => {
    const events = aiSdkPartToEngineEvents({
      type: "finish",
      finishReason: "stop",
      totalUsage: {
        inputTokens: 100,
        outputTokens: 20,
        cachedInputTokens: 25,
      },
    });
    const usage = events.find((e) => e.type === "usage");
    expect(usage).toMatchObject({
      type: "usage",
      cacheReadTokens: 25,
    });
  });

  it("finish-step emits no usage (usage waits for finish, avoids double-count)", () => {
    const events = aiSdkPartToEngineEvents({
      type: "finish-step",
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      finishReason: "stop",
    });
    expect(events.some((e) => e.type === "stop")).toBe(false);
    expect(events.some((e) => e.type === "usage")).toBe(false);
  });

  it("emits usage exactly once when finish-step and finish both arrive", () => {
    const stepEvents = aiSdkPartToEngineEvents({
      type: "finish-step",
      usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
      finishReason: "stop",
    });
    const finishEvents = aiSdkPartToEngineEvents({
      type: "finish",
      finishReason: "stop",
      totalUsage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
    });
    const usageEvents = [...stepEvents, ...finishEvents].filter(
      (e) => e.type === "usage",
    );
    expect(usageEvents).toHaveLength(1);
    expect(usageEvents[0]).toMatchObject({
      inputTokens: 100,
      outputTokens: 20,
    });
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

  it("keeps invalid tool inputs in assistant history so an error result can be attached", () => {
    const parts = aiSdkStepToAssistantContent({
      content: [
        {
          type: "tool-input-error",
          toolCallId: "tc-1",
          toolName: "add-slide",
          input: { position: "x" },
        },
      ],
    });
    expect(parts).toEqual([
      {
        type: "tool-call",
        id: "tc-1",
        name: "add-slide",
        input: { position: "x" },
      },
    ]);
  });

  it("returns an empty array for a malformed step with no content", () => {
    expect(aiSdkStepToAssistantContent({})).toEqual([]);
    expect(aiSdkStepToAssistantContent(null)).toEqual([]);
  });
});
