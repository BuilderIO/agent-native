import { describe, it, expect } from "vitest";
import {
  engineToolsToAISDK,
  engineMessagesToAISDK,
  aiSdkPartToEngineEvents,
} from "./translate-ai-sdk.js";
import type { EngineTool, EngineMessage } from "./types.js";

describe("engineToolsToAISDK", () => {
  it("converts tools to AI SDK format (plain JSON Schema)", () => {
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
    expect(result.search.parameters.properties).toHaveProperty("q");
  });

  it("wraps parameters with jsonSchema() when provided", () => {
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

    // Simulate the AI SDK's jsonSchema() helper (wraps raw schema with marker)
    const wrapped: Record<string, unknown>[] = [];
    const mockJsonSchema = (schema: Record<string, unknown>) => {
      wrapped.push(schema);
      return { _aiSdkWrapped: true, ...schema };
    };

    const result = engineToolsToAISDK(tools, mockJsonSchema);
    expect(wrapped).toHaveLength(1);
    expect(result.greet.parameters).toHaveProperty("_aiSdkWrapped", true);
    expect(result.greet.parameters.properties).toHaveProperty("name");
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
    // Single text part may be coerced to string
    const content = result[0].content;
    const text =
      typeof content === "string" ? content : (content as any)?.[0]?.text;
    expect(text).toBe("Hi");
  });

  it("converts assistant message with tool-call", () => {
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
    expect(tc.args).toEqual({ q: "test" });
  });
});

describe("aiSdkPartToEngineEvents", () => {
  it("converts text-delta to text-delta event", () => {
    const events = aiSdkPartToEngineEvents({
      type: "text-delta",
      textDelta: "hello",
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: "text-delta", text: "hello" });
  });

  it("converts reasoning to thinking-delta event", () => {
    const events = aiSdkPartToEngineEvents({
      type: "reasoning",
      textDelta: "I'm thinking...",
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: "thinking-delta",
      text: "I'm thinking...",
    });
  });

  it("converts tool-call to tool-call event", () => {
    const events = aiSdkPartToEngineEvents({
      type: "tool-call",
      toolCallId: "tc-1",
      toolName: "search",
      args: { q: "test" },
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "tool-call",
      id: "tc-1",
      name: "search",
      input: { q: "test" },
    });
  });

  it("converts finish event to stop event", () => {
    const events = aiSdkPartToEngineEvents({
      type: "finish",
      finishReason: "stop",
      usage: { promptTokens: 10, completionTokens: 5 },
    });
    const stopEvent = events.find((e) => e.type === "stop");
    expect(stopEvent).toBeDefined();
    if (stopEvent?.type === "stop") {
      expect(stopEvent.reason).toBe("end_turn");
    }
  });

  it("converts error part to stop-with-error event", () => {
    const events = aiSdkPartToEngineEvents({
      type: "error",
      error: new Error("some stream error"),
    });
    expect(events).toHaveLength(1);
    const stop = events[0];
    if (stop.type === "stop") {
      expect(stop.reason).toBe("error");
      expect((stop as any).error).toContain("some stream error");
    }
  });

  it("converts tool_calls finish reason to tool_use stop", () => {
    const events = aiSdkPartToEngineEvents({
      type: "finish",
      finishReason: "tool-calls",
      usage: { promptTokens: 10, completionTokens: 5 },
    });
    const stopEvent = events.find((e) => e.type === "stop");
    if (stopEvent?.type === "stop") {
      expect(stopEvent.reason).toBe("tool_use");
    }
  });
});
