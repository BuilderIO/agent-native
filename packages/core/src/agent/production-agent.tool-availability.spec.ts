import { describe, expect, it, vi } from "vitest";

import type {
  AgentEngine,
  EngineContentPart,
  EngineEvent,
  EngineMessage,
} from "./engine/types.js";
import {
  actionsToEngineTools,
  pinAdditionalActionsToTurn,
  runAgentLoop,
  toolCallCacheKey,
  type ActionEntry,
  type AgentApprovalBinding,
} from "./production-agent.js";
import {
  attachToolSearch,
  filterActionsForAgentDiscovery,
} from "./tool-search.js";
import type { AgentChatEvent } from "./types.js";

// A run resolves the caller's current tools, so tools the conversation used or
// loaded earlier can be gone by the time the next run starts.

function tool(description: string, extra: Partial<ActionEntry> = {}) {
  return {
    tool: { description, parameters: { type: "object", properties: {} } },
    run: async () => `ran ${description}`,
    ...extra,
  } as ActionEntry;
}

function engineWith(turns: EngineContentPart[][], seen: EngineMessage[][]) {
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
      seen.push(structuredClone(opts.messages));
      const parts = turns[streamCalls++] ?? [{ type: "text", text: "done" }];
      yield { type: "assistant-content", parts };
      yield {
        type: "stop",
        reason: parts.some((part) => part.type === "tool-call")
          ? "tool_use"
          : "end_turn",
      };
    },
  };
  return engine;
}

const userText = (text: string): EngineMessage => ({
  role: "user",
  content: [{ type: "text", text }],
});

/** Earlier turns that loaded and called `editor-format`, then a new prompt. */
const history: EngineMessage[] = [
  userText("format the file"),
  {
    role: "assistant",
    content: [{ type: "tool-call", id: "s1", name: "tool-search", input: {} }],
  },
  {
    role: "user",
    content: [
      {
        type: "tool-result",
        toolCallId: "s1",
        toolName: "tool-search",
        toolInput: "{}",
        content: JSON.stringify({
          loadedForNextStep: ["editor-format", "task-run"],
        }),
      },
    ],
  },
  {
    role: "assistant",
    content: [
      { type: "tool-call", id: "c1", name: "editor-format", input: {} },
    ],
  },
  {
    role: "user",
    content: [
      {
        type: "tool-result",
        toolCallId: "c1",
        toolName: "editor-format",
        toolInput: "{}",
        content: "formatted",
      },
    ],
  },
  userText("format it again"),
];

async function run(options: {
  registry: Record<string, ActionEntry>;
  turns: EngineContentPart[][];
  approvedToolCalls?: string[];
  consumeApproval?: (binding: AgentApprovalBinding) => Promise<boolean>;
  isToolAlwaysAllowed?: (binding: AgentApprovalBinding) => Promise<boolean>;
}) {
  const actions = attachToolSearch(options.registry);
  const tools = actionsToEngineTools(actions);
  const seen: EngineMessage[][] = [];
  const events: AgentChatEvent[] = [];
  await runAgentLoop({
    engine: engineWith(options.turns, seen),
    model: "test-model",
    systemPrompt: "system",
    tools,
    availableTools: tools,
    messages: structuredClone(history),
    actions,
    send: (event) => events.push(event),
    signal: new AbortController().signal,
    approvedToolCalls: options.approvedToolCalls,
    consumeApproval: options.consumeApproval,
    isToolAlwaysAllowed: options.isToolAlwaysAllowed,
  });
  const done = (name: string) =>
    events.find(
      (event): event is Extract<AgentChatEvent, { type: "tool_done" }> =>
        event.type === "tool_done" && event.tool === name,
    );
  return { seen, events, done };
}

const callTo = (name: string, id = `call-${name}`): EngineContentPart => ({
  type: "tool-call",
  id,
  name,
  input: {},
});

describe("tools that are gone since earlier in the conversation", () => {
  it("names loaded tools that no longer resolve in the run's first request", async () => {
    const { seen } = await run({
      registry: { "task-run": tool("Run a task") },
      turns: [],
    });

    const lastMessage = seen[0]!.at(-1)!;
    const note = lastMessage.content.find(
      (part) => part.type === "text" && part.text.includes("no longer"),
    );
    expect(note).toMatchObject({
      type: "text",
      text: expect.stringContaining("no longer available: editor-format."),
    });
    expect(JSON.stringify(note)).not.toContain("task-run");
  });

  it("adds the note once when a continuation reruns the loop on the same messages", async () => {
    const actions = attachToolSearch({ "task-run": tool("Run a task") });
    const tools = actionsToEngineTools(actions);
    const messages = structuredClone(history);
    const seen: EngineMessage[][] = [];
    for (let pass = 0; pass < 2; pass++) {
      await runAgentLoop({
        engine: engineWith([], seen),
        model: "test-model",
        systemPrompt: "system",
        tools,
        availableTools: tools,
        messages,
        actions,
        send: () => {},
        signal: new AbortController().signal,
      });
      messages.push(userText("Continue."));
    }

    const notes =
      JSON.stringify(seen[1]).split("no longer available").length - 1;
    expect(notes).toBe(1);
  });

  it("adds no note when every loaded tool still resolves", async () => {
    const { seen } = await run({
      registry: {
        "editor-format": tool("Format"),
        "task-run": tool("Run a task"),
      },
      turns: [],
    });

    expect(JSON.stringify(seen[0])).not.toContain("no longer available");
  });

  it("tells the model a tool it used earlier is gone, and keeps Unknown tool for names it never had", async () => {
    const { done } = await run({
      registry: { "task-run": tool("Run a task") },
      turns: [[callTo("editor-format"), callTo("invented-tool")]],
    });

    expect(done("editor-format")).toMatchObject({
      isError: true,
      completedSideEffect: false,
      result: expect.stringMatching(
        /^Error: Tool no longer available: "editor-format"/,
      ),
    });
    expect(done("invented-tool")?.result).toMatch(
      /^Error: Unknown tool "invented-tool"/,
    );
  });

  it("keeps Unknown tool for a name that already got Unknown tool earlier", async () => {
    const actions = attachToolSearch({ "task-run": tool("Run a task") });
    const tools = actionsToEngineTools(actions);
    const events: AgentChatEvent[] = [];
    await runAgentLoop({
      engine: engineWith([[callTo("invented-tool", "again")]], []),
      model: "test-model",
      systemPrompt: "system",
      tools,
      availableTools: tools,
      messages: [
        userText("do it"),
        {
          role: "assistant",
          content: [callTo("invented-tool", "first")],
        },
        {
          role: "user",
          content: [
            {
              type: "tool-result",
              toolCallId: "first",
              toolName: "invented-tool",
              toolInput: "{}",
              content: 'Error: Unknown tool "invented-tool".',
              isError: true,
            },
          ],
        },
        userText("try again"),
      ],
      actions,
      send: (event) => events.push(event),
      signal: new AbortController().signal,
    });

    const done = events.find(
      (event): event is Extract<AgentChatEvent, { type: "tool_done" }> =>
        event.type === "tool_done" && event.id === "again",
    );
    expect(done?.result).toMatch(/^Error: Unknown tool "invented-tool"/);
  });

  it("stops instead of continuing when the tool the user approved is gone", async () => {
    const { seen, events, done } = await run({
      registry: { "task-run": tool("Run a task") },
      turns: [
        [callTo("editor-format")],
        [{ type: "text", text: "improvised" }],
      ],
      approvedToolCalls: [toolCallCacheKey("editor-format", {})],
    });

    expect(done("editor-format")?.result).toMatch(
      /^Error: Tool no longer available/,
    );
    expect(events).toContainEqual(
      expect.objectContaining({ type: "error", errorCode: "tool_unavailable" }),
    );
    expect(seen).toHaveLength(1);
  });
});

describe("a durable continuation whose pinned tool was removed", () => {
  // The turn pinned both names; editor-format was removed before this run.
  const pinned = () =>
    pinAdditionalActionsToTurn(
      { "task-run": tool("Run a task") },
      ["editor-format", "task-run"],
      {},
    );

  it("does not offer the placeholder to the model as a tool", () => {
    const names = actionsToEngineTools(attachToolSearch(pinned())).map(
      (engineTool) => engineTool.name,
    );

    expect(names).toContain("task-run");
    expect(names).not.toContain("editor-format");
  });

  it("treats the placeholder as gone, not as a tool that failed", async () => {
    const { seen, done } = await run({
      registry: pinned(),
      turns: [[callTo("editor-format")]],
    });

    expect(done("editor-format")?.result).toMatch(
      /^Error: Tool no longer available: "editor-format"/,
    );
    expect(JSON.stringify(seen[0])).toContain(
      "no longer available: editor-format.",
    );
  });

  it("stops when the approved call's tool is a placeholder", async () => {
    const { seen, events } = await run({
      registry: pinned(),
      turns: [
        [callTo("editor-format")],
        [{ type: "text", text: "improvised" }],
      ],
      approvedToolCalls: [toolCallCacheKey("editor-format", {})],
    });

    expect(events).toContainEqual(
      expect.objectContaining({ type: "error", errorCode: "tool_unavailable" }),
    );
    expect(seen).toHaveLength(1);
  });

  it("still treats the placeholder as gone after discovery filtering copies it", async () => {
    const { seen, events } = await run({
      registry: await filterActionsForAgentDiscovery(pinned()),
      turns: [
        [callTo("editor-format")],
        [{ type: "text", text: "improvised" }],
      ],
      approvedToolCalls: [toolCallCacheKey("editor-format", {})],
    });

    expect(events).toContainEqual(
      expect.objectContaining({ type: "error", errorCode: "tool_unavailable" }),
    );
    expect(seen).toHaveLength(1);
  });
});

describe("approvals bound to an entry's revision", () => {
  it("passes the entry's revision to the approval and always-allow checks", async () => {
    const consumeApproval = vi.fn(async () => false);
    const isToolAlwaysAllowed = vi.fn(async () => true);
    const { done } = await run({
      registry: {
        "editor-format": tool("Format", {
          needsApproval: true,
          revision: "window-2",
        }),
      },
      turns: [[callTo("editor-format")]],
      approvedToolCalls: [toolCallCacheKey("editor-format", {})],
      consumeApproval,
      isToolAlwaysAllowed,
    });

    expect(consumeApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: "editor-format",
        toolRevision: "window-2",
      }),
    );
    expect(isToolAlwaysAllowed).toHaveBeenCalledWith(
      expect.objectContaining({ toolRevision: "window-2" }),
    );
    expect(done("editor-format")?.result).toBe("ran Format");
  });

  it("binds an entry without a revision as null", async () => {
    const isToolAlwaysAllowed = vi.fn(async () => true);
    await run({
      registry: { "editor-format": tool("Format", { needsApproval: true }) },
      turns: [[callTo("editor-format")]],
      isToolAlwaysAllowed,
    });

    expect(isToolAlwaysAllowed).toHaveBeenCalledWith(
      expect.objectContaining({ toolRevision: null }),
    );
  });
});
