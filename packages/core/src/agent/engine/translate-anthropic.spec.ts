import Ajv2020 from "ajv/dist/2020.js";
import { describe, it, expect } from "vitest";

import { dbExecToolParameters } from "../../scripts/db/tool-schemas.js";
import {
  anthropicChunkToEngineEvents,
  createAnthropicChunkStreamState,
  engineToolsToAnthropic,
  engineMessagesToAnthropic,
  engineMessagesToBuilderGatewayAnthropic,
  anthropicContentToEngine,
  backfillEngineMessagesToolResults,
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

  it("removes top-level combinators Anthropic rejects from tool schemas", () => {
    const inputSchema: EngineTool["inputSchema"] = {
      type: "object",
      properties: {
        sql: { type: "string" },
        statements: { type: "string" },
        maybe: {
          anyOf: [{ type: "string" }, { type: "null" }],
        },
      },
      oneOf: [{ required: ["sql"] }, { required: ["statements"] }],
      allOf: [{ required: ["maybe"] }],
    };

    const result = engineToolsToAnthropic([
      {
        name: "write",
        description: "Write SQL",
        inputSchema,
      },
    ]);

    expect(result[0].input_schema).toMatchObject({
      type: "object",
      properties: {
        sql: { type: "string" },
        statements: { type: "string" },
        maybe: {
          anyOf: [{ type: "string" }, { type: "null" }],
        },
      },
    });
    expect(result[0].input_schema).not.toHaveProperty("oneOf");
    expect(result[0].input_schema).not.toHaveProperty("allOf");
    expect(inputSchema).toHaveProperty("oneOf");
    expect(inputSchema).toHaveProperty("allOf");
  });

  it("narrows db-exec to statements for Anthropic compatibility", () => {
    const inputSchema = dbExecToolParameters() as EngineTool["inputSchema"];
    const result = engineToolsToAnthropic([
      {
        name: "db-exec",
        description: "Write SQL",
        inputSchema,
      },
    ]);
    const schema = result[0].input_schema as Record<string, unknown>;
    const validate = new Ajv2020({ strict: false, allErrors: true }).compile(
      schema,
    );

    expect(schema).not.toHaveProperty("oneOf");
    expect(schema).toMatchObject({
      type: "object",
      required: ["statements"],
      additionalProperties: false,
      properties: {
        statements: {
          type: "string",
          description: expect.stringContaining("single write"),
        },
      },
    });
    expect(schema.properties).not.toHaveProperty("sql");
    expect(schema.properties).not.toHaveProperty("args");
    expect(validate({})).toBe(false);
    expect(validate({ sql: "UPDATE notes SET title = ?" })).toBe(false);
    expect(validate({ format: "json" })).toBe(false);
    expect(validate({ statements: "[]" })).toBe(true);
    expect(
      validate({ sql: "UPDATE notes SET title = ?", statements: "[]" }),
    ).toBe(false);
    expect(inputSchema).toHaveProperty("oneOf");
    expect(inputSchema.properties).toHaveProperty("sql");
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

  it("converts assistant message with tool-call and appends a replay-safe interrupted result", () => {
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
    expect(result).toHaveLength(2);
    const content = result[0].content as any[];
    const tc = content.find((p: any) => p.type === "tool_use");
    expect(tc).toBeDefined();
    expect(tc.id).toBe("tc-1");
    expect(tc.name).toBe("my-tool");
    expect(tc.input).toEqual({ msg: "hi" });
    const replay = result[1].content as any[];
    expect(replay[0]).toMatchObject({
      type: "tool_result",
      tool_use_id: "tc-1",
      content: "Interrupted before this tool returned a result.",
    });
  });

  it("converts PDF file parts to Anthropic document blocks", () => {
    const messages: EngineMessage[] = [
      {
        role: "user",
        content: [
          {
            type: "file",
            filename: "reference.pdf",
            mediaType: "application/pdf",
            data: "JVBERi0x",
          },
        ],
      },
    ];

    const result = engineMessagesToAnthropic(messages);
    const content = result[0].content as any[];
    expect(content[0]).toEqual({
      type: "document",
      source: {
        type: "base64",
        media_type: "application/pdf",
        data: "JVBERi0x",
      },
      title: "reference.pdf",
    });
  });

  it("includes tool_name, tool_input, and tool_use_id on tool_result for Builder gateway / Gemini", () => {
    const messages: EngineMessage[] = [
      { role: "user", content: [{ type: "text", text: "ping" }] },
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            id: "t1",
            name: "generate-image-batch",
            input: {},
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool-result",
            toolCallId: "t1",
            toolName: "generate-image-batch",
            toolInput: "{}",
            content: "ok",
          },
        ],
      },
    ];

    const anthropic = engineMessagesToBuilderGatewayAnthropic(messages);
    const wire = JSON.stringify(anthropic);
    expect(wire).toContain('"tool_name":"generate-image-batch"');
    expect(wire).not.toContain('"tool_name":""');
    expect(wire).not.toMatch(/"tool_name"\s*:\s*null/);

    const userTurn = anthropic[2];
    const parts = userTurn!.content as any[];
    const tr = parts.find((p: any) => p.type === "tool_result");
    expect(tr.tool_use_id).toBe("t1");
    expect(tr.tool_name).toBe("generate-image-batch");
    expect(tr.tool_input).toBe("{}");
    expect(tr.content).toBe("ok");
  });

  it("omits tool_name and tool_input on tool_result for native Anthropic API", () => {
    const messages: EngineMessage[] = [
      { role: "user", content: [{ type: "text", text: "hi" }] },
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            id: "tc-1",
            name: "my-tool",
            input: { msg: "x" },
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool-result",
            toolCallId: "tc-1",
            toolName: "my-tool",
            toolInput: '{"msg":"x"}',
            content: "Tool output",
          },
        ],
      },
    ];

    const result = engineMessagesToAnthropic(messages);
    const tr = (result[2].content as any[]).find(
      (p: any) => p.type === "tool_result",
    );
    expect(tr.tool_use_id).toBe("tc-1");
    expect(tr.content).toBe("Tool output");
    expect(tr).not.toHaveProperty("tool_name");
    expect(tr).not.toHaveProperty("tool_input");
  });

  it("backfills tool_name and tool_input from the matching tool_use when omitted", () => {
    const messages: EngineMessage[] = [
      { role: "user", content: [{ type: "text", text: "ping" }] },
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            id: "t1",
            name: "generate-image-batch",
            input: { slots: ["a"] },
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool-result",
            toolCallId: "t1",
            toolName: "",
            toolInput: "",
            content: "ok",
          },
        ],
      },
    ];

    const filled = backfillEngineMessagesToolResults(messages);
    const tr = (filled[2] as any).content[0];
    expect(tr.toolName).toBe("generate-image-batch");
    expect(JSON.parse(tr.toolInput)).toEqual({ slots: ["a"] });

    const anthropic = engineMessagesToBuilderGatewayAnthropic(messages);
    const trWire = (anthropic[2].content as any[]).find(
      (p: any) => p.type === "tool_result",
    );
    expect(trWire.tool_name).toBe("generate-image-batch");
    expect(JSON.parse(trWire.tool_input)).toEqual({ slots: ["a"] });
  });

  it("adds missing tool_results before the next user content for Builder gateway history replay", () => {
    const messages: EngineMessage[] = [
      { role: "user", content: [{ type: "text", text: "search first" }] },
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            id: "history_tc_1",
            name: "chat-history",
            input: { action: "search" },
          },
        ],
      },
      {
        role: "user",
        content: [{ type: "text", text: "Actually, try another route." }],
      },
    ];

    const anthropic = engineMessagesToBuilderGatewayAnthropic(messages);
    const replay = anthropic[2].content as any[];

    expect(replay[0]).toMatchObject({
      type: "tool_result",
      tool_use_id: "history_tc_1",
      tool_name: "chat-history",
      tool_input: '{"action":"search"}',
      content: "Interrupted before this tool returned a result.",
    });
    expect(replay[1]).toMatchObject({
      type: "text",
      text: "Actually, try another route.",
    });
  });

  it("turns orphan tool_result blocks into replay text when no tool_use matches", () => {
    const messages: EngineMessage[] = [
      {
        role: "user",
        content: [
          {
            type: "tool-result",
            toolCallId: "ghost",
            toolName: "",
            toolInput: "",
            content: "orphan",
          },
        ],
      },
    ];

    const out = backfillEngineMessagesToolResults(messages);
    expect(out[0].content[0]).toMatchObject({
      type: "text",
      text: expect.stringMatching(
        /\(Omitted unmatched tool results from replayed history\.\) \[tool_use_id=ghost\] orphan/,
      ),
    });
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

describe("anthropicChunkToEngineEvents", () => {
  it("emits tool input progress with id and name across streamed chunks", () => {
    const state = createAnthropicChunkStreamState();

    expect(
      anthropicChunkToEngineEvents(
        {
          type: "content_block_start",
          index: 1,
          content_block: {
            type: "tool_use",
            id: "toolu_1",
            name: "create-extension",
          },
        },
        state,
      ),
    ).toEqual([
      {
        type: "tool-input-start",
        id: "toolu_1",
        name: "create-extension",
      },
    ]);

    expect(
      anthropicChunkToEngineEvents(
        {
          type: "content_block_delta",
          index: 1,
          delta: {
            type: "input_json_delta",
            partial_json: '{"html":"<div',
          },
        },
        state,
      ),
    ).toEqual([
      {
        type: "tool-input-delta",
        id: "toolu_1",
        name: "create-extension",
        text: '{"html":"<div',
      },
    ]);
  });
});
