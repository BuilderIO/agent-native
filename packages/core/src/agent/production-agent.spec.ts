import { describe, expect, it } from "vitest";
import { attachToolSearch } from "./tool-search.js";
import {
  buildUserContentWithAttachments,
  createPlanModeActionRegistry,
  isPlanModeToolCallAllowed,
  runAgentLoop,
  type ActionEntry,
} from "./production-agent.js";
import type { AgentEngine, EngineEvent } from "./engine/types.js";

function actionEntry(opts: {
  description?: string;
  readOnly?: boolean;
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

  it("emits loop_limit with the configured max iteration count", async () => {
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

    expect(streamCalls).toBe(2);
    expect(events).toContainEqual({ type: "loop_limit", maxIterations: 2 });
    expect(events.at(-1)).toEqual({ type: "done" });
  });
});
