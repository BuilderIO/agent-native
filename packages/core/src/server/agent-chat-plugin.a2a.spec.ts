import { describe, expect, it, vi } from "vitest";

import { loadActionsFromStaticRegistry } from "./action-discovery.js";
import {
  assembleA2AFinalResponse,
  buildPublicAgentA2ASkills,
  createA2AEngineToolSurface,
  runA2AAgentLoop,
} from "./agent-chat-plugin.js";

describe("delegated A2A final response guards", () => {
  it("runs an Analytics-style real-data guard for delegated turns", async () => {
    const analyticsGuard = vi.fn(
      (context: { text: string; toolResults: unknown[] }) =>
        context.toolResults.length === 0 && context.text.includes("42")
          ? {
              retryMessage: "Query a real analytics source before answering.",
              fallbackMessage: "No grounded analytics result is available.",
            }
          : null,
    );
    const delegatedRunner = vi.fn(async (options: any) => {
      const guardResult = await options.finalResponseGuard?.({
        messages: options.messages,
        assistantContent: [{ type: "text", text: "The answer is 42." }],
        text: "The answer is 42.",
        toolCalls: [],
        toolResults: [],
        retryCount: 0,
        executionMode: "act",
      });
      expect(guardResult).toEqual({
        retryMessage: "Query a real analytics source before answering.",
        fallbackMessage: "No grounded analytics result is available.",
      });
      return {
        inputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        model: "test-model",
      };
    });

    await runA2AAgentLoop(
      {
        engine: {} as any,
        model: "test-model",
        systemPrompt: "system",
        tools: [],
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "What were sales this week?" }],
          },
        ],
        actions: {},
        send: () => {},
        signal: new AbortController().signal,
      },
      {
        finalResponseGuard: analyticsGuard as any,
        runSoftTimeoutMs: 12_345,
      },
      { backgroundFunction: true },
      delegatedRunner as any,
    );

    expect(analyticsGuard).toHaveBeenCalledOnce();
    expect(delegatedRunner).toHaveBeenCalledWith(
      expect.objectContaining({ finalResponseGuard: analyticsGuard }),
      12_345,
      { backgroundFunction: true },
    );
  });
});

describe("delegated A2A tool surface", () => {
  const tool = (name: string) => ({
    name,
    description: `${name} description`,
    inputSchema: { type: "object" as const },
  });

  it("starts with configured tools plus tool-search and retains the full registry for discovery", () => {
    const availableTools = [
      tool("starter"),
      tool("tool-search"),
      tool("rare-analytics-action"),
    ];

    const surface = createA2AEngineToolSurface(availableTools, ["starter"]);

    expect(surface.tools.map((entry) => entry.name)).toEqual([
      "starter",
      "tool-search",
    ]);
    // `runAgentLoop` uses this full list to load a matched schema after the
    // initial `tool-search` call, rather than forcing the whole registry into
    // the first model request.
    expect(surface.availableTools.map((entry) => entry.name)).toEqual([
      "starter",
      "tool-search",
      "rare-analytics-action",
    ]);
  });

  it("keeps the existing full A2A tool surface without an initial allow-list", () => {
    const availableTools = [tool("starter"), tool("tool-search"), tool("rare")];

    const surface = createA2AEngineToolSurface(availableTools);

    expect(surface.tools).toBe(availableTools);
    expect(surface.availableTools).toBe(availableTools);
  });

  // agent-chat-plugin.ts's MCP `ask_app` inner loop (the `askAgent` closure
  // passed to `mountMCP`) reuses this exact helper with the same
  // `effectiveInitialToolNames` the interactive chat path uses, instead of
  // handing `actionsToEngineTools(mcpActions)` straight to the engine
  // unfiltered. Before that fix, every external host calling `ask_app` over
  // MCP triggered a near-full-catalog first request, undermining the compact
  // MCP catalog this surface exists to keep external callers on. This test
  // locks in the same compaction guarantee for a registry shaped like the
  // MCP loop's (template action + a much larger set of framework additions —
  // resource/docs/chat/fetch/web-search/workspace-files/tool/MCP entries).
  it("compacts the MCP ask_app inner loop's first request the same way as A2A", () => {
    const availableTools = [
      tool("template-app-action"),
      tool("tool-search"),
      tool("list-integration-memory"),
      tool("provider-api-request"),
      tool("mcp__some-server__some-tool"),
    ];

    const surface = createA2AEngineToolSurface(availableTools, [
      "template-app-action",
    ]);

    expect(surface.tools.map((entry) => entry.name)).toEqual([
      "template-app-action",
      "tool-search",
    ]);
    // The full registry is preserved separately so `runAgentLoop`'s mid-run
    // tool-search expansion (`expandActiveTools` in production-agent.ts,
    // exercised end-to-end in production-agent.spec.ts's "expands the
    // provider tool list after tool-search returns matches") can still load
    // any of these once the model searches for them.
    expect(surface.availableTools).toBe(availableTools);
  });
});

describe("agent-chat A2A public skills", () => {
  it("advertises Brain retrieval actions from the static registry in dev mode", () => {
    const publicAgent = {
      expose: true,
      readOnly: true,
      requiresAuth: false,
      isConsequential: false,
    };
    const actions = loadActionsFromStaticRegistry({
      "search-knowledge": {
        default: {
          tool: {
            description:
              "Search Brain knowledge with SQL text matching over title, summary, and body.",
            parameters: {},
          },
          http: { method: "GET" },
          readOnly: true,
          publicAgent,
          run: async () => ({ knowledge: [] }),
        },
      },
      "search-everything": {
        default: {
          tool: {
            description:
              "Search Brain company memory across published knowledge, accessible raw captures, and accessible source records.",
            parameters: {},
          },
          http: { method: "GET" },
          readOnly: true,
          publicAgent,
          run: async () => ({ results: [] }),
        },
      },
      "write-note": {
        default: {
          tool: { description: "Write a private note.", parameters: {} },
          readOnly: false,
          run: async () => ({ ok: true }),
        },
      },
    });

    const skills = buildPublicAgentA2ASkills(actions);

    expect(skills.map((skill) => skill.id)).toEqual([
      "search-knowledge",
      "search-everything",
    ]);
    expect(skills).toEqual([
      expect.objectContaining({
        id: "search-knowledge",
        description:
          "Search Brain knowledge with SQL text matching over title, summary, and body.",
        publicAgent,
      }),
      expect.objectContaining({
        id: "search-everything",
        description:
          "Search Brain company memory across published knowledge, accessible raw captures, and accessible source records.",
        publicAgent,
      }),
    ]);
  });
});

describe("assembleA2AFinalResponse", () => {
  it("fails terminal agent errors instead of completing with no response", () => {
    expect(() =>
      assembleA2AFinalResponse(
        [
          { type: "clear" },
          {
            type: "error",
            error: "I ran out of time before finishing this step.",
            errorCode: "run_budget_exhausted",
            recoverable: true,
          },
        ],
        [],
      ),
    ).toThrow(/run_budget_exhausted/);
  });

  it("still returns recoverable artifact links from a terminal error run", () => {
    const result = assembleA2AFinalResponse(
      [
        { type: "tool_start", tool: "update-dashboard", input: {} },
        {
          type: "tool_done",
          tool: "update-dashboard",
          result: JSON.stringify({
            id: "growth-funnel",
            name: "Growth Funnel",
            urlPath: "/adhoc/growth-funnel",
          }),
        },
        {
          type: "error",
          error: "The follow-up summary was interrupted.",
          errorCode: "stream_ended",
          recoverable: true,
        },
      ],
      [
        {
          tool: "update-dashboard",
          result: JSON.stringify({
            id: "growth-funnel",
            name: "Growth Funnel",
            urlPath: "/adhoc/growth-funnel",
          }),
        },
      ],
      { baseUrl: "https://analytics.agent.test" },
    );

    expect(result.finalText).toContain(
      'Dashboard "Growth Funnel": https://analytics.agent.test/adhoc/growth-funnel',
    );
  });
});
