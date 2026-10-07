import { afterEach, describe, expect, it, vi } from "vitest";

import { MAX_PROVIDER_TOOLS } from "./engine/limit-provider-tools.js";
import type {
  AgentEngine,
  EngineContentPart,
  EngineEvent,
  EngineMessage,
} from "./engine/types.js";
import {
  actionsToEngineTools,
  runAgentLoop,
  type ActionEntry,
} from "./production-agent.js";
import { threadDataToEngineMessages } from "./thread-data-builder.js";
import { attachToolSearch } from "./tool-search.js";
import type { AgentChatEvent } from "./types.js";

function tool(description: string, parameterCount = 0): ActionEntry {
  return {
    tool: {
      description,
      parameters: {
        type: "object",
        properties: Object.fromEntries(
          Array.from({ length: parameterCount }, (_, index) => [
            `field_${index}`,
            {
              type: "string",
              description: `Parameter ${index} of ${description}, described at enough length to make a stored search result large`,
            },
          ]),
        ),
      },
    },
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

function engineWith(
  turns: EngineContentPart[][],
  seenTools: string[][],
): AgentEngine {
  let streamCalls = 0;
  return {
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
}

async function run(
  registry: Record<string, ActionEntry>,
  initialNames: string[],
  messages: EngineMessage[],
  turns: EngineContentPart[][] = [],
) {
  const actions = attachToolSearch(registry);
  const allTools = actionsToEngineTools(actions);
  const seenTools: string[][] = [];
  const events: AgentChatEvent[] = [];
  await runAgentLoop({
    engine: engineWith(turns, seenTools),
    model: "test-model",
    systemPrompt: "system",
    tools: allTools.filter((t) => initialNames.includes(t.name)),
    availableTools: allTools,
    messages,
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
  return { seenTools, searchResults };
}

const userText = (text: string): EngineMessage => ({
  role: "user",
  content: [{ type: "text", text }],
});

/** A resumed run: the model's searches, their stored results, then the prompt to continue. */
function resumedHistory(
  searches: Array<{ input: Record<string, unknown>; content: string }>,
): EngineMessage[] {
  return [
    userText("go"),
    {
      role: "assistant",
      content: searches.map((search, index) =>
        searchCall(`s${index}`, search.input),
      ),
    },
    {
      role: "user",
      content: searches.map((search, index) => ({
        type: "tool-result" as const,
        toolCallId: `s${index}`,
        toolName: "tool-search",
        toolInput: JSON.stringify(search.input),
        content: search.content,
      })),
    },
    userText("continue"),
  ];
}

const registry = () => ({
  starter: tool("Starter tool"),
  "alpha-tool": tool("Alpha reporting capability"),
  "beta-tool": tool("Beta forecasting capability"),
});

const INITIAL = ["starter", "tool-search"];

describe("tool-search results on a continued run", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("restores the tools a search loaded from its stored result, notes and all", async () => {
    const first = await run(
      registry(),
      INITIAL,
      [userText("go")],
      [[searchCall("s1", { query: "alpha reporting" })]],
    );
    expect(first.searchResults[0]).toContain("Loaded matching tool schemas");
    expect(first.seenTools[1]).toContain("alpha-tool");

    const continued = await run(
      registry(),
      INITIAL,
      resumedHistory([
        {
          input: { query: "alpha reporting" },
          content: first.searchResults[0],
        },
      ]),
    );
    expect(continued.seenTools[0]).toEqual([...INITIAL, "alpha-tool"]);
  });

  it("restores the matches of a result stored before the loaded list existed", async () => {
    const legacyObject = JSON.stringify(
      {
        query: "beta forecasting",
        totalTools: 3,
        count: 1,
        results: [
          {
            name: "beta-tool",
            kind: "action",
            description: "Beta forecasting capability",
            score: 20,
            callable: true,
            planAvailability: "read",
            parameters: [],
          },
        ],
      },
      null,
      2,
    );
    const continued = await run(
      registry(),
      INITIAL,
      resumedHistory([
        {
          input: { query: "beta forecasting" },
          content: `${legacyObject}\n\nLoaded matching tool schemas for next step: beta-tool`,
        },
      ]),
    );
    expect(continued.seenTools[0]).toEqual([...INITIAL, "beta-tool"]);
  });

  it("restores the same tools after replayed history clips a large result", async () => {
    const wide = {
      starter: tool("Starter tool"),
      ...Object.fromEntries(
        Array.from({ length: 10 }, (_, index) => [
          `report-${index}`,
          tool(`Report ${index} capability`, 8),
        ]),
      ),
    };
    const first = await run(
      wide,
      INITIAL,
      [userText("go")],
      [[searchCall("s1", { query: "report capability" })]],
    );
    const stored = first.searchResults[0];
    expect(stored.length).toBeGreaterThan(12_000);
    const loaded = first.seenTools[1].filter((name) =>
      name.startsWith("report-"),
    );
    expect(loaded.length).toBeGreaterThan(0);

    const replayed = threadDataToEngineMessages(
      {
        messages: [
          {
            message: {
              id: "u1",
              role: "user",
              content: [{ type: "text", text: "go" }],
            },
          },
          {
            message: {
              id: "a1",
              role: "assistant",
              content: [
                {
                  type: "tool-call",
                  toolCallId: "s1",
                  toolName: "tool-search",
                  args: { query: "report capability" },
                  result: stored,
                },
              ],
            },
          },
        ],
      },
      { includeToolCalls: true },
    );
    const replayedResult = replayed
      .flatMap((message) => message.content)
      .find((part) => part.type === "tool-result");
    expect(replayedResult).toMatchObject({
      content: expect.stringContaining("[Tool result truncated"),
    });

    const continued = await run(wide, INITIAL, replayed);
    expect(continued.seenTools[0]).toEqual([...INITIAL, ...loaded]);
  });

  it("restores only what a search loaded when others did not fit the cap", async () => {
    const groups = ["aa", "bb", "cc", "dd", "ee", "ff", "gg"];
    const names = (group: string) =>
      Array.from(
        { length: 20 },
        (_, index) => `${group}-${String(index).padStart(2, "0")}`,
      );
    const flood = Object.fromEntries(
      groups.flatMap((group) =>
        names(group).map((name) => [name, tool(`${name} capability`)]),
      ),
    );
    const searches = groups.map((group, index) => ({
      call: searchCall(`flood-${index}`, { names: names(group) }),
      input: { names: names(group) },
    }));
    const first = await run(
      flood,
      ["tool-search"],
      [userText("go")],
      [searches.map((search) => search.call)],
    );
    const loaded = first.seenTools[1];
    expect(loaded).toHaveLength(MAX_PROVIDER_TOOLS);
    expect(first.searchResults.join("\n")).toContain("Could not load");

    const continued = await run(
      flood,
      ["tool-search"],
      resumedHistory(
        searches.map((search, index) => ({
          input: search.input,
          content: first.searchResults[index],
        })),
      ),
    );
    expect(new Set(continued.seenTools[0])).toEqual(new Set(loaded));
    expect(continued.seenTools[0]).toHaveLength(MAX_PROVIDER_TOOLS);
  });

  it("restores nothing from an unreadable result, and says so", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const clipped =
      '{\n  "query": "alpha reporting",\n  "totalTools": 3,\n  "results": [\n    {\n      "name": "alpha-tool",\n      "kind": "act';
    const continued = await run(
      registry(),
      INITIAL,
      resumedHistory([
        {
          input: { query: "alpha reporting" },
          content: `${clipped}\n\n...[truncated — full result was 20,000 chars]`,
        },
      ]),
    );
    expect(continued.seenTools[0]).toEqual(INITIAL);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(
        "1 earlier tool-search result(s) could not be read",
      ),
    );
  });

  it("does not report a failed or interrupted search as unreadable", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const continued = await run(
      registry(),
      INITIAL,
      resumedHistory([
        {
          input: { query: "alpha reporting" },
          content: "Interrupted before this tool returned a result.",
        },
        {
          input: { query: "beta forecasting" },
          content: "Error running tool-search: boom",
        },
      ]),
    );
    expect(continued.seenTools[0]).toEqual(INITIAL);
    expect(warn).not.toHaveBeenCalled();
  });

  it("bounds the restored tools by the provider cap, newest searches first", async () => {
    const batch = (group: string) =>
      Array.from(
        { length: 20 },
        (_, index) => `${group}-${String(index).padStart(2, "0")}`,
      );
    const groups = ["aa", "bb", "cc", "dd", "ee", "ff", "gg", "hh"];
    const many = Object.fromEntries(
      groups.flatMap((group) =>
        batch(group).map((name) => [name, tool(`${name} capability`)]),
      ),
    );
    const continued = await run(
      many,
      ["tool-search"],
      resumedHistory(
        groups.map((group) => ({
          input: { names: batch(group) },
          content: JSON.stringify(
            {
              loadedForNextStep: batch(group),
              query: `names: ${batch(group).join(", ")}`,
              results: [],
            },
            null,
            2,
          ),
        })),
      ),
    );
    const active = continued.seenTools[0];
    expect(active).toHaveLength(MAX_PROVIDER_TOOLS);
    expect(active).toContain("tool-search");
    expect(active).toEqual(expect.arrayContaining(batch("hh")));
    expect(active).toEqual(expect.arrayContaining(batch("ff")));
    expect(active).not.toContain("aa-00");
  });
});
