import { describe, expect, it, vi } from "vitest";
import { attachToolSearch } from "./tool-search.js";
import {
  AGENT_INTERNAL_CONTINUE_PROMPT,
  buildUserContentWithAttachments,
  createPlanModeActionRegistry,
  isPlanModeToolCallAllowed,
  isContextTooLongError,
  isRetryableError,
  resolveAgentOwnerEmail,
  runAgentLoop,
  shouldGuardRepeatedSourceSweep,
  structuredHistoryToEngineMessages,
  trimOldToolResults,
  type ActionEntry,
  type AgentLoopFinalResponseGuardContext,
} from "./production-agent.js";
import { AgentActionStopError } from "../action.js";
import {
  getRequestRunContext,
  runWithRequestContext,
} from "../server/request-context.js";
import type { AgentEngine, EngineEvent } from "./engine/types.js";
import { EngineError } from "./engine/types.js";
import { MCP_ACTION_RESULT_MARKER } from "../mcp-client/app-result.js";

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

  it("injects a text placeholder for unsupported image media types instead of silently dropping them", () => {
    const result = buildUserContentWithAttachments({
      text: "Can you read this SVG?",
      attachments: [
        {
          type: "image",
          name: "icon.svg",
          contentType: "image/svg+xml",
          data: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
        },
      ],
    });
    // Should be a single text part that contains both the placeholder and the user prompt
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("text");
    const text = (result[0] as { type: "text"; text: string }).text;
    expect(text).toContain('"icon.svg"');
    expect(text).toContain("image/svg+xml");
    expect(text).toContain("unsupported image format");
    expect(text).toContain("Can you read this SVG?");
  });

  it("injects a placeholder for HEIC images (common iPhone format)", () => {
    const result = buildUserContentWithAttachments({
      text: "Here is my photo",
      attachments: [
        {
          type: "image",
          name: "photo.heic",
          contentType: "image/heic",
          data: "data:image/heic;base64,abc123",
        },
      ],
    });
    expect(result).toHaveLength(1);
    const text = (result[0] as { type: "text"; text: string }).text;
    expect(text).toContain("image/heic");
    expect(text).toContain("unsupported image format");
  });

  it("preserves orphan tool-results as text so history is not lost before backfill", () => {
    // No assistant tool-call ever exists for `t1`. Emitting a synthetic
    // `tool-result` would be stripped later anyway; converting to text keeps
    // the payload visible and lets `backfillEngineMessagesToolResults` run on
    // the full engine message list consistently.
    expect(
      structuredHistoryToEngineMessages([
        {
          role: "user",
          content: [
            {
              type: "tool-result",
              toolCallId: "t1",
              content: "stale tool output",
            },
          ],
        },
      ]),
    ).toEqual([
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "(Omitted unmatched tool results from replayed history.) [tool_use_id=t1] stale tool output",
          },
        ],
      },
    ]);
  });

  it("appends a text note when a sibling tool-result is orphaned", () => {
    expect(
      structuredHistoryToEngineMessages([
        {
          role: "user",
          content: [
            { type: "text", text: "Here's some context." },
            {
              type: "tool-result",
              toolCallId: "ghost",
              content: "stale",
            },
          ],
        },
      ]),
    ).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "Here's some context." },
          {
            type: "text",
            text: "(Omitted unmatched tool results from replayed history.) [tool_use_id=ghost] stale",
          },
        ],
      },
    ]);
  });

  it("coerces non-string tool_result fields from older DB JSON", () => {
    expect(
      structuredHistoryToEngineMessages([
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "99",
              toolName: "search",
              args: { q: "x" },
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "tool-result",
              toolCallId: 99 as any,
              toolName: "search",
              content: { hits: 3 } as any,
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
            id: "99",
            name: "search",
            input: { q: "x" },
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool-result",
            toolCallId: "99",
            toolName: "search",
            toolInput: '{"q":"x"}',
            content: '{"hits":3}',
          },
        ],
      },
    ]);
  });

  it("synthesizes interrupted results for replayed tool calls without results", () => {
    expect(
      structuredHistoryToEngineMessages([
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "history_tc_1",
              toolName: "chat-history",
              args: { action: "search" },
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
            id: "history_tc_1",
            name: "chat-history",
            input: { action: "search" },
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool-result",
            toolCallId: "history_tc_1",
            toolName: "chat-history",
            toolInput: '{"action":"search"}',
            content: "Interrupted before this tool returned a result.",
          },
        ],
      },
    ]);
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
              toolInput: '{"id":"doc-1"}',
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
            toolInput: '{"id":"doc-1"}',
            content: '{"title":"Offsite rambles"}',
          },
        ],
      },
    ]);
  });

  it("builds a plan-mode registry with only read-only tools", async () => {
    const registry = attachToolSearch({
      read: actionEntry({ readOnly: true }),
      write: actionEntry({ readOnly: false }),
      bash: actionEntry({ readOnly: false }),
      "set-url-path": actionEntry({ readOnly: true }),
      resources: actionEntry({
        actions: ["list", "read", "write", "delete"],
      }),
    });

    const planRegistry = createPlanModeActionRegistry(registry);

    expect(Object.keys(planRegistry).sort()).toEqual([
      "bash",
      "read",
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
    await expect(
      planRegistry.bash.run({ command: "rg button src" }),
    ).resolves.toContain('"command":"rg button src"');
    await expect(
      planRegistry.bash.run({ command: "echo hi > notes.txt" }),
    ).resolves.toContain("Plan mode blocked");
    await expect(
      planRegistry.bash.run({ command: "rg button; node -e '1'" }),
    ).resolves.toContain("Plan mode blocked");

    const searchResult = await planRegistry["tool-search"].run({
      query: "write file",
    } as any);
    expect(searchResult.results.map((tool: any) => tool.name)).not.toContain(
      "write",
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

    const bashTool = actionEntry({ readOnly: false });
    expect(
      isPlanModeToolCallAllowed("bash", { command: "rg button src" }, bashTool),
    ).toBe(true);
    expect(
      isPlanModeToolCallAllowed(
        "bash",
        { command: "echo hi > notes.txt" },
        bashTool,
      ),
    ).toBe(false);
    expect(
      isPlanModeToolCallAllowed(
        "bash",
        { command: "rg button; node -e '1'" },
        bashTool,
      ),
    ).toBe(false);
  });
});

describe("resolveAgentOwnerEmail", () => {
  it("uses the explicit owner resolver when provided", async () => {
    const owner = await runWithRequestContext(
      { userEmail: "context@example.com", run: {} },
      () =>
        resolveAgentOwnerEmail(
          { resolveOwnerEmail: async () => "resolved@example.com" },
          {},
        ),
    );

    expect(owner).toBe("resolved@example.com");
  });

  it("falls back to the request context owner", async () => {
    const owner = await runWithRequestContext(
      { userEmail: "context@example.com", run: {} },
      () => resolveAgentOwnerEmail({}, {}),
    );

    expect(owner).toBe("context@example.com");
  });
});

describe("runAgentLoop", () => {
  it("passes the central default max output token cap to the engine", async () => {
    let seenMaxOutputTokens: number | undefined;
    const engine: AgentEngine = {
      name: "ai-sdk:openrouter",
      label: "OpenRouter",
      defaultModel: "openai/gpt-5.5",
      supportedModels: ["openai/gpt-5.5"],
      capabilities: {
        thinking: true,
        promptCaching: true,
        vision: true,
        computerUse: false,
        parallelToolCalls: true,
      },
      async *stream(opts): AsyncIterable<EngineEvent> {
        seenMaxOutputTokens = opts.maxOutputTokens;
        yield { type: "text-delta", text: "done" };
        yield {
          type: "assistant-content",
          parts: [{ type: "text" as const, text: "done" }],
        };
        yield { type: "stop", reason: "end_turn" };
      },
    };

    await runAgentLoop({
      engine,
      model: "openai/gpt-5.5",
      systemPrompt: "system",
      tools: [],
      messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
      actions: {},
      send: () => {},
      signal: new AbortController().signal,
    });

    // OpenRouter default was raised from 1024 to 8192 to avoid truncation.
    expect(seenMaxOutputTokens).toBe(8192);
  });

  it("continues internally when a response reaches the output token cap", async () => {
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
        seenMessages.push(JSON.stringify(opts.messages));
        if (streamCalls === 1) {
          yield { type: "text-delta", text: "partial " };
          yield {
            type: "assistant-content",
            parts: [{ type: "text" as const, text: "partial " }],
          };
          yield { type: "stop", reason: "max_tokens" };
          return;
        }
        yield { type: "text-delta", text: "finish" };
        yield {
          type: "assistant-content",
          parts: [{ type: "text" as const, text: "finish" }],
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
    });

    expect(streamCalls).toBe(2);
    expect(seenMessages.at(-1)).toContain("output-token cap");
    expect(events).toContainEqual({ type: "text", text: "partial " });
    expect(events).toContainEqual({ type: "text", text: "finish" });
    expect(events.at(-1)).toEqual({ type: "done" });
  });

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
              toolInput: '{"id":"doc-1"}',
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

  it("adds stop-and-report guidance to provider rate-limit tool errors", async () => {
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
                id: "tool-rate-limit",
                name: "provider-api-request",
                input: {},
              },
            ],
          };
          yield { type: "stop", reason: "tool_use" };
          return;
        }
        yield { type: "text-delta", text: "reported the gap" };
        yield {
          type: "assistant-content",
          parts: [{ type: "text" as const, text: "reported the gap" }],
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
        "provider-api-request": {
          ...actionEntry({ readOnly: true }),
          run: async () => {
            throw new Error("Provider request failed (429): quota exceeded");
          },
        },
      },
      send: (event) => events.push(event),
      signal: new AbortController().signal,
    });

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool_done",
        tool: "provider-api-request",
        result: expect.stringContaining(
          "Provider rate-limit guidance: stop retrying this provider",
        ),
      }),
    );
    expect(events).toContainEqual({ type: "text", text: "reported the gap" });
  });

  it("detects repeated read-only source sweeps but ignores ordinary helpers", () => {
    const priorToolCalls = Array.from({ length: 12 }, (_, i) => ({
      name: "gong-calls",
      input: { company: `Account ${i + 1}` },
    }));

    expect(
      shouldGuardRepeatedSourceSweep({
        toolName: "gong-calls",
        entry: actionEntry({ readOnly: true }),
        priorToolCalls,
      }),
    ).toMatchObject({
      toolName: "gong-calls",
      priorCalls: 12,
      message: expect.stringContaining("change strategy"),
    });

    expect(
      shouldGuardRepeatedSourceSweep({
        toolName: "hubspot-records",
        entry: actionEntry({}),
        priorToolCalls: priorToolCalls.map((call) => ({
          ...call,
          name: "hubspot-records",
        })),
      }),
    ).toMatchObject({
      toolName: "hubspot-records",
      priorCalls: 12,
    });

    expect(
      shouldGuardRepeatedSourceSweep({
        toolName: "read-attachment",
        entry: actionEntry({ readOnly: true }),
        priorToolCalls: priorToolCalls.map((call) => ({
          ...call,
          name: "read-attachment",
        })),
      }),
    ).toBeNull();

    expect(
      shouldGuardRepeatedSourceSweep({
        toolName: "search-records",
        entry: actionEntry({ readOnly: false }),
        priorToolCalls: priorToolCalls.map((call) => ({
          ...call,
          name: "search-records",
        })),
      }),
    ).toBeNull();
  });

  it("allows a bulk strategy change instead of continuing a repeated source sweep", async () => {
    let streamCalls = 0;
    const seenMessages: unknown[] = [];
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
      async *stream(opts): AsyncIterable<EngineEvent> {
        streamCalls += 1;
        seenMessages.push(opts.messages);
        const serializedMessages = JSON.stringify(opts.messages);
        if (serializedMessages.includes("bulk coverage complete")) {
          yield {
            type: "text-delta",
            text: "Bulk coverage complete.",
          };
          yield {
            type: "assistant-content",
            parts: [
              {
                type: "text" as const,
                text: "Bulk coverage complete.",
              },
            ],
          };
          yield { type: "stop", reason: "end_turn" };
          return;
        }
        if (serializedMessages.includes("Skipped agent-teams spawn")) {
          yield {
            type: "assistant-content",
            parts: [
              {
                type: "tool-call" as const,
                id: "bulk-code",
                name: "run-code",
                input: { script: "bulk corpus search" },
              },
            ],
          };
          yield { type: "stop", reason: "tool_use" };
          return;
        }
        if (serializedMessages.includes("convergence budget")) {
          yield {
            type: "assistant-content",
            parts: [
              {
                type: "tool-call" as const,
                id: "delegate-sweep",
                name: "agent-teams",
                input: {
                  action: "spawn",
                  task: "Scan Gong call transcripts for Figma MCP across the closed-won Fusion account cohort",
                },
              },
            ],
          };
          yield { type: "stop", reason: "tool_use" };
          return;
        }
        yield {
          type: "assistant-content",
          parts: [
            {
              type: "tool-call" as const,
              id: `gong-${streamCalls}`,
              name: "gong-calls",
              input: { company: `Account ${streamCalls}` },
            },
          ],
        };
        yield { type: "stop", reason: "tool_use" };
      },
    };
    const gongCalls = vi.fn(async (args) => ({
      company: args.company,
      transcriptSearch: { matchingCalls: 0, inspectedCalls: 5 },
    }));
    const runCode = vi.fn(async () => "bulk coverage complete");
    const agentTeams = vi.fn(async () => "spawned");
    const events: any[] = [];

    await runAgentLoop({
      engine,
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "scan this provider cohort" }],
        },
      ],
      actions: {
        "gong-calls": {
          ...actionEntry({ readOnly: true }),
          run: gongCalls,
        },
        "run-code": {
          ...actionEntry({ readOnly: true }),
          run: runCode,
        },
        "agent-teams": {
          ...actionEntry({
            actions: ["spawn", "status", "read-result", "send", "list"],
          }),
          run: agentTeams,
        },
      },
      send: (event) => events.push(event),
      signal: new AbortController().signal,
    });

    expect(gongCalls).toHaveBeenCalledTimes(12);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool_done",
        tool: "gong-calls",
        result: expect.stringContaining("convergence budget"),
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool_done",
        tool: "agent-teams",
        result: expect.stringContaining("Skipped agent-teams spawn"),
      }),
    );
    expect(agentTeams).not.toHaveBeenCalled();
    expect(runCode).toHaveBeenCalledTimes(1);
    expect(events).toContainEqual({
      type: "text",
      text: "Bulk coverage complete.",
    });
    expect(JSON.stringify(seenMessages.at(-1))).toContain("change strategy");
    expect(JSON.stringify(seenMessages.at(-1))).toContain("Do not delegate");
  });

  it("counts repeated source sweeps from internal continuation history", async () => {
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
      async *stream(opts): AsyncIterable<EngineEvent> {
        streamCalls += 1;
        const serializedMessages = JSON.stringify(opts.messages);
        if (serializedMessages.includes("convergence budget")) {
          yield {
            type: "text-delta",
            text: "summarized coverage",
          };
          yield {
            type: "assistant-content",
            parts: [{ type: "text" as const, text: "summarized coverage" }],
          };
          yield { type: "stop", reason: "end_turn" };
          return;
        }
        yield {
          type: "assistant-content",
          parts: [
            {
              type: "tool-call" as const,
              id: "gong-next",
              name: "gong-calls",
              input: { company: "Next Account" },
            },
          ],
        };
        yield { type: "stop", reason: "tool_use" };
      },
    };
    const gongCalls = vi.fn(async () => "should not run");
    const events: any[] = [];
    const priorToolMessages = Array.from({ length: 12 }, (_, i) => {
      const input = { company: `Account ${i + 1}` };
      const toolCallId = `gong-prior-${i + 1}`;
      return [
        {
          role: "assistant" as const,
          content: [
            {
              type: "tool-call" as const,
              id: toolCallId,
              name: "gong-calls",
              input,
            },
          ],
        },
        {
          role: "user" as const,
          content: [
            {
              type: "tool-result" as const,
              toolCallId,
              toolName: "gong-calls",
              toolInput: JSON.stringify(input),
              content: "no Figma MCP hits",
            },
          ],
        },
      ];
    }).flat();

    await runAgentLoop({
      engine,
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "scan this provider cohort" }],
        },
        ...priorToolMessages,
        {
          role: "user",
          content: [{ type: "text", text: AGENT_INTERNAL_CONTINUE_PROMPT }],
        },
      ],
      actions: {
        "gong-calls": {
          ...actionEntry({ readOnly: true }),
          run: gongCalls,
        },
      },
      send: (event) => events.push(event),
      signal: new AbortController().signal,
    });

    expect(gongCalls).not.toHaveBeenCalled();
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool_done",
        tool: "gong-calls",
        result: expect.stringContaining("convergence budget"),
      }),
    );
    expect(events).toContainEqual({
      type: "text",
      text: "summarized coverage",
    });
    expect(streamCalls).toBe(2);
  });

  it("retries identical read-only tools when the continuation history result was aborted", async () => {
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
        yield {
          type: "assistant-content",
          parts: [{ type: "text" as const, text: "answered after retry" }],
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
              toolInput: '{"id":"doc-1"}',
              content: "Error running get-document: Run aborted",
              isError: true,
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

    expect(readAction).toHaveBeenCalledTimes(1);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool_done",
        tool: "get-document",
        result: "fresh document",
      }),
    );
    expect(events).not.toContainEqual(
      expect.objectContaining({
        type: "tool_done",
        tool: "get-document",
        result: expect.stringContaining("Skipped duplicate read-only call"),
      }),
    );
  });

  it("stops write tool that was interrupted twice in continuation history", async () => {
    let streamCalls = 0;
    const writeAction = vi.fn(async () => ({ ok: true }));
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
        yield {
          type: "assistant-content",
          parts: [
            {
              type: "tool-call" as const,
              id: `write-call-${streamCalls}`,
              name: "save-data",
              input: { content: "big payload" },
            },
          ],
        };
        yield { type: "stop", reason: "tool_use" };
      },
    };
    const events: any[] = [];

    // Simulate a continuation turn where save-data was interrupted twice.
    await runAgentLoop({
      engine,
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "save this data" }],
        },
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              id: "orig-1",
              name: "save-data",
              input: { content: "big payload" },
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "tool-result",
              toolCallId: "orig-1",
              toolName: "save-data",
              toolInput: '{"content":"big payload"}',
              content: "Interrupted before this tool returned a result.",
            },
          ],
        },
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              id: "orig-2",
              name: "save-data",
              input: { content: "big payload" },
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "tool-result",
              toolCallId: "orig-2",
              toolName: "save-data",
              toolInput: '{"content":"big payload"}',
              content: "Interrupted before this tool returned a result.",
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
        "save-data": {
          ...actionEntry({ readOnly: false }),
          run: writeAction,
        },
      },
      send: (event) => events.push(event),
      signal: new AbortController().signal,
    });

    // The write action must NOT run again — the guard should have blocked it.
    expect(writeAction).not.toHaveBeenCalled();
    // A tool_done event with an interruption error should be emitted.
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool_done",
        tool: "save-data",
        result: expect.stringContaining("interrupted 2 time(s)"),
      }),
    );
    // The agent should stop with a helpful message.
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "text",
        text: expect.stringContaining("interrupted 2 time(s)"),
      }),
    );
  });

  it("still runs write tools on first interruption (allows one retry)", async () => {
    const writeAction = vi.fn(async () => ({ ok: true }));
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
        streamCalls++;
        if (streamCalls === 1) {
          yield {
            type: "assistant-content",
            parts: [
              {
                type: "tool-call" as const,
                id: "write-retry",
                name: "save-data",
                input: { content: "small payload" },
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

    await runAgentLoop({
      engine,
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "save this" }],
        },
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              id: "orig-1",
              name: "save-data",
              input: { content: "small payload" },
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "tool-result",
              toolCallId: "orig-1",
              toolName: "save-data",
              toolInput: '{"content":"small payload"}',
              content: "Interrupted before this tool returned a result.",
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
        "save-data": {
          ...actionEntry({ readOnly: false }),
          run: writeAction,
        },
      },
      send: () => {},
      signal: new AbortController().signal,
    });

    // With only 1 prior interruption (below the threshold of 2), the action runs.
    expect(writeAction).toHaveBeenCalledOnce();
  });

  it("passes the turn's attachments into each tool action's run context", async () => {
    // The by-reference fix: an action (e.g. create-extension's
    // contentFromAttachment) reads the pasted/attached file from
    // ctx.attachments instead of forcing the model to re-emit it as a tool
    // argument.
    let receivedAttachments: unknown;
    const writeAction = vi.fn(async (_args: unknown, ctx: any) => {
      receivedAttachments = ctx?.attachments;
      return { ok: true };
    });
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
        streamCalls++;
        if (streamCalls === 1) {
          yield {
            type: "assistant-content",
            parts: [
              {
                type: "tool-call" as const,
                id: "host-1",
                name: "host-paste",
                input: { name: "Pasted", contentFromAttachment: "latest" },
              },
            ],
          };
          yield { type: "stop", reason: "tool_use" };
          return;
        }
        yield {
          type: "assistant-content",
          parts: [{ type: "text" as const, text: "hosted" }],
        };
        yield { type: "stop", reason: "end_turn" };
      },
    };

    const turnAttachments = [
      {
        type: "file",
        name: "pasted-text-1718000000000-ab12cd.txt",
        contentType: "text/plain",
        text: "<div>pasted body</div>",
      },
    ];

    await runAgentLoop({
      engine,
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "host my pasted file" }],
        },
      ],
      actions: {
        "host-paste": {
          ...actionEntry({ readOnly: false }),
          run: writeAction,
        },
      },
      send: () => {},
      signal: new AbortController().signal,
      attachments: turnAttachments as any,
    });

    expect(writeAction).toHaveBeenCalledOnce();
    expect(receivedAttachments).toEqual(turnAttachments);
  });

  it("forwards the run abort signal into each tool action's run context", async () => {
    // P1: ActionRunContext.signal must be populated so well-behaved actions can
    // cancel in-flight work when the run is soft-timed out or user-cancelled.
    let receivedSignal: unknown;
    const writeAction = vi.fn(async (_args: unknown, ctx: any) => {
      receivedSignal = ctx?.signal;
      return "done";
    });
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
        streamCalls++;
        if (streamCalls === 1) {
          yield {
            type: "assistant-content",
            parts: [
              {
                type: "tool-call" as const,
                id: "sig-1",
                name: "do-work",
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

    const runAbort = new AbortController();
    await runAgentLoop({
      engine,
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
      actions: {
        "do-work": {
          ...actionEntry({ readOnly: false }),
          run: writeAction,
        },
      },
      send: () => {},
      signal: runAbort.signal,
    });

    expect(writeAction).toHaveBeenCalledOnce();
    // The signal passed to the action must be the same AbortSignal given to runAgentLoop
    expect(receivedSignal).toBe(runAbort.signal);
    expect(receivedSignal).toBeInstanceOf(AbortSignal);
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
              toolInput: '{"id":"doc-1"}',
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
          toolInput: expect.any(String),
          isError: true,
        },
      ],
    });
  });

  it("marks MCP isError results as errored tool results for the next model turn", async () => {
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
            type: "assistant-content",
            parts: [
              {
                type: "tool-call" as const,
                id: "mcp-call",
                name: "mcp__x__fail",
                input: {},
              },
            ],
          };
          yield { type: "stop", reason: "tool_use" };
          return;
        }

        yield { type: "text-delta", text: "I handled the tool failure." };
        yield {
          type: "assistant-content",
          parts: [
            {
              type: "text" as const,
              text: "I handled the tool failure.",
            },
          ],
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
        mcp__x__fail: {
          ...actionEntry({ readOnly: true }),
          run: async () => ({
            [MCP_ACTION_RESULT_MARKER]: true,
            text: "Error calling MCP tool mcp__x__fail: boom",
            raw: {
              isError: true,
              content: [
                {
                  type: "text",
                  text: "Error calling MCP tool mcp__x__fail: boom",
                },
              ],
            },
            serverId: "x",
            toolName: "mcp__x__fail",
            originalToolName: "fail",
            input: {},
          }),
        },
      },
      send: (event) => events.push(event),
      signal: new AbortController().signal,
    });

    expect(streamCalls).toBe(2);
    expect(events).toContainEqual({
      type: "tool_done",
      tool: "mcp__x__fail",
      result: "Error calling MCP tool mcp__x__fail: boom",
    });
    expect(seenMessages[1].at(-1)).toMatchObject({
      role: "user",
      content: [
        {
          type: "tool-result",
          toolCallId: "mcp-call",
          toolName: "mcp__x__fail",
          content: "Error calling MCP tool mcp__x__fail: boom",
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
    expect(guard.mock.calls.map(([ctx]) => ctx.executionMode)).toEqual([
      "act",
      "act",
    ]);
    expect(events).not.toContainEqual({
      type: "text",
      text: "Looks up and to the right.",
    });
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

  it("passes plan execution mode to final-response guards", async () => {
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
        yield { type: "text-delta", text: "Plan only." };
        yield {
          type: "assistant-content",
          parts: [{ type: "text" as const, text: "Plan only." }],
        };
        yield { type: "stop", reason: "end_turn" };
      },
    };
    const guard = vi.fn(() => null);

    await runAgentLoop({
      engine,
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [{ role: "user", content: [{ type: "text", text: "plan" }] }],
      actions: {},
      send: () => {},
      signal: new AbortController().signal,
      executionMode: "plan",
      finalResponseGuard: guard,
    });

    expect(guard).toHaveBeenCalledTimes(1);
    expect(guard.mock.calls[0]?.[0].executionMode).toBe("plan");
  });

  it("flushes guarded final-answer text after the guard accepts it", async () => {
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
        yield { type: "text-delta", text: "Grounded answer." };
        yield {
          type: "assistant-content",
          parts: [{ type: "text" as const, text: "Grounded answer." }],
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
      finalResponseGuard: () => null,
    });

    expect(events).toContainEqual({
      type: "text",
      text: "Grounded answer.",
    });
    expect(events.at(-1)).toEqual({ type: "done" });
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
    expect(events).not.toContainEqual({ type: "text", text: "fake answer" });
    expect(events).not.toContainEqual({ type: "text", text: "still fake" });
    expect(events).toContainEqual({
      type: "text",
      text: "I stopped because no real data-source query ran.",
    });
    expect(events.at(-1)).toEqual({ type: "done" });
  });

  it("surfaces a fallback message when the engine ends with no text or tool calls", async () => {
    // Mirrors OpenAI Responses gpt-5+ producing reasoning-only content with
    // zero `output_text` items: the engine still emits a clean `end_turn`
    // stop, but parts contains only thinking. Without the fallback the run
    // would render as a silent empty assistant bubble.
    const engine: AgentEngine = {
      name: "test",
      label: "Test",
      defaultModel: "test-model",
      supportedModels: ["test-model"],
      capabilities: {
        thinking: true,
        promptCaching: false,
        vision: false,
        computerUse: false,
        parallelToolCalls: false,
      },
      async *stream(): AsyncIterable<EngineEvent> {
        yield { type: "thinking-delta", text: "thinking out loud..." };
        yield {
          type: "assistant-content",
          parts: [{ type: "thinking" as const, text: "thinking out loud..." }],
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
    });

    const textEvents = events.filter((e) => e.type === "text");
    expect(textEvents).toHaveLength(1);
    expect(textEvents[0].text).toMatch(/empty response/i);
    expect(textEvents[0].text).toMatch(/different model/i);
  });

  it("does not surface the empty-response fallback when text was streamed", async () => {
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
        yield { type: "text-delta", text: "Real answer." };
        yield {
          type: "assistant-content",
          parts: [{ type: "text" as const, text: "Real answer." }],
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
    });

    const textEvents = events.filter((e) => e.type === "text");
    expect(textEvents).toHaveLength(1);
    expect(textEvents[0].text).toBe("Real answer.");
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

  it("retries Builder gateway network errors inside one serverless run", async () => {
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
            type: "stop",
            reason: "error",
            error: "Builder gateway network error: socket hang up",
            errorCode: "builder_gateway_network_error",
          };
          return;
        }
        yield {
          type: "text-delta",
          text: "Recovered",
        };
        yield {
          type: "assistant-content",
          parts: [{ type: "text", text: "Recovered" }],
        };
        yield {
          type: "stop",
          reason: "end_turn",
        };
      },
    };
    const events: Array<{ type: string; text?: string }> = [];

    await runAgentLoop({
      engine,
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
      actions: {},
      send: (event) => events.push(event),
      signal: new AbortController().signal,
    });

    expect(streamCalls).toBe(2);
    expect(events).toContainEqual({ type: "clear" });
    expect(events).toContainEqual({ type: "text", text: "Recovered" });
  });
});

// ─── isContextTooLongError ────────────────────────────────────────────────────

describe("isContextTooLongError", () => {
  it("returns false for non-Error values", () => {
    expect(isContextTooLongError("string")).toBe(false);
    expect(isContextTooLongError(null)).toBe(false);
    expect(isContextTooLongError(429)).toBe(false);
  });

  it("matches OpenAI / Anthropic phrasing", () => {
    expect(isContextTooLongError(new Error("context_length_exceeded"))).toBe(
      true,
    );
    expect(isContextTooLongError(new Error("input_too_long"))).toBe(true);
    expect(
      isContextTooLongError(new Error("too many tokens in the prompt")),
    ).toBe(true);
    expect(isContextTooLongError(new Error("prompt is too long"))).toBe(true);
    expect(isContextTooLongError(new Error("Please reduce the length"))).toBe(
      true,
    );
  });

  it("matches Gemini phrasing", () => {
    expect(
      isContextTooLongError(new Error("input token count exceeds the limit")),
    ).toBe(true);
    expect(isContextTooLongError(new Error("Request too large"))).toBe(true);
  });

  it("matches EngineError with context_length errorCode", () => {
    const err = new EngineError("context error", {
      errorCode: "context_length_exceeded",
    });
    expect(isContextTooLongError(err)).toBe(true);
  });

  it("returns false for unrelated errors", () => {
    expect(isContextTooLongError(new Error("rate limit reached"))).toBe(false);
    expect(isContextTooLongError(new Error("overloaded"))).toBe(false);
  });
});

// ─── isRetryableError ────────────────────────────────────────────────────────

describe("isRetryableError", () => {
  it("returns false for non-Error values", () => {
    expect(isRetryableError("string")).toBe(false);
    expect(isRetryableError(null)).toBe(false);
  });

  it("retries on HTTP 429 from statusCode field", () => {
    const err = new EngineError("rate limited", { statusCode: 429 });
    expect(isRetryableError(err)).toBe(true);
  });

  it("retries on HTTP 529 (Anthropic overloaded) from statusCode field", () => {
    const err = new EngineError("overloaded", { statusCode: 529 });
    expect(isRetryableError(err)).toBe(true);
  });

  it("retries on HTTP 500/502/503 from statusCode field", () => {
    expect(isRetryableError(new EngineError("e", { statusCode: 500 }))).toBe(
      true,
    );
    expect(isRetryableError(new EngineError("e", { statusCode: 502 }))).toBe(
      true,
    );
    expect(isRetryableError(new EngineError("e", { statusCode: 503 }))).toBe(
      true,
    );
  });

  it("retries when providerRetryable is true", () => {
    const err = new EngineError("transient", { providerRetryable: true });
    expect(isRetryableError(err)).toBe(true);
  });

  it("does not retry when providerRetryable is false and no other signals", () => {
    const err = new EngineError("not retryable", { providerRetryable: false });
    expect(isRetryableError(err)).toBe(false);
  });

  it("retries on Anthropic 'overloaded' message keyword", () => {
    expect(isRetryableError(new Error("Anthropic API overloaded"))).toBe(true);
  });

  it("retries on OpenAI 'Rate limit reached' phrasing", () => {
    expect(
      isRetryableError(new Error("Rate limit reached for model gpt-5.5")),
    ).toBe(true);
  });

  it("retries on Google 'resource_exhausted' phrasing", () => {
    expect(
      isRetryableError(new Error("RESOURCE_EXHAUSTED: quota exceeded")),
    ).toBe(true);
  });

  it("retries on 'quota exceeded' phrasing", () => {
    expect(isRetryableError(new Error("quota exceeded for project"))).toBe(
      true,
    );
  });

  it("does NOT retry builder_gateway_timeout", () => {
    const err = new EngineError("timed out", {
      errorCode: "builder_gateway_timeout",
    });
    expect(isRetryableError(err)).toBe(false);
  });

  it("does NOT retry rate_limit_exceeded (daily cap)", () => {
    const err = new EngineError("daily cap hit", {
      errorCode: "rate_limit_exceeded",
    });
    expect(isRetryableError(err)).toBe(false);
  });

  it("does NOT retry daily gateway request cap message", () => {
    expect(
      isRetryableError(new Error("daily gateway request cap exceeded")),
    ).toBe(false);
  });

  it("retries on builder_gateway_error code", () => {
    const err = new EngineError("gateway error", {
      errorCode: "builder_gateway_error",
    });
    expect(isRetryableError(err)).toBe(true);
  });

  it("retries on 'too many requests' in message", () => {
    expect(isRetryableError(new Error("too many requests, please wait"))).toBe(
      true,
    );
  });
});

// ─── trimOldToolResults ───────────────────────────────────────────────────────

describe("trimOldToolResults", () => {
  type Msg = Parameters<typeof trimOldToolResults>[0][number];

  function userTextMsg(text: string): Msg {
    return { role: "user", content: [{ type: "text", text }] };
  }

  function assistantTextMsg(text: string): Msg {
    return { role: "assistant", content: [{ type: "text", text }] };
  }

  /** Build a user message carrying a single tool-result part (real EngineToolResultPart shape). */
  function toolResultMsg(toolCallId: string, result: string): Msg {
    return {
      role: "user",
      content: [
        {
          type: "tool-result",
          toolCallId,
          toolName: "some_tool",
          toolInput: "{}",
          content: result,
        },
      ],
    };
  }

  function toolCallMsg(id: string, name: string): Msg {
    return {
      role: "assistant",
      content: [{ type: "tool-call", id, name, input: {} }],
    };
  }

  it("returns null when there are no tool-result messages to trim", () => {
    const messages: Msg[] = [userTextMsg("hi"), assistantTextMsg("hello")];
    expect(trimOldToolResults(messages)).toBeNull();
  });

  it("returns null when all tool results are in the protected tail", () => {
    const messages: Msg[] = [
      userTextMsg("start"),
      toolCallMsg("tc1", "read_file"),
      toolResultMsg("tc1", "file content"),
    ];
    // keepTail=10 protects all 3 messages
    expect(trimOldToolResults(messages, 10)).toBeNull();
  });

  it("stubs old tool results and leaves recent tail intact", () => {
    const messages: Msg[] = [
      toolCallMsg("old-tc", "read_file"),
      toolResultMsg("old-tc", "old huge file content"),
      userTextMsg("second turn"),
      toolCallMsg("new-tc", "run_tests"),
      toolResultMsg("new-tc", "recent result"),
    ];
    const result = trimOldToolResults(messages, 3);
    expect(result).not.toBeNull();

    // Old tool result (index 1, outside protected tail of 3) must be stubbed
    const oldResultMsg = result![1];
    expect(oldResultMsg.role).toBe("user");
    const oldPart = oldResultMsg.content[0] as {
      type: string;
      content: string;
    };
    expect(oldPart.type).toBe("tool-result");
    expect(oldPart.content).toContain("trimmed");

    // Recent tool result (index 4, inside tail) must be preserved
    const newResultMsg = result![4];
    const newPart = newResultMsg.content[0] as {
      type: string;
      content: string;
    };
    expect(newPart.type).toBe("tool-result");
    expect(newPart.content).toBe("recent result");
  });

  it("preserves user text messages even outside the tail", () => {
    const messages: Msg[] = [
      userTextMsg("original user question"),
      toolCallMsg("tc1", "tool"),
      toolResultMsg("tc1", "big result"),
      assistantTextMsg("assistant reply"),
      userTextMsg("followup"),
      assistantTextMsg("final"),
    ];
    const result = trimOldToolResults(messages, 2);
    expect(result).not.toBeNull();

    // User text message at index 0 must be preserved
    const firstPart = result![0].content[0] as { type: string; text: string };
    expect(firstPart.text).toBe("original user question");

    // Assistant text at index 3 must be preserved
    const thirdPart = result![3].content[0] as { type: string; text: string };
    expect(thirdPart.text).toBe("assistant reply");
  });

  it("does not mutate the input array", () => {
    const messages: Msg[] = [
      toolCallMsg("tc1", "tool"),
      toolResultMsg("tc1", "important data"),
      userTextMsg("turn 2"),
    ];
    const original = JSON.stringify(messages);
    trimOldToolResults(messages, 1);
    expect(JSON.stringify(messages)).toBe(original);
  });

  it("returns null when there is nothing to trim (only user/assistant text)", () => {
    const messages: Msg[] = Array.from({ length: 20 }, (_, i) =>
      i % 2 === 0 ? userTextMsg(`u${i}`) : assistantTextMsg(`a${i}`),
    );
    expect(trimOldToolResults(messages, 10)).toBeNull();
  });
});
