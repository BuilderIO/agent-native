import { describe, expect, it } from "vitest";

import { runWithRequestContext } from "../server/request-context.js";
import { MAX_PROVIDER_TOOLS } from "./engine/limit-provider-tools.js";
import type {
  AgentEngine,
  EngineContentPart,
  EngineEvent,
} from "./engine/types.js";
import { FOLLOW_UP_SUGGESTIONS_TOOL_NAME } from "./follow-up-suggestions.js";
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

type Turn =
  | EngineContentPart[]
  | ((seen: {
      seenTools: string[][];
      events: AgentChatEvent[];
    }) => EngineContentPart[]);

async function run(
  initialNames: string[],
  turns: Turn[],
  registry: Record<string, ActionEntry> = {
    "alpha-tool": tool("Alpha reporting capability"),
    starter: tool("Starter tool"),
    "beta-tool": tool("Beta forecasting capability"),
    "gamma-tool": tool("Gamma exporting capability"),
  },
  extraOpts: Partial<Parameters<typeof runAgentLoop>[0]> = {},
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
      const turn = turns[streamCalls++];
      const parts = (typeof turn === "function"
        ? turn({ seenTools, events })
        : turn) ?? [{ type: "text", text: "done" }];
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
    ...extraOpts,
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

describe("tool-search expansion at the provider tool cap", () => {
  const groupNames = (group: string) =>
    Array.from(
      { length: 20 },
      (_, index) => `${group}-${String(index).padStart(2, "0")}`,
    );
  const groupSearch = (id: string, group: string) =>
    searchCall(id, { names: groupNames(group) });
  const registryOf = (groups: string[], starters = 0) =>
    Object.fromEntries([
      ...Array.from({ length: starters }, (_, index) => [
        `starter-${index}`,
        tool(`Starter ${index}`),
      ]),
      ...groups.flatMap((group) =>
        groupNames(group).map((name) => [name, tool(`${name} capability`)]),
      ),
    ]);
  const loadedIn = (result: string) =>
    result.match(/not this one: ([^\n"]*)/)?.[1].split(", ") ?? [];
  const overflowCount = (result: string) =>
    Number(result.match(/Could not load (\d+) matched/)?.[1] ?? 0);
  const overflowShown = (result: string) =>
    result
      .match(/was reached: ([^.]*?)(?:, and \d+ more)?\. They/)?.[1]
      .split(", ") ?? [];

  // Seven searches of 20 tools in one step ask for more than a request holds.
  const floodGroups = ["aa", "bb", "cc", "dd", "ee", "ff", "gg"];
  const floodTurn = floodGroups.map((group, index) =>
    groupSearch(`flood-${index}`, group),
  );
  const floodTools = floodGroups.flatMap(groupNames);

  it("appends below the cap and evicts the least recently loaded tools past it", async () => {
    const starters = Array.from({ length: 100 }, (_, i) => `starter-${i}`);
    const { seenTools, searchResults } = await run(
      [...starters, "tool-search"],
      [[groupSearch("s1", "aa")], [groupSearch("s2", "bb")]],
      registryOf(["aa", "bb"], 100),
    );
    expect(seenTools[1]).toEqual([...seenTools[0], ...groupNames("aa")]);
    expect(seenTools[2]).toHaveLength(MAX_PROVIDER_TOOLS);
    expect(new Set(seenTools[2]).size).toBe(MAX_PROVIDER_TOOLS);
    expect(seenTools[2]).toEqual(
      expect.arrayContaining([...groupNames("bb"), ...starters, "tool-search"]),
    );
    expect(
      seenTools[2].filter((name) => name.startsWith("aa-")).sort(),
    ).toEqual(groupNames("aa").slice(13));
    expect(searchResults[1]).toContain("Loaded matching tool schemas");
    expect(searchResults[1]).not.toContain("Could not load");
  });

  it("keeps a loaded tool the model has been calling when it evicts", async () => {
    const starters = Array.from({ length: 100 }, (_, i) => `starter-${i}`);
    const { seenTools } = await run(
      [...starters, "tool-search"],
      [
        [groupSearch("s1", "aa")],
        [{ type: "tool-call", id: "c1", name: "aa-00", input: {} }],
        [groupSearch("s2", "bb")],
      ],
      registryOf(["aa", "bb"], 100),
    );
    expect(seenTools[3]).toHaveLength(MAX_PROVIDER_TOOLS);
    expect(seenTools[3]).toContain("aa-00");
    expect(seenTools[3]).not.toContain("aa-01");
  });

  it("does not report tools the cap dropped as loaded, and says how many did not fit", async () => {
    const { seenTools, searchResults } = await run(
      ["tool-search"],
      [floodTurn],
      registryOf(floodGroups),
    );
    const active = seenTools[1];
    expect(active).toHaveLength(MAX_PROVIDER_TOOLS);
    expect(active).toContain("tool-search");
    expect(new Set(searchResults.flatMap(loadedIn))).toEqual(
      new Set(active.filter((name) => name !== "tool-search")),
    );
    expect(
      searchResults.reduce((sum, result) => sum + overflowCount(result), 0),
    ).toBe(floodTools.length - (MAX_PROVIDER_TOOLS - 1));
    const overflowed = searchResults.filter(
      (result) => overflowCount(result) > 0,
    );
    expect(overflowed.length).toBeGreaterThan(0);
    for (const result of overflowed) {
      expect(result).toContain(
        `per-request tool limit (${MAX_PROVIDER_TOOLS})`,
      );
      expect(result).toContain("use tools you already have");
      expect(overflowShown(result).length).toBeGreaterThan(0);
      expect(overflowShown(result).length).toBeLessThanOrEqual(5);
      for (const name of overflowShown(result)) {
        expect(active).not.toContain(name);
      }
    }
  });

  it("never reads a tool the cap dropped as already loaded on a later search", async () => {
    const { seenTools, searchResults } = await run(
      ["tool-search"],
      [
        floodTurn,
        ({ seenTools: seen }) => [
          searchCall("later", {
            names: floodTools.filter((name) => !seen[1].includes(name)),
          }),
        ],
      ],
      registryOf(floodGroups),
    );
    const dropped = floodTools.filter((name) => !seenTools[1].includes(name));
    expect(dropped.length).toBeGreaterThan(0);
    const later = searchResults[floodTurn.length];
    expect(later).not.toContain("alreadyLoaded");
    expect(later).toContain("Loaded matching tool schemas");
    expect(seenTools[2]).toHaveLength(MAX_PROVIDER_TOOLS);
    expect(seenTools[2]).toEqual(expect.arrayContaining(dropped));
  });

  it("does not tell a repeated search its dropped matches are available", async () => {
    const { searchResults } = await runWithRequestContext(
      { userEmail: "agent@example.com", run: {} },
      () =>
        run(
          ["tool-search"],
          [[...floodTurn, groupSearch("again", "gg")]],
          registryOf(floodGroups),
        ),
    );
    const repeated = searchResults
      .map((result) => {
        try {
          return JSON.parse(result) as { repeated?: boolean; message?: string };
        } catch {
          return null;
        }
      })
      .find((parsed) => parsed?.repeated);
    expect(repeated?.message).toContain("Could not load");
    expect(repeated?.message).not.toContain("already available");
  });

  it("does not read an initial tool the first request left out as already loaded", async () => {
    const starters = Array.from({ length: 130 }, (_, i) => `starter-${i}`);
    const { seenTools, searchResults } = await run(
      [...starters, "tool-search"],
      [[searchCall("s1", { names: ["starter-129"] })]],
      registryOf([], 130),
    );
    expect(seenTools[0]).toHaveLength(MAX_PROVIDER_TOOLS);
    expect(seenTools[0]).not.toContain("starter-129");
    expect(searchResults[0]).not.toContain("alreadyLoaded");
    expect(searchResults[0]).toContain("not this one: starter-129");
    expect(seenTools[1]).toHaveLength(MAX_PROVIDER_TOOLS);
    expect(seenTools[1]).toContain("starter-129");
  });

  it("never drops tool-search or the follow-up tool for loaded ones", async () => {
    const { seenTools } = await run(
      ["tool-search"],
      [floodTurn],
      registryOf(floodGroups),
      { followUpSuggestions: true, runId: "run-at-cap" },
    );
    expect(seenTools[1]).toHaveLength(MAX_PROVIDER_TOOLS);
    expect(seenTools[1]).toContain("tool-search");
    expect(seenTools[1]).toContain(FOLLOW_UP_SUGGESTIONS_TOOL_NAME);
  });
});
