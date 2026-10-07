import { describe, expect, it } from "vitest";

import type {
  AgentEngine,
  EngineContentPart,
  EngineEvent,
} from "./engine/types.js";
import {
  actionsToEngineTools,
  runAgentLoop,
  type ActionEntry,
} from "./production-agent.js";
import { attachToolSearch } from "./tool-search.js";
import type { AgentChatEvent } from "./types.js";

function tool(description: string): ActionEntry {
  return {
    tool: { description, parameters: { type: "object", properties: {} } },
    readOnly: true,
    run: async () => `ran ${description}`,
  };
}

const searchCall = (
  id: string,
  input: Record<string, unknown>,
): EngineContentPart => ({
  type: "tool-call",
  id,
  name: "tool-search",
  input,
});

async function run(
  initialNames: string[],
  turns: EngineContentPart[][],
  registry: Record<string, ActionEntry> = {
    "alpha-tool": tool("Alpha reporting capability"),
    starter: tool("Starter tool"),
    "beta-tool": tool("Beta forecasting capability"),
    "gamma-tool": tool("Gamma exporting capability"),
  },
) {
  const actions = attachToolSearch(registry);
  const allTools = actionsToEngineTools(actions);
  const seenTools: string[][] = [];
  const events: AgentChatEvent[] = [];
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
      seenTools.push(opts.tools.map((t) => t.name));
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
  await runAgentLoop({
    engine,
    model: "test-model",
    systemPrompt: "system",
    tools: allTools.filter((t) => initialNames.includes(t.name)),
    availableTools: allTools,
    messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
    actions,
    send: (event) => events.push(event),
    signal: new AbortController().signal,
  });
  const searchResults = events
    .filter(
      (event): event is Extract<AgentChatEvent, { type: "tool_done" }> =>
        event.type === "tool_done" && event.tool === "tool-search",
    )
    .map((event) => event.result);
  return { seenTools, events, searchResults };
}

describe("tool-search expansion", () => {
  it("appends a loaded tool so the earlier tools prefix is unchanged", async () => {
    const { seenTools } = await run(
      ["starter", "tool-search"],
      [[searchCall("s1", { query: "alpha reporting" })]],
    );
    expect(seenTools[0]).toEqual(["starter", "tool-search"]);
    expect(seenTools[1]).toEqual([...seenTools[0], "alpha-tool"]);
  });

  it("loads every query and exact name from one call, appended in registry order", async () => {
    const { seenTools, searchResults } = await run(
      ["starter", "tool-search"],
      [
        [
          searchCall("s1", {
            queries: ["gamma exporting", "alpha reporting"],
            names: ["beta-tool"],
          }),
        ],
      ],
    );
    expect(seenTools).toHaveLength(2);
    expect(seenTools[1]).toEqual([
      ...seenTools[0],
      "alpha-tool",
      "beta-tool",
      "gamma-tool",
    ]);
    expect(searchResults).toHaveLength(1);
    expect(searchResults[0]).toContain("Loaded matching tool schemas");
  });

  it("tells the model when every match is already callable, instead of reloading", async () => {
    const { seenTools, searchResults } = await run(
      ["starter", "tool-search"],
      [[searchCall("s1", { query: "starter" })]],
    );
    expect(seenTools[1]).toEqual(seenTools[0]);
    expect(JSON.parse(searchResults[0])).toMatchObject({
      alreadyLoaded: true,
      message: "All 1 matches are already callable; call them directly.",
    });
  });

  it("stops a chain of searches for tools that are already callable", async () => {
    const queries = ["starter", "starter one", "starter two", "starter three"];
    const { events, searchResults } = await run(
      ["starter", "tool-search"],
      queries.map((query, index) => [searchCall(`s${index}`, { query })]),
    );
    expect(searchResults).toHaveLength(4);
    expect(events).toContainEqual(
      expect.objectContaining({ type: "done", reason: "loop_breaker" }),
    );
  });

  it("keeps the search's own notes when every match is already callable", async () => {
    const { searchResults } = await run(
      ["starter", "tool-search"],
      [[searchCall("s1", { names: ["starter", "ghost-tool"] })]],
    );
    const parsed = JSON.parse(searchResults[0]);
    expect(parsed.alreadyLoaded).toBe(true);
    expect(parsed.message).toContain("already callable");
    expect(parsed.message).toContain("No tool named ghost-tool");
  });

  it("does not stop a run whose searches for callable tools are separated by writes", async () => {
    const writer: ActionEntry = {
      tool: {
        description: "Write a record",
        parameters: {
          type: "object",
          properties: { n: { type: "number" } },
        },
      },
      readOnly: false,
      run: async () => "wrote",
    };
    const queries = ["starter", "starter one", "starter two", "starter three"];
    const { events, searchResults } = await run(
      ["starter", "writer", "tool-search"],
      queries.flatMap((query, index) => [
        [searchCall(`s${index}`, { query })],
        [
          {
            type: "tool-call" as const,
            id: `w${index}`,
            name: "writer",
            input: { n: index },
          },
        ],
      ]),
      {
        starter: tool("Starter tool"),
        writer,
        "alpha-tool": tool("Alpha reporting capability"),
      },
    );
    expect(searchResults).toHaveLength(4);
    expect(
      events.filter((e) => e.type === "tool_done" && e.tool === "writer"),
    ).toHaveLength(4);
    expect(events).not.toContainEqual(
      expect.objectContaining({ type: "done", reason: "loop_breaker" }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({ type: "text", text: "done" }),
    );
  });

  describe("searches paired with a successful non-search call", () => {
    const reader = (
      run: ActionEntry["run"] = async () => "read",
    ): ActionEntry => ({
      tool: {
        description: "Read a record",
        parameters: { type: "object", properties: { n: { type: "number" } } },
      },
      readOnly: true,
      run,
    });
    const pairedTurns = (count: number) =>
      Array.from({ length: count }, (_, index) => [
        searchCall(`s${index}`, { query: `starter ${index}` }),
        {
          type: "tool-call" as const,
          id: `r${index}`,
          name: "reader",
          input: { n: index },
        },
      ]);
    const registry = (entry: ActionEntry) => ({
      starter: tool("Starter tool"),
      reader: entry,
      "alpha-tool": tool("Alpha reporting capability"),
    });

    it("still stops when each redundant search is followed by a read-only call", async () => {
      const { events, searchResults } = await run(
        ["starter", "reader", "tool-search"],
        pairedTurns(8),
        registry(reader()),
      );
      expect(searchResults).toHaveLength(4);
      expect(events).toContainEqual(
        expect.objectContaining({ type: "done", reason: "loop_breaker" }),
      );
    });

    it("treats a call that returned a receipt as progress even when it is read-only", async () => {
      const { events, searchResults } = await run(
        ["starter", "reader", "tool-search"],
        pairedTurns(6),
        registry(
          reader(async () => ({
            _receipt: { changed: true, verified: true, summary: "Checked." },
          })),
        ),
      );
      expect(searchResults).toHaveLength(6);
      expect(events).not.toContainEqual(
        expect.objectContaining({ type: "done", reason: "loop_breaker" }),
      );
    });
  });

  it("does not read a tool a sibling search loaded this step as already callable", async () => {
    const { seenTools, searchResults } = await run(
      ["starter", "tool-search"],
      [
        [
          searchCall("s1", { query: "alpha reporting" }),
          searchCall("s2", { query: "alpha" }),
          searchCall("s3", { query: "reporting alpha" }),
        ],
      ],
    );
    expect(searchResults).toHaveLength(3);
    for (const result of searchResults) {
      expect(result).not.toContain("alreadyLoaded");
      expect(result).not.toContain("call them directly");
      expect(result).toContain("for the next step, not this one: alpha-tool");
    }
    expect(seenTools[1].filter((name) => name === "alpha-tool")).toHaveLength(
      1,
    );
  });

  it("counts parallel searches for callable tools as one repeat", async () => {
    const { events, searchResults } = await run(
      ["starter", "tool-search"],
      [
        [
          searchCall("s1", { query: "starter" }),
          searchCall("s2", { query: "starter one" }),
          searchCall("s3", { query: "starter two" }),
        ],
        [searchCall("s4", { query: "starter three" })],
      ],
    );
    expect(searchResults).toHaveLength(4);
    expect(events).not.toContainEqual(
      expect.objectContaining({ type: "done", reason: "loop_breaker" }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({ type: "text", text: "done" }),
    );
  });

  it("does not claim a match is callable when it cannot be loaded", async () => {
    const registry = {
      starter: tool("Starter tool"),
      "orphan-tool": tool("Orphan capability"),
    };
    const actions = attachToolSearch(registry);
    const allTools = actionsToEngineTools(actions);
    const events: AgentChatEvent[] = [];
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
        const parts: EngineContentPart[] =
          streamCalls++ === 0
            ? [searchCall("s1", { query: "orphan capability" })]
            : [{ type: "text", text: "done" }];
        yield { type: "assistant-content", parts };
        yield {
          type: "stop",
          reason: streamCalls === 1 ? "tool_use" : "end_turn",
        };
      },
    };
    await runAgentLoop({
      engine,
      model: "test-model",
      systemPrompt: "system",
      tools: allTools.filter((t) => t.name !== "orphan-tool"),
      availableTools: allTools.filter((t) => t.name !== "orphan-tool"),
      messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
      actions,
      send: (event) => events.push(event),
      signal: new AbortController().signal,
    });
    const done = events.find(
      (event) => event.type === "tool_done" && event.tool === "tool-search",
    );
    expect(done).toBeDefined();
    expect((done as { result: string }).result).not.toContain("alreadyLoaded");
  });
});
