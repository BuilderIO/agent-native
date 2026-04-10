import { describe, it, expect } from "vitest";
import {
  engineToolsToAnthropic,
  engineMessagesToAnthropic,
  anthropicContentToEngine,
} from "./translate-anthropic.js";
import type { EngineTool, EngineMessage } from "./types.js";

describe("engineToolsToAnthropic", () => {
  it("converts EngineTool to Anthropic tool format", () => {
    const tools: EngineTool[] = [
      {
        name: "my-tool",
        description: "Does something",
        inputSchema: {
          type: "object",
          properties: { msg: { type: "string" } },
          required: ["msg"],
        },
      },
    ];

    const result = engineToolsToAnthropic(tools);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("my-tool");
    expect(result[0].description).toBe("Does something");
    expect(result[0].input_schema.properties).toHaveProperty("msg");
  });
});

describe("engineMessagesToAnthropic", () => {
  it("converts simple user message", () => {
    const messages: EngineMessage[] = [
      { role: "user", content: [{ type: "text", text: "Hello" }] },
    ];

    const result = engineMessagesToAnthropic(messages);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("user");
    // Single text part should coerce to a string for Anthropic
    const content = result[0].content;
    const textPart = Array.isArray(content)
      ? (content as any[]).find((p: any) => p.type === "text")
      : null;
    expect(textPart?.text ?? content).toBe("Hello");
  });

  it("converts assistant message with tool-call", () => {
    const messages: EngineMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "Using tool" },
          {
            type: "tool-call",
            id: "tc-1",
            name: "my-tool",
            input: { msg: "hi" },
          },
        ],
      },
    ];

    const result = engineMessagesToAnthropic(messages);
    expect(result).toHaveLength(1);
    const content = result[0].content as any[];
    const tc = content.find((p: any) => p.type === "tool_use");
    expect(tc).toBeDefined();
    expect(tc.id).toBe("tc-1");
    expect(tc.name).toBe("my-tool");
    expect(tc.input).toEqual({ msg: "hi" });
  });

  it("converts user message with tool-result", () => {
    const messages: EngineMessage[] = [
      {
        role: "user",
        content: [
          {
            type: "tool-result",
            toolCallId: "tc-1",
            content: "Tool output",
          },
        ],
      },
    ];

    const result = engineMessagesToAnthropic(messages);
    const content = result[0].content as any[];
    const tr = content.find((p: any) => p.type === "tool_result");
    expect(tr).toBeDefined();
    expect(tr.tool_use_id).toBe("tc-1");
    expect(tr.content).toBe("Tool output");
  });
});

describe("anthropicContentToEngine", () => {
  it("converts text block", () => {
    const result = anthropicContentToEngine([{ type: "text", text: "hello" }]);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ type: "text", text: "hello" });
  });

  it("converts tool_use block", () => {
    const result = anthropicContentToEngine([
      { type: "tool_use", id: "tu-1", name: "my-tool", input: { x: 1 } },
    ]);
    expect(result[0]).toMatchObject({
      type: "tool-call",
      id: "tu-1",
      name: "my-tool",
      input: { x: 1 },
    });
  });
});
