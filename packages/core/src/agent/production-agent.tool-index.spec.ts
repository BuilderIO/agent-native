import { describe, expect, it } from "vitest";

import { SYSTEM_PROMPT_CACHE_SPLIT } from "./engine/prompt-cache.js";
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
import { attachToolSearch } from "./tool-search.js";

function tool(description: string): ActionEntry {
  return {
    tool: { description, parameters: { type: "object", properties: {} } },
    readOnly: true,
    run: async () => `ran ${description}`,
  };
}

const registry = {
  starter: tool("Starter tool"),
  "create-dashboard": tool("Create a dashboard"),
  "list-dashboards": tool("List dashboards"),
  "send-email": tool("Send an email"),
};

async function run(opts: {
  systemPrompt: string;
  turns?: EngineContentPart[][];
  messages?: EngineMessage[];
  followUpSuggestions?: boolean;
}) {
  const actions = attachToolSearch(registry);
  const allTools = actionsToEngineTools(actions);
  const prompts: string[] = [];
  const sentMessages: EngineMessage[][] = [];
  let calls = 0;
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
    async *stream(streamOpts): AsyncIterable<EngineEvent> {
      prompts.push(streamOpts.systemPrompt);
      sentMessages.push(streamOpts.messages);
      const parts = opts.turns?.[calls++] ?? [{ type: "text", text: "done" }];
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
    systemPrompt: opts.systemPrompt,
    tools: allTools.filter((t) => ["starter", "tool-search"].includes(t.name)),
    availableTools: allTools,
    followUpSuggestions: opts.followUpSuggestions,
    runId: opts.followUpSuggestions ? "tool-index-run" : undefined,
    messages: opts.messages ?? [
      { role: "user", content: [{ type: "text", text: "go" }] },
    ],
    actions,
    send: () => {},
    signal: new AbortController().signal,
  });
  return { prompts, sentMessages };
}

describe("runAgentLoop tool index", () => {
  it("names every deferred tool in the cached prefix, not the declared ones", async () => {
    const { prompts } = await run({
      systemPrompt: `stable rules${SYSTEM_PROMPT_CACHE_SPLIT}volatile context`,
    });
    const [stable, volatile] = prompts[0].split(SYSTEM_PROMPT_CACHE_SPLIT);

    expect(stable).toContain("## Tool index");
    expect(stable).toContain("- dashboard: create-dashboard, list-dashboards");
    expect(stable).toContain("send-email");
    expect(stable).not.toMatch(/- other:.*starter/);
    expect(stable).not.toMatch(/: .*tool-search/);
    expect(volatile).toBe("volatile context");
  });

  it("keeps the index identical after a search loads one of the tools", async () => {
    const { prompts } = await run({
      systemPrompt: "rules",
      turns: [
        [
          {
            type: "tool-call",
            id: "s1",
            name: "tool-search",
            input: { names: ["send-email"] },
          },
        ],
      ],
    });

    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toBe(prompts[0]);
    expect(prompts[0]).toContain("send-email");
  });

  it("keeps the index on the production turn that requests follow-up suggestions", async () => {
    const { prompts } = await run({
      systemPrompt: "rules",
      followUpSuggestions: true,
      turns: [
        [{ type: "text", text: "done" }],
        [
          {
            type: "tool-call",
            id: "suggestions",
            name: "follow-up-suggestions",
            input: {
              suggestions: [{ label: "Refine it", prompt: "Refine it" }],
            },
          },
        ],
      ],
    });

    expect(prompts[0]).toContain("## Tool index");
    expect(prompts[0]).toContain("send-email");
    expect(prompts[1]).not.toContain("## Tool index");
  });

  it("tells the model when an earlier tool-search result cannot be restored", async () => {
    const { sentMessages } = await run({
      systemPrompt: "rules",
      messages: [
        { role: "user", content: [{ type: "text", text: "first" }] },
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              id: "old",
              name: "tool-search",
              input: { query: "dashboards" },
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "tool-result",
              toolCallId: "old",
              toolName: "tool-search",
              content: '{"query": "dashboards", "results": [',
            },
            { type: "text", text: "again" },
          ],
        },
      ],
    });
    const lastUser = sentMessages[0].at(-1);
    const notes = (lastUser?.content ?? []).flatMap((part) =>
      part.type === "text" ? [part.text] : [],
    );

    expect(
      notes.filter((text) =>
        text.startsWith("Earlier tool-search results could not be read"),
      ),
    ).toHaveLength(1);
  });
});
