import { describe, expect, it, vi } from "vitest";
import { attachToolSearch } from "./tool-search.js";
import {
  AGENT_INTERNAL_CONTINUE_PROMPT,
  buildUserContentWithAttachments,
  createPlanModeActionRegistry,
  isPlanModeToolCallAllowed,
  runAgentLoop,
  structuredHistoryToEngineMessages,
  type ActionEntry,
  type AgentLoopFinalResponseGuardContext,
} from "./production-agent.js";
import { AgentActionStopError } from "../action.js";
import {
  getRequestRunContext,
  runWithRequestContext,
} from "../server/request-context.js";
import type { AgentEngine, EngineEvent } from "./engine/types.js";

function actionEntry(opts: {
  description?: string;
  readOnly?: boolean;
  parallelSafe?: boolean;
  actions?: string[];
}): ActionEntry {
  return {
    tool: {
      description: opts.description ?? "Test action",
      parameters: opts.actions
        ? {
            type: "object",
            properties: {
              action: {
                type: "string",
                enum: opts.actions,
              },
            },
            required: ["action"],
          }
        : {
            type: "object",
            properties: {},
          },
    },
    ...(typeof opts.readOnly === "boolean" ? { readOnly: opts.readOnly } : {}),
    ...(typeof opts.parallelSafe === "boolean"
      ? { parallelSafe: opts.parallelSafe }
      : {}),
    run: async (args) => `ran:${JSON.stringify(args)}`,
  };
}

describe("buildUserContentWithAttachments", () => {
  it("preserves the prompt text when there are no attachments", () => {
    expect(buildUserContentWithAttachments({ text: "Hello" })).toEqual([
      { type: "text", text: "Hello" },
    ]);
  });

  it("adds supported image attachments before the prompt text", () => {
    expect(
      buildUserContentWithAttachments({
        text: "Describe this",
        attachments: [
          {
            type: "image",
            name: "screen.png",
            contentType: "image/png",
            data: "data:image/png;base64,aW1hZ2U=",
          },
        ],
      }),
    ).toEqual([
      { type: "image", mediaType: "image/png", data: "aW1hZ2U=" },
      { type: "text", text: "Describe this" },
    ]);
  });

  it("includes text and file attachments in the text sent to the engine", () => {
    const content = buildUserContentWithAttachments({
      text: "Summarize the attachment",
      attachments: [
        {
          type: "file",
          name: 'notes "qa".txt',
          contentType: "text/plain",
          text: "Line one\nLine two",
        },
        {
          type: "file",
          name: "empty.txt",
          contentType: "text/plain",
          text: "",
        },
      ],
    });

    expect(content).toHaveLength(1);
    expect(content[0]).toMatchObject({ type: "text" });
    expect(content[0].type === "text" ? content[0].text : "").toBe(
      '<attachment name="notes &quot;qa&quot;.txt" contentType="text/plain" type="file">\n' +
        "Line one\nLine two\n" +
        "</attachment>\n\n" +
        "Summarize the attachment",
    );
  });

  it("unwraps and truncates oversized text attachments before model input", () => {
    const longBody = "A".repeat(60_010);
    const content = buildUserContentWithAttachments({
      text: "Summarize the transcript",
      attachments: [
        {
          type: "file",
          name: "transcript.txt",
          contentType: "text/plain",
          text: `<attachment name=transcript.txt>\n${longBody}\n</attachment>`,
        },
      ],
    });

    const text = content[0].type === "text" ? content[0].text : "";
    expect(text).toContain("A".repeat(60_000));
    expect(text).toContain(
      "[Attachment truncated after 60,000 characters; 10 characters omitted",
    );
    expect(text).not.toContain("<attachment name=transcript.txt>");
    expect(text).toContain("Summarize the transcript");
  });

  it("adds binary file attachments before the prompt text", () => {
    expect(
      buildUserContentWithAttachments({
        text: "Use this reference",
        attachments: [
          {
            type: "file",
            name: "reference.pdf",
            contentType: "application/pdf",
            data: "data:application/pdf;base64,JVBERi0x",
          },
        ],
      }),
    ).toEqual([
      {
        type: "file",
        mediaType: "application/pdf",
        filename: "reference.pdf",
        data: "JVBERi0x",
      },
      { type: "text", text: "Use this reference" },
    ]);
  });

  it("skips unsupported image media types instead of sending invalid engine content", () => {
    expect(
      buildUserContentWithAttachments({
        text: "Can you read this SVG?",
        attachments: [
          {
            type: "image",
            name: "icon.svg",
            contentType: "image/svg+xml",
            data: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
          },
        ],
      }),
    ).toEqual([{ type: "text", text: "Can you read this SVG?" }]);
  });

  it("normalizes structured chat history with tool calls and results", () => {
    expect(
      structuredHistoryToEngineMessages([
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "tc_1",
              toolName: "get-document",
              args: { id: "doc-1" },
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "tool-result",
              toolCallId: "tc_1",
              toolName: "get-document",
              content: '{"title":"Offsite rambles"}',
            },
          ],
        },
      ]),
    ).toEqual([
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            id: "tc_1",
            name: "get-document",
            input: { id: "doc-1" },
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool-result",
            toolCallId: "tc_1",
            toolName: "get-document",
            content: '{"title":"Offsite rambles"}',
          },
        ],
      },
    ]);
  });

  it("builds a plan-mode registry with only read-only tools", async () => {
    const registry = attachToolSearch({
      "read-file": actionEntry({ readOnly: true }),
      "write-file": actionEntry({ readOnly: false }),
      "set-url-path": actionEntry({ readOnly: true }),
      resources: actionEntry({
        actions: ["list", "read", "write", "delete"],
      }),
    });

    const planRegistry = createPlanModeActionRegistry(registry);

    expect(Object.keys(planRegistry).sort()).toEqual([
      "read-file",
      "resources",
      "tool-search",
    ]);
    expect(
      planRegistry.resources.tool.parameters?.properties.action.enum,
    ).toEqual(["list", "read"]);
    await expect(
      planRegistry.resources.run({ action: "read" }),
    ).resolves.toContain('"action":"read"');
    await expect(
      planRegistry.resources.run({ action: "write" }),
    ).resolves.toContain("Plan mode blocked");

    const searchResult = await planRegistry["tool-search"].run({
      query: "write file",
    } as any);
    expect(searchResult.results.map((tool: any) => tool.name)).not.toContain(
      "write-file",
    );
  });

  it("treats mixed tools as read-only only for allowed arguments", () => {
    const webRequest = actionEntry({ readOnly: true });
    expect(
      isPlanModeToolCallAllowed("web-request", { method: "GET" }, webRequest),
    ).toBe(true);
    expect(
      isPlanModeToolCallAllowed("web-request", { method: "POST" }, webRequest),
    ).toBe(false);

    const urlTool = actionEntry({ readOnly: true });
    expect(isPlanModeToolCallAllowed("set-url-path", {}, urlTool)).toBe(false);
  });
});

describe("runAgentLoop", () => {
  it("emits activity while a tool input is being assembled", async () => {
    let streamCalls = 0;
    const engine: AgentEngine = {
      name: "test",
      label: "Test",
      defaultModel: "test-model",
      supportedModels: ["test-model"],
      capabilities: {
        thinking: false,
        promptCaching: false,
        vision: false,
        computerUse: false,
        parallelToolCalls: true,
      },
      async *stream(): AsyncIterable<EngineEvent> {
        streamCalls += 1;
        if (streamCalls === 1) {
          yield {
            type: "tool-input-start",
            id: "tool-create",
            name: "create-document",
          };
          yield {
            type: "tool-input-delta",
            id: "tool-create",
            text: '{"title"',
          };
          yield {
            type: "assistant-content",
            parts: [
              {
                type: "tool-call" as const,
                id: "tool-create",
                name: "create-document",
                input: { title: "New doc" },
              },
            ],
          };
          yield { type: "stop", reason: "tool_use" };
          return;
        }
        yield { type: "text-delta", text: "done" };
        yield {
          type: "assistant-content",
          parts: [{ type: "text" as const, text: "done" }],
        };
        yield { type: "stop", reason: "end_turn" };
      },
    };
    const events: any[] = [];

    await runAgentLoop({
      engine,
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
      actions: {
        "create-document": actionEntry({ readOnly: false }),
      },
      send: (event) => events.push(event),
      signal: new AbortController().signal,
    });

    expect(events).toContainEqual({
      type: "activity",
      label: "Preparing create-document action",
      tool: "create-document",
    });
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool_start",
        tool: "create-document",
      }),
    );
  });

  it("serializes tool calls when a turn includes mutating actions", async () => {
    let streamCalls = 0;
    const engine: AgentEngine = {
      name: "test",
      label: "Test",
      defaultModel: "test-model",
      supportedModels: ["test-model"],
      capabilities: {
        thinking: false,
        promptCaching: false,
        vision: false,
        computerUse: false,
        parallelToolCalls: true,
      },
      async *stream(): AsyncIterable<EngineEvent> {
        streamCalls += 1;
        if (streamCalls === 1) {
          const parts = [
            {
              type: "tool-call" as const,
              id: "tool-a",
              name: "write-a",
              input: {},
            },
            {
              type: "tool-call" as const,
              id: "tool-b",
              name: "write-b",
              input: {},
            },
          ];
          yield { type: "assistant-content", parts };
          yield { type: "stop", reason: "tool_use" };
          return;
        }
        yield {
          type: "assistant-content",
          parts: [{ type: "text" as const, text: "done" }],
        };
        yield { type: "stop", reason: "end_turn" };
      },
    };
    const order: string[] = [];

    await runAgentLoop({
      engine,
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
      actions: {
        "write-a": {
          ...actionEntry({ readOnly: false }),
          run: async () => {
            order.push("a:start");
            await new Promise((resolve) => setTimeout(resolve, 10));
            order.push("a:end");
            return "a";
          },
        },
        "write-b": {
          ...actionEntry({ readOnly: false }),
          run: async () => {
            order.push("b:start");
            order.push("b:end");
            return "b";
          },
        },
      },
      send: () => {},
      signal: new AbortController().signal,
    });

    expect(order).toEqual(["a:start", "a:end", "b:start", "b:end"]);
  });

  it("runs parallel-safe mutating tool calls concurrently", async () => {
    let streamCalls = 0;
    const engine: AgentEngine = {
      name: "test",
      label: "Test",
      defaultModel: "test-model",
      supportedModels: ["test-model"],
      capabilities: {
        thinking: false,
        promptCaching: false,
        vision: false,
        computerUse: false,
        parallelToolCalls: true,
      },
      async *stream(): AsyncIterable<EngineEvent> {
        streamCalls += 1;
        if (streamCalls === 1) {
          yield {
            type: "assistant-content",
            parts: [
              {
                type: "tool-call" as const,
                id: "tool-a",
                name: "write-a",
                input: {},
              },
              {
                type: "tool-call" as const,
                id: "tool-b",
                name: "write-b",
                input: {},
              },
            ],
          };
          yield { type: "stop", reason: "tool_use" };
          return;
        }
        yield {
          type: "assistant-content",
          parts: [{ type: "text" as const, text: "done" }],
        };
        yield { type: "stop", reason: "end_turn" };
      },
    };
    let active = 0;
    let maxActive = 0;
    const run = async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      return "ok";
    };

    await runAgentLoop({
      engine,
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
      actions: {
        "write-a": {
          ...actionEntry({ readOnly: false, parallelSafe: true }),
          run,
        },
        "write-b": {
          ...actionEntry({ readOnly: false, parallelSafe: true }),
          run,
        },
      },
      send: () => {},
      signal: new AbortController().signal,
    });

    expect(maxActive).toBe(2);
  });

  it("does not re-run identical read-only tools already present in continuation history", async () => {
    let streamCalls = 0;
    const engine: AgentEngine = {
      name: "test",
      label: "Test",
      defaultModel: "test-model",
      supportedModels: ["test-model"],
      capabilities: {
        thinking: false,
        promptCaching: false,
        vision: false,
        computerUse: false,
        parallelToolCalls: true,
      },
      async *stream(): AsyncIterable<EngineEvent> {
        streamCalls += 1;
        if (streamCalls === 1) {
          yield {
            type: "assistant-content",
            parts: [
              {
                type: "tool-call" as const,
                id: "tool-repeat",
                name: "get-document",
                input: { id: "doc-1" },
              },
            ],
          };
          yield { type: "stop", reason: "tool_use" };
          return;
        }
        yield { type: "text-delta", text: "answered from history" };
        yield {
          type: "assistant-content",
          parts: [{ type: "text" as const, text: "answered from history" }],
        };
        yield { type: "stop", reason: "end_turn" };
      },
    };
    const readAction = vi.fn(async () => "fresh document");
    const events: any[] = [];

    await runAgentLoop({
      engine,
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "summarize this doc" }],
        },
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              id: "tool-original",
              name: "get-document",
              input: { id: "doc-1" },
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "tool-result",
              toolCallId: "tool-original",
              toolName: "get-document",
              content: '{"id":"doc-1","title":"Offsite rambles"}',
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `${AGENT_INTERNAL_CONTINUE_PROMPT}\n\nInternal note: retry`,
            },
          ],
        },
      ],
      actions: {
        "get-document": {
          ...actionEntry({ readOnly: true }),
          run: readAction,
        },
      },
      send: (event) => events.push(event),
      signal: new AbortController().signal,
    });

    expect(readAction).not.toHaveBeenCalled();
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool_done",
        tool: "get-document",
        result: expect.stringContaining("Skipped duplicate read-only call"),
      }),
    );
    expect(events).toContainEqual({
      type: "text",
      text: "answered from history",
    });
  });

  it("still runs identical read-only tools on a fresh user turn", async () => {
    let streamCalls = 0;
    const engine: AgentEngine = {
      name: "test",
      label: "Test",
      defaultModel: "test-model",
      supportedModels: ["test-model"],
      capabilities: {
        thinking: false,
        promptCaching: false,
        vision: false,
        computerUse: false,
        parallelToolCalls: true,
      },
      async *stream(): AsyncIterable<EngineEvent> {
        streamCalls += 1;
        if (streamCalls > 1) {
          yield {
            type: "assistant-content",
            parts: [{ type: "text" as const, text: "fresh answer" }],
          };
          yield { type: "stop", reason: "end_turn" };
          return;
        }
        yield {
          type: "assistant-content",
          parts: [
            {
              type: "tool-call" as const,
              id: "tool-repeat",
              name: "get-document",
              input: { id: "doc-1" },
            },
          ],
        };
        yield { type: "stop", reason: "tool_use" };
      },
    };
    const readAction = vi.fn(async () => "fresh document");

    await runAgentLoop({
      engine,
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              id: "tool-original",
              name: "get-document",
              input: { id: "doc-1" },
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "tool-result",
              toolCallId: "tool-original",
              toolName: "get-document",
              content: "old result",
            },
          ],
        },
        {
          role: "user",
          content: [{ type: "text", text: "read it again" }],
        },
      ],
      actions: {
        "get-document": {
          ...actionEntry({ readOnly: true }),
          run: readAction,
        },
      },
      send: () => {},
      signal: new AbortController().signal,
    });

    expect(readAction).toHaveBeenCalledTimes(1);
  });

  it("exposes completed tool results on the active request run context", async () => {
    let streamCalls = 0;
    const engine: AgentEngine = {
      name: "test",
      label: "Test",
      defaultModel: "test-model",
      supportedModels: ["test-model"],
      capabilities: {
        thinking: false,
        promptCaching: false,
        vision: false,
        computerUse: false,
        parallelToolCalls: false,
      },
      async *stream(): AsyncIterable<EngineEvent> {
        streamCalls += 1;
        if (streamCalls === 1) {
          yield {
            type: "assistant-content",
            parts: [
              {
                type: "tool-call" as const,
                id: "query-1",
                name: "query-data",
                input: {},
              },
              {
                type: "tool-call" as const,
                id: "save-1",
                name: "save-analysis",
                input: {},
              },
            ],
          };
          yield { type: "stop", reason: "tool_use" };
          return;
        }
        yield {
          type: "assistant-content",
          parts: [{ type: "text" as const, text: "done" }],
        };
        yield { type: "stop", reason: "end_turn" };
      },
    };
    let saveSawQueryResult = false;

    await runWithRequestContext({ userEmail: "a@example.com", run: {} }, () =>
      runAgentLoop({
        engine,
        model: "test-model",
        systemPrompt: "system",
        tools: [],
        messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
        actions: {
          "query-data": {
            ...actionEntry({ readOnly: true }),
            run: async () => ({ rows: [{ count: 3 }] }),
          },
          "save-analysis": {
            ...actionEntry({ readOnly: false }),
            run: async () => {
              saveSawQueryResult =
                getRequestRunContext()?.toolResults?.some(
                  (result) => result.name === "query-data",
                ) === true;
              return "saved";
            },
          },
        },
        send: () => {},
        signal: new AbortController().signal,
      }),
    );

    expect(saveSawQueryResult).toBe(true);
  });

  it("keeps reads ordered around parallel-safe mutating batches", async () => {
    let streamCalls = 0;
    const engine: AgentEngine = {
      name: "test",
      label: "Test",
      defaultModel: "test-model",
      supportedModels: ["test-model"],
      capabilities: {
        thinking: false,
        promptCaching: false,
        vision: false,
        computerUse: false,
        parallelToolCalls: true,
      },
      async *stream(): AsyncIterable<EngineEvent> {
        streamCalls += 1;
        if (streamCalls === 1) {
          yield {
            type: "assistant-content",
            parts: [
              {
                type: "tool-call" as const,
                id: "tool-a",
                name: "write-a",
                input: {},
              },
              {
                type: "tool-call" as const,
                id: "tool-read",
                name: "read-state",
                input: {},
              },
              {
                type: "tool-call" as const,
                id: "tool-b",
                name: "write-b",
                input: {},
              },
            ],
          };
          yield { type: "stop", reason: "tool_use" };
          return;
        }
        yield {
          type: "assistant-content",
          parts: [{ type: "text" as const, text: "done" }],
        };
        yield { type: "stop", reason: "end_turn" };
      },
    };
    const order: string[] = [];

    await runAgentLoop({
      engine,
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
      actions: {
        "write-a": {
          ...actionEntry({ readOnly: false, parallelSafe: true }),
          run: async () => {
            order.push("a:start");
            await new Promise((resolve) => setTimeout(resolve, 10));
            order.push("a:end");
            return "a";
          },
        },
        "read-state": {
          ...actionEntry({ readOnly: true }),
          run: async () => {
            order.push("read:start");
            order.push("read:end");
            return "read";
          },
        },
        "write-b": {
          ...actionEntry({ readOnly: false, parallelSafe: true }),
          run: async () => {
            order.push("b:start");
            order.push("b:end");
            return "b";
          },
        },
      },
      send: () => {},
      signal: new AbortController().signal,
    });

    expect(order).toEqual([
      "a:start",
      "a:end",
      "read:start",
      "read:end",
      "b:start",
      "b:end",
    ]);
  });

  it("continues internally when the configured iteration chunk is exhausted", async () => {
    let streamCalls = 0;
    const seenMessages: any[] = [];
    const engine: AgentEngine = {
      name: "test",
      label: "Test",
      defaultModel: "test-model",
      supportedModels: ["test-model"],
      capabilities: {
        thinking: false,
        promptCaching: false,
        vision: false,
        computerUse: false,
        parallelToolCalls: false,
      },
      async *stream(opts): AsyncIterable<EngineEvent> {
        streamCalls += 1;
        seenMessages.push(opts.messages);
        if (streamCalls === 3) {
          yield { type: "text-delta", text: "finished" };
          yield {
            type: "assistant-content",
            parts: [{ type: "text", text: "finished" }],
          };
          yield { type: "stop", reason: "end_turn" };
          return;
        }
        const parts = [
          {
            type: "tool-call" as const,
            id: `tool-${streamCalls}`,
            name: "noop",
            input: {},
          },
        ];
        yield {
          type: "tool-call",
          id: `tool-${streamCalls}`,
          name: "noop",
          input: {},
        };
        yield { type: "assistant-content", parts };
        yield { type: "stop", reason: "tool_use" };
      },
    };
    const events: any[] = [];

    await runAgentLoop({
      engine,
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
      actions: { noop: actionEntry({ readOnly: true }) },
      send: (event) => events.push(event),
      signal: new AbortController().signal,
      maxIterations: 2,
    });

    expect(streamCalls).toBe(3);
    expect(events).not.toContainEqual(
      expect.objectContaining({ type: "loop_limit" }),
    );
    expect(JSON.stringify(seenMessages.at(-1))).toContain(
      "Continue from where you left off",
    );
    expect(events).toContainEqual({ type: "text", text: "finished" });
    expect(events.at(-1)).toEqual({ type: "done" });
  });

  it("stops the turn when an action throws AgentActionStopError", async () => {
    let streamCalls = 0;
    const engine: AgentEngine = {
      name: "test",
      label: "Test",
      defaultModel: "test-model",
      supportedModels: ["test-model"],
      capabilities: {
        thinking: false,
        promptCaching: false,
        vision: false,
        computerUse: false,
        parallelToolCalls: false,
      },
      async *stream(): AsyncIterable<EngineEvent> {
        streamCalls += 1;
        yield {
          type: "assistant-content",
          parts: [
            {
              type: "tool-call" as const,
              id: "query-1",
              name: "bigquery",
              input: { sql: "select nope" },
            },
          ],
        };
        yield { type: "stop", reason: "tool_use" };
      },
    };
    const events: any[] = [];

    await runAgentLoop({
      engine,
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
      actions: {
        bigquery: {
          ...actionEntry({ readOnly: true }),
          run: async () => {
            throw new AgentActionStopError("BigQuery returned: nope", {
              errorCode: "bigquery_query_failed",
              toolResult: JSON.stringify({
                error: "bigquery_query_failed",
                message: "nope",
              }),
            });
          },
        },
      },
      send: (event) => events.push(event),
      signal: new AbortController().signal,
    });

    expect(streamCalls).toBe(1);
    expect(events).toEqual([
      { type: "tool_start", tool: "bigquery", input: { sql: "select nope" } },
      {
        type: "tool_done",
        tool: "bigquery",
        result: JSON.stringify({
          error: "bigquery_query_failed",
          message: "nope",
        }),
      },
      { type: "text", text: "BigQuery returned: nope" },
      { type: "done" },
    ]);
  });

  it("returns tool input schema failures to the model instead of ending the run", async () => {
    let streamCalls = 0;
    const seenMessages: any[] = [];
    const engine: AgentEngine = {
      name: "test",
      label: "Test",
      defaultModel: "test-model",
      supportedModels: ["test-model"],
      capabilities: {
        thinking: false,
        promptCaching: false,
        vision: false,
        computerUse: false,
        parallelToolCalls: false,
      },
      async *stream(opts): AsyncIterable<EngineEvent> {
        streamCalls += 1;
        seenMessages.push(structuredClone(opts.messages));
        if (streamCalls === 1) {
          yield {
            type: "tool-call-error",
            id: "bad-call",
            name: "add-slide",
            input: { deckId: "deck-1", content: "<div></div>", position: "x" },
            error: "position must be a number",
          };
          yield { type: "assistant-content", parts: [] };
          yield { type: "stop", reason: "tool_use" };
          return;
        }

        yield { type: "text-delta", text: "I fixed the arguments." };
        yield {
          type: "assistant-content",
          parts: [{ type: "text" as const, text: "I fixed the arguments." }],
        };
        yield { type: "stop", reason: "end_turn" };
      },
    };
    const events: any[] = [];
    const run = vi.fn(async () => "should not execute");

    await runAgentLoop({
      engine,
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
      actions: {
        "add-slide": {
          ...actionEntry({ readOnly: false }),
          run,
        },
      },
      send: (event) => events.push(event),
      signal: new AbortController().signal,
    });

    expect(run).not.toHaveBeenCalled();
    expect(streamCalls).toBe(2);
    expect(events).toContainEqual({
      type: "tool_start",
      tool: "add-slide",
      input: { deckId: "deck-1", content: "<div></div>", position: "x" },
    });
    const toolDone = events.find(
      (event) => event.type === "tool_done" && event.tool === "add-slide",
    );
    expect(toolDone?.result).toContain("Invalid action parameters");
    expect(toolDone?.result).toContain("position must be a number");
    expect(events).toContainEqual({
      type: "text",
      text: "I fixed the arguments.",
    });
    expect(events.at(-1)).toEqual({ type: "done" });

    const secondCallMessages = seenMessages[1];
    expect(secondCallMessages.at(-2)).toMatchObject({
      role: "assistant",
      content: [
        {
          type: "tool-call",
          id: "bad-call",
          name: "add-slide",
        },
      ],
    });
    expect(secondCallMessages.at(-1)).toMatchObject({
      role: "user",
      content: [
        {
          type: "tool-result",
          toolCallId: "bad-call",
          toolName: "add-slide",
          isError: true,
        },
      ],
    });
  });

  it("lets a final-response guard force one corrective retry before finishing", async () => {
    let streamCalls = 0;
    const seenMessages: any[] = [];
    const engine: AgentEngine = {
      name: "test",
      label: "Test",
      defaultModel: "test-model",
      supportedModels: ["test-model"],
      capabilities: {
        thinking: false,
        promptCaching: false,
        vision: false,
        computerUse: false,
        parallelToolCalls: false,
      },
      async *stream(opts): AsyncIterable<EngineEvent> {
        streamCalls += 1;
        seenMessages.push(structuredClone(opts.messages));
        if (streamCalls === 1) {
          yield { type: "text-delta", text: "Looks up and to the right." };
          yield {
            type: "assistant-content",
            parts: [
              { type: "text" as const, text: "Looks up and to the right." },
            ],
          };
          yield { type: "stop", reason: "end_turn" };
          return;
        }
        if (streamCalls === 2) {
          yield {
            type: "assistant-content",
            parts: [
              {
                type: "tool-call" as const,
                id: "query-1",
                name: "query-data",
                input: { sql: "select count(*)" },
              },
            ],
          };
          yield { type: "stop", reason: "tool_use" };
          return;
        }
        yield { type: "text-delta", text: "The real count is 3." };
        yield {
          type: "assistant-content",
          parts: [{ type: "text" as const, text: "The real count is 3." }],
        };
        yield { type: "stop", reason: "end_turn" };
      },
    };
    const events: any[] = [];
    const guard = vi.fn((ctx: AgentLoopFinalResponseGuardContext) => {
      const hasQuery = ctx.toolResults.some((r) => r.name === "query-data");
      return hasQuery
        ? null
        : "This answer needs a real data-source query before it can be final.";
    });

    await runAgentLoop({
      engine,
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
      actions: {
        "query-data": {
          ...actionEntry({ readOnly: true }),
          run: async () => ({ rows: [{ count: 3 }] }),
        },
      },
      send: (event) => events.push(event),
      signal: new AbortController().signal,
      finalResponseGuard: guard,
    });

    expect(streamCalls).toBe(3);
    expect(guard).toHaveBeenCalledTimes(2);
    expect(events).toContainEqual({ type: "clear" });
    expect(events).toContainEqual({
      type: "tool_start",
      tool: "query-data",
      input: { sql: "select count(*)" },
    });
    expect(events).toContainEqual({
      type: "text",
      text: "The real count is 3.",
    });
    expect(events.at(-1)).toEqual({ type: "done" });
    expect(JSON.stringify(seenMessages[1])).toContain(
      "This answer needs a real data-source query",
    );
  });

  it("uses the final-response guard fallback after one failed corrective retry", async () => {
    let streamCalls = 0;
    const engine: AgentEngine = {
      name: "test",
      label: "Test",
      defaultModel: "test-model",
      supportedModels: ["test-model"],
      capabilities: {
        thinking: false,
        promptCaching: false,
        vision: false,
        computerUse: false,
        parallelToolCalls: false,
      },
      async *stream(): AsyncIterable<EngineEvent> {
        streamCalls += 1;
        const text = streamCalls === 1 ? "fake answer" : "still fake";
        yield { type: "text-delta", text };
        yield {
          type: "assistant-content",
          parts: [{ type: "text" as const, text }],
        };
        yield { type: "stop", reason: "end_turn" };
      },
    };
    const events: any[] = [];

    await runAgentLoop({
      engine,
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
      actions: {},
      send: (event) => events.push(event),
      signal: new AbortController().signal,
      finalResponseGuard: () => ({
        retryMessage: "Query a real source before answering.",
        fallbackMessage: "I stopped because no real data-source query ran.",
      }),
    });

    expect(streamCalls).toBe(2);
    expect(events.filter((event) => event.type === "clear")).toHaveLength(2);
    expect(events).toContainEqual({
      type: "text",
      text: "I stopped because no real data-source query ran.",
    });
    expect(events.at(-1)).toEqual({ type: "done" });
  });

  it("does not retry Builder gateway timeouts inside one serverless run", async () => {
    let streamCalls = 0;
    const engine: AgentEngine = {
      name: "test",
      label: "Test",
      defaultModel: "test-model",
      supportedModels: ["test-model"],
      capabilities: {
        thinking: false,
        promptCaching: false,
        vision: false,
        computerUse: false,
        parallelToolCalls: false,
      },
      async *stream(): AsyncIterable<EngineEvent> {
        streamCalls += 1;
        yield {
          type: "stop",
          reason: "error",
          error: "Builder gateway timed out after 45s",
          errorCode: "builder_gateway_timeout",
        };
      },
    };

    await expect(
      runAgentLoop({
        engine,
        model: "test-model",
        systemPrompt: "system",
        tools: [],
        messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
        actions: {},
        send: () => {},
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow("Builder gateway timed out after 45s");

    expect(streamCalls).toBe(1);
  });
});
