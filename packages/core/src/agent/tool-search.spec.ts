import { afterEach, describe, expect, it, vi } from "vitest";

import {
  mcpToolsToActionEntries,
  type McpClientManager,
  type McpTool,
} from "../mcp-client/index.js";
import { frameworkMcpTool } from "../mcp/framework-tools.js";
import { runWithRequestContext } from "../server/request-context.js";
import type { ActionEntry } from "./production-agent.js";
import {
  attachToolSearch,
  createToolSearchEntry,
  extractToolSearchResultNames,
  filterActionsForAgentDiscovery,
  isTargetedToolSearch,
  readLoadedToolNames,
  searchToolRegistry,
  searchToolRegistryForRequest,
  TOOL_SEARCH_ACTION_NAME,
  withLoadedToolNames,
} from "./tool-search.js";

function action(
  description: string,
  properties: Record<string, unknown> = {},
  required: string[] = [],
): ActionEntry {
  return {
    tool: {
      description,
      parameters: {
        type: "object",
        properties,
        required,
      },
    },
    http: false,
    readOnly: true,
    run: async () => "(ok)",
  };
}

describe("tool-search", () => {
  it("ranks task candidates through the server boundary and keeps lexical fallback labelled", async () => {
    const registry = {
      "list-events": action("List calendar events"),
      "send-email": action("Send email"),
    };
    const rank = vi.fn(async () => ({
      status: "selected" as const,
      ids: ["send-email"],
    }));
    const selected = await searchToolRegistryForRequest(
      registry,
      { task: "calendar" },
      { taskRank: rank },
    );
    expect(selected).toMatchObject({
      ranking: "jev",
      status: "selected",
      recommendations: [
        { name: "send-email", kind: "tool", use: { type: "tools/call" } },
      ],
    });
    expect(rank).toHaveBeenCalledOnce();
    const fallback = await searchToolRegistryForRequest(
      registry,
      { task: "calendar" },
      { taskRank: async () => ({ status: "unavailable", ids: [] }) },
    );
    expect(fallback).toMatchObject({
      ranking: "bm25",
      status: "unavailable",
      recommendations: [{ name: "list-events" }],
    });
  });

  it("does not poison a later lexical search with task baseline cache", async () => {
    const registry = { "list-events": action("List calendar events") };
    await runWithRequestContext(
      { userEmail: "agent@example.com", run: {} },
      async () => {
        await searchToolRegistryForRequest(registry, { task: "calendar" });
        const result = searchToolRegistry(registry, { query: "calendar" });
        expect(result.repeated).toBeUndefined();
        expect(result.results[0]?.description).toBe("List calendar events");
      },
    );
  });

  it("orders task fallback by BM25 score rather than registry insertion", async () => {
    const registry = {
      "other-calendar": action("Calendar archive"),
      "calendar-events": action("Calendar events and availability"),
    };
    const result = await searchToolRegistryForRequest(registry, {
      task: "calendar events",
    });
    expect(result.recommendations?.[0]?.name).toBe("calendar-events");
  });

  it("bounds a stalled candidate provider and never returns unfiltered data", async () => {
    const registry = { "list-events": action("List calendar events") };
    const result = await searchToolRegistryForRequest(
      registry,
      { task: "calendar" },
      {
        taskDeadline: Date.now() + 20,
        taskCandidateProvider: async () => new Promise(() => {}),
      },
    );
    expect(result).toMatchObject({
      ranking: "bm25",
      status: "timed_out",
      recommendations: [],
    });
  });

  it("includes tool parameter descriptions in task BM25 fallback", async () => {
    const registry = {
      send: action("Dispatch a message", {
        to: { type: "string", description: "recipient address" },
      }),
    };
    const result = await searchToolRegistryForRequest(registry, {
      task: "recipient address",
    });
    expect(result.recommendations?.map((item) => item.name)).toEqual(["send"]);
  });

  it("does not start ranking after the caller cancels candidate discovery", async () => {
    const controller = new AbortController();
    const rank = vi.fn(async () => ({
      status: "selected" as const,
      ids: ["list-events"],
    }));
    const result = await searchToolRegistryForRequest(
      { "list-events": action("List calendar events") },
      { task: "calendar" },
      {
        taskRank: rank,
        taskCandidateProvider: async () => {
          controller.abort();
          return [];
        },
      },
      { caller: "mcp", signal: controller.signal },
    );
    expect(result.status).toBe("failed");
    expect(rank).not.toHaveBeenCalled();
  });

  it("honors the result limit for ranked recommendations", async () => {
    const result = await searchToolRegistryForRequest(
      { one: action("calendar one"), two: action("calendar two") },
      { task: "calendar", limit: 1 },
      { taskRank: async () => ({ status: "selected", ids: ["one", "two"] }) },
    );
    expect(result.recommendations?.map((item) => item.name)).toEqual(["one"]);
    expect(result.results).toHaveLength(1);
  });

  it("rejects an oversized task without calling the provider", async () => {
    const rank = vi.fn();
    const result = await searchToolRegistryForRequest(
      { one: action("calendar") },
      { task: "x".repeat(5000) },
      { taskRank: rank },
    );
    expect(result).toMatchObject({
      ranking: "bm25",
      status: "failed",
      recommendations: [],
    });
    expect(rank).not.toHaveBeenCalled();
  });

  it("marks an advertised action callable for MCP independently of plan-mode policy", async () => {
    const registry = {
      write: { ...action("write changes"), allowInPlanMode: false },
    };
    const result = await searchToolRegistryForRequest(
      registry,
      { task: "write" },
      {},
      { caller: "mcp" },
    );
    expect(result.recommendations?.[0]?.callable).toBe(true);
  });

  it("does not rank provider-supplied tools outside the authorized registry", async () => {
    const rank = vi.fn(async (_task, candidates) => ({
      status: "selected" as const,
      ids: candidates.map((item) => item.id),
    }));
    const result = await searchToolRegistryForRequest(
      { allowed: action("allowed action") },
      { task: "action" },
      {
        taskRank: rank,
        taskCandidates: [
          {
            id: "denied",
            name: "denied",
            kind: "tool",
            description: "action",
            use: { type: "tools/call" },
            callable: true,
            reason: "test",
          },
        ],
      },
    );
    expect(result.recommendations?.map((item) => item.name)).not.toContain(
      "denied",
    );
    expect(rank.mock.calls[0]?.[1].map((item) => item.id)).not.toContain(
      "denied",
    );
  });

  it("reports when task mode cannot load explicit names in the same call", async () => {
    const result = await searchToolRegistryForRequest(
      { one: action("one") },
      { task: "find one", names: ["one"] },
    );
    expect(result.message).toContain("names");
  });

  it("does not expose app recommendations when read-only filtering removes open_app", async () => {
    const provider = vi.fn(async () => [
      {
        id: "app:alpha",
        name: "Alpha",
        kind: "app" as const,
        description: "alpha",
        use: { type: "open_app" as const, app: "alpha", path: "/" },
        callable: true,
        reason: "test",
      },
    ]);
    const result = await searchToolRegistryForRequest(
      { open_app: { ...action("open alpha"), readOnly: false } },
      { task: "alpha", readOnlyOnly: true },
      { taskCandidateProvider: provider },
    );
    expect(result.recommendations).toEqual([]);
    expect(provider.mock.calls[0]?.[0].callableActionNames).not.toContain(
      "open_app",
    );
  });

  it("fails closed on malformed app invocation metadata", async () => {
    const rank = vi.fn();
    const result = await searchToolRegistryForRequest(
      { open_app: action("open an app") },
      { task: "open app" },
      {
        taskRank: rank,
        taskCandidateProvider: async () => [
          {
            id: "app:broken",
            kind: "app",
            name: "Broken",
            description: "app",
            callable: true,
            reason: "test",
            use: { type: "open_app" },
          } as any,
        ],
      },
    );
    expect(result).toMatchObject({ status: "failed", recommendations: [] });
    expect(rank).not.toHaveBeenCalled();
  });

  it("loads authorized BM25 matches when the ranker fails", async () => {
    const result = await searchToolRegistryForRequest(
      { "list-events": action("calendar events") },
      { task: "calendar" },
      { taskRank: async () => ({ status: "failed", ids: [] }) },
    );
    expect(result).toMatchObject({
      ranking: "bm25",
      status: "failed",
      recommendations: [{ name: "list-events" }],
    });
    expect(extractToolSearchResultNames(result)).toEqual(["list-events"]);
  });

  it("keeps authorized tool fallback when supplemental candidate discovery fails", async () => {
    const result = await searchToolRegistryForRequest(
      { "list-events": action("calendar events") },
      { task: "calendar" },
      {
        taskCandidateProvider: async () => {
          throw new Error("supplemental source unavailable");
        },
      },
    );
    expect(result).toMatchObject({
      ranking: "bm25",
      status: "failed",
      recommendations: [{ name: "list-events" }],
    });
    expect(result.message).toMatch(/supplemental/i);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("searches action names, descriptions, and parameter metadata", () => {
    const registry = {
      "send-email": action(
        "Send an email message",
        {
          to: { type: "string", description: "Recipient email address" },
          subject: { type: "string", description: "Email subject line" },
        },
        ["to"],
      ),
      "list-events": action("List calendar events"),
    };

    const result = searchToolRegistry(registry, {
      query: "email subject",
      limit: 1,
    });

    expect(result.count).toBe(1);
    expect(result.results[0]).toMatchObject({
      name: "send-email",
      kind: "action",
      parameters: [
        {
          name: "to",
          type: "string",
          required: true,
        },
        {
          name: "subject",
          type: "string",
          required: false,
        },
      ],
    });
  });

  it("filters feature-gated actions per requesting user before search", async () => {
    const available = vi.fn(
      (context?: { userEmail?: string }) =>
        context?.userEmail === "enabled@example.test",
    );
    const registry = {
      "list-context-packs": {
        ...action("List Creative Context packs"),
        agentDiscoveryAvailable: available,
      },
      "read-context-source": {
        ...action("Read a Creative Context source"),
        agentDiscoveryAvailable: available,
      },
      "list-calendar-events": action("List calendar events"),
    };
    const toolSearch = createToolSearchEntry(() => registry);

    const disabled = await toolSearch.run(
      {},
      {
        caller: "tool",
        userEmail: "disabled@example.test",
      },
    );
    expect(
      disabled.results.map((result: { name: string }) => result.name),
    ).toEqual(["list-calendar-events"]);
    expect(available).toHaveBeenCalledOnce();
    expect(available).toHaveBeenCalledWith({
      caller: "tool",
      userEmail: "disabled@example.test",
    });

    available.mockClear();
    const enabled = await toolSearch.run(
      { query: "Creative Context" },
      { caller: "tool", userEmail: "enabled@example.test" },
    );
    expect(
      enabled.results.map((result: { name: string }) => result.name),
    ).toEqual(["list-context-packs", "read-context-source"]);
    expect(available).toHaveBeenCalledOnce();
  });

  it("filters gated actions from request tools and rebinds tool-search", async () => {
    const available = vi.fn(async () => false);
    const registry = attachToolSearch({
      "list-context-packs": {
        ...action("List Creative Context packs"),
        agentDiscoveryAvailable: available,
      },
      "list-calendar-events": action("List calendar events"),
    });

    const filtered = await filterActionsForAgentDiscovery(registry, {
      caller: "tool",
      userEmail: "disabled@example.test",
    });

    expect(filtered).not.toHaveProperty("list-context-packs");
    const menu = await filtered[TOOL_SEARCH_ACTION_NAME]!.run(
      {},
      {
        caller: "tool",
        userEmail: "disabled@example.test",
      },
    );
    expect(menu.results.map((result: { name: string }) => result.name)).toEqual(
      ["list-calendar-events"],
    );
  });

  it("labels Plan availability and current callability without returning schemas", () => {
    const read = action("Inspect records");
    const conditional = {
      ...action("Query or persist provider records"),
      planMode: {
        effect: (args: any): "read" | "write" =>
          args.persist ? "write" : "read",
      },
    };
    const blocked = {
      ...action("Delete provider records"),
      readOnly: false,
      allowInPlanMode: false,
    };

    const result = searchToolRegistry(
      {
        inspect: read,
        provider: conditional,
        delete: blocked,
      },
      { query: "provider records", includeSchemas: true },
    );

    expect(result.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "provider",
          callable: true,
          planAvailability: "conditional",
        }),
        expect.objectContaining({
          name: "delete",
          callable: false,
          planAvailability: "act-only",
        }),
      ]),
    );
    for (const tool of result.results) {
      expect(tool).not.toHaveProperty("inputSchema");
    }
  });

  it("can restrict results to read-only or conditionally read-only tools", () => {
    const mcpTool = {
      source: "zapier",
      name: "mcp__zapier__list_records",
      originalName: "list_records",
      description: "List provider records through Zapier",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true },
      raw: {},
    } satisfies McpTool;
    const mcpEntries = mcpToolsToActionEntries({
      getTools: () => [mcpTool],
    } as unknown as McpClientManager);

    expect(mcpEntries[mcpTool.name].readOnly).toBe(true);
    expect(typeof mcpEntries[mcpTool.name].planMode?.effect).toBe("function");

    const result = searchToolRegistry(
      {
        inspect: action("Inspect provider records"),
        conditional: {
          ...action("Query or persist provider records"),
          planMode: {
            effect: (args: any): "read" | "write" =>
              args.persist ? "write" : "read",
          },
        },
        write: {
          ...action("Write provider records"),
          readOnly: false,
        },
        actOnly: {
          ...action("Inspect records after approval"),
          allowInPlanMode: false,
        },
        ...mcpEntries,
      },
      { query: "provider records", includeSchemas: true, readOnlyOnly: true },
    );

    expect(result.totalTools).toBe(3);
    expect(result.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "inspect",
          planAvailability: "read",
        }),
        expect.objectContaining({
          name: "conditional",
          planAvailability: "conditional",
        }),
        expect.objectContaining({
          name: "mcp__zapier__list_records",
          kind: "mcp",
          planAvailability: "conditional",
        }),
      ]),
    );
    for (const tool of result.results) {
      expect(tool).not.toHaveProperty("inputSchema");
    }
  });

  it("includes connected MCP tools and reports their source server", async () => {
    const registry = attachToolSearch({
      mcp__zapier__send_slack_message: action(
        "Send a Slack message through Zapier",
        {
          channel: { type: "string", description: "Slack channel" },
          text: { type: "string", description: "Message body" },
        },
        ["channel", "text"],
      ),
    });

    const result = await registry["tool-search"].run({
      query: "zapier slack",
      includeSchemas: "true",
    } as any);

    expect(result.results[0]).toMatchObject({
      name: "mcp__zapier__send_slack_message",
      kind: "mcp",
      source: "zapier",
    });
    expect(result.results[0]).not.toHaveProperty("inputSchema");
  });

  it("searches the live registry after MCP tools are added", async () => {
    const registry = attachToolSearch({
      "list-documents": action("List documents"),
    });

    expect(
      await registry["tool-search"].run({ query: "browser screenshot" } as any),
    ).toMatchObject({ count: 0 });

    registry["mcp__chrome__take_screenshot"] = action(
      "Take a browser screenshot",
    );

    const result = await registry["tool-search"].run({
      query: "browser screenshot",
    } as any);

    expect(result.results.map((tool) => tool.name)).toContain(
      "mcp__chrome__take_screenshot",
    );
  });

  it("ranks named provider tools above generic warehouse tools", () => {
    const registry = {
      bigquery: action(
        "Query the user-configured BigQuery data warehouse. Use this for warehouse SQL, not as a substitute for Jira or Pylon provider data.",
      ),
      "pylon-issues": action(
        "Query Pylon support issues and customer accounts. Use this first for Pylon support ticket data.",
      ),
      jira: action(
        "Query Jira issues, bugs, tickets, boards, sprints, and project tracking.",
      ),
      "jira-search": action("Search Jira issues and bugs using JQL."),
    };

    expect(
      searchToolRegistry(registry, { query: "pylon support issues" }).results[0]
        ?.name,
    ).toBe("pylon-issues");
    expect(
      searchToolRegistry(registry, { query: "jira bugs" }).results[0]?.name,
    ).toMatch(/^jira/);
  });

  it("honors MCP request visibility for scoped connected servers", () => {
    vi.stubEnv("NODE_ENV", "production");
    const registry = {
      mcp__user_deadbeef00_zapier__send_slack_message: action(
        "Send a Slack message through Zapier",
      ),
    };

    const result = searchToolRegistry(registry, {
      query: "zapier slack",
    });

    expect(result).toMatchObject({ totalTools: 0, count: 0, results: [] });
  });

  describe("menu mode (no query)", () => {
    it("lists every tool by name sorted alphabetically with empty parameters and no schema", () => {
      const registry = {
        "send-email": action(
          "Send an email message",
          {
            to: { type: "string", description: "Recipient email address" },
            subject: { type: "string", description: "Email subject line" },
          },
          ["to"],
        ),
        "list-events": action("List calendar events"),
        "create-doc": action(
          "Create a document",
          { title: { type: "string" } },
          ["title"],
        ),
      };

      const result = searchToolRegistry(registry, {});

      expect(result.query).toBe("");
      expect(result.totalTools).toBe(3);
      expect(result.count).toBe(3);
      expect(result.count).toBe(result.results.length);
      expect(result.results.map((tool) => tool.name)).toEqual([
        "create-doc",
        "list-events",
        "send-email",
      ]);
      for (const tool of result.results) {
        expect(tool.parameters).toEqual([]);
        expect(tool.score).toBe(0);
        expect(tool).not.toHaveProperty("inputSchema");
      }
      const sendEmail = result.results.find(
        (tool) => tool.name === "send-email",
      );
      expect(sendEmail?.description).toBe("Send an email message");
    });

    it("treats whitespace-only and omitted queries the same as no query", () => {
      const registry = {
        alpha: action("Alpha tool"),
        beta: action("Beta tool"),
      };

      const blank = searchToolRegistry(registry, { query: "   " });
      const omitted = searchToolRegistry(registry, {});

      expect(blank.query).toBe("");
      expect(blank.count).toBe(2);
      expect(blank.results.map((t) => t.name)).toEqual(["alpha", "beta"]);
      expect(blank.results).toEqual(omitted.results);
    });

    it("caps menu descriptions", () => {
      const result = searchToolRegistry(
        { help: action("Tool description ".repeat(30)) },
        {},
      );

      expect(result.results[0].description.length).toBeLessThanOrEqual(140);
    });

    it("honors the requested limit and enforces the hard result cap", () => {
      const registry: Record<string, ActionEntry> = {};
      for (let i = 0; i < 30; i++) {
        const name = `tool-${String(i).padStart(2, "0")}`;
        registry[name] = action(`Tool number ${i}`);
      }

      const result = searchToolRegistry(registry, {});

      expect(result.totalTools).toBe(30);
      expect(result.count).toBe(8);
      expect(result.results).toHaveLength(8);
      expect(result.results[0].name).toBe("tool-00");
      expect(result.results[7].name).toBe("tool-07");

      const withLimit = searchToolRegistry(registry, { limit: 5 });
      expect(withLimit.count).toBe(5);
      expect(withLimit.results).toHaveLength(5);

      const aboveHardCap = searchToolRegistry(
        registry,
        { limit: 100 },
        { maxLimit: 100 },
      );
      expect(aboveHardCap.count).toBe(10);
      expect(aboveHardCap.results).toHaveLength(10);
      expect(aboveHardCap.message).toContain("Showing 10 of 30");
    });

    it("never includes the tool-search entry itself in its own menu results", () => {
      const registry = attachToolSearch({
        "send-email": action("Send an email message"),
        "list-events": action("List calendar events"),
      });

      const result = searchToolRegistry(registry, {});

      expect(result.results.map((tool) => tool.name)).not.toContain(
        TOOL_SEARCH_ACTION_NAME,
      );
      expect(result.totalTools).toBe(2);
      expect(result.count).toBe(2);
    });

    it("never includes inputSchema in menu mode even when includeSchemas is true", () => {
      const registry = {
        "send-email": action(
          "Send an email message",
          { to: { type: "string" } },
          ["to"],
        ),
      };

      const result = searchToolRegistry(registry, {
        query: "",
        includeSchemas: true,
      });

      expect(result.count).toBe(1);
      expect(result.results[0].parameters).toEqual([]);
      expect(result.results[0]).not.toHaveProperty("inputSchema");
    });
  });

  describe("query mode", () => {
    it("returns ranked matches with concise parameters and omits redundant schemas", () => {
      const registry = {
        "send-email": action(
          "Send an email message",
          {
            to: { type: "string", description: "Recipient email address" },
            subject: { type: "string", description: "Email subject line" },
          },
          ["to"],
        ),
        "list-events": action("List calendar events"),
      };

      const result = searchToolRegistry(registry, {
        query: "send email",
        includeSchemas: true,
      });

      expect(result.query).toBe("send email");
      expect(result.results[0]).toMatchObject({
        name: "send-email",
        kind: "action",
        parameters: [
          { name: "to", type: "string", required: true },
          { name: "subject", type: "string", required: false },
        ],
      });
      expect(result.results[0].score).toBeGreaterThan(0);
      expect(result.results[0]).not.toHaveProperty("inputSchema");
    });

    it("respects limit in query mode", () => {
      const registry: Record<string, ActionEntry> = {};
      for (let i = 0; i < 30; i++) {
        registry[`report-${String(i).padStart(2, "0")}`] = action(
          `Generate report number ${i}`,
        );
      }

      const result = searchToolRegistry(registry, {
        query: "report",
        limit: 5,
      });
      expect(result.totalTools).toBe(30);
      expect(result.count).toBe(5);
      expect(result.results).toHaveLength(5);

      const aboveHardCap = searchToolRegistry(registry, {
        query: "report",
        limit: 100,
      });
      expect(aboveHardCap.count).toBe(10);
      expect(aboveHardCap.results).toHaveLength(10);
    });

    it("bounds descriptions and parameter summaries", () => {
      const properties = Object.fromEntries(
        Array.from({ length: 12 }, (_, index) => [
          `field-${index}`,
          {
            type: "string",
            description: "parameter detail ".repeat(20),
            enum: Array.from({ length: 10 }, () => "value-".repeat(20)),
          },
        ]),
      );
      const registry = {
        report: action(
          `Generate a report ${"tool detail ".repeat(40)}`,
          properties,
          ["field-0"],
        ),
      };

      const result = searchToolRegistry(registry, { query: "report" });
      const [tool] = result.results;

      expect(tool.description.length).toBeLessThanOrEqual(220);
      expect(tool.parameters).toHaveLength(8);
      for (const parameter of tool.parameters) {
        expect(parameter.description?.length).toBeLessThanOrEqual(120);
        expect(parameter.enum).toHaveLength(5);
        expect(parameter.enum?.every((value) => value.length <= 60)).toBe(true);
      }
      expect(tool).not.toHaveProperty("inputSchema");
    });
  });

  describe("loading tools by name", () => {
    // Names a prompt can advertise must load in one call, whichever form the
    // model uses, with the named tool ahead of anything that merely mentions it.
    const registry = {
      "bigquery-query": action("Run a BigQuery SQL query"),
      "bigquery-query-history": action(
        "List past bigquery query runs. Use bigquery query history to review a bigquery query.",
        { query: { type: "string", description: "bigquery query text" } },
      ),
      "search-analytics-query-catalog": action(
        "Search saved analytics queries",
      ),
      "list-dashboards": action("List dashboards"),
    };

    it("ranks an exact-name query ahead of longer names that mention it", () => {
      const result = searchToolRegistry(registry, {
        query: "bigquery-query",
        limit: 1,
      });

      expect(result.results.map((r) => r.name)).toEqual(["bigquery-query"]);
    });

    it("loads several advertised names, with schemas, in a single call", () => {
      const result = searchToolRegistry(registry, {
        names: ["bigquery-query", "search-analytics-query-catalog"],
      });

      expect(result.results.map((r) => r.name).sort()).toEqual([
        "bigquery-query",
        "search-analytics-query-catalog",
      ]);
      expect(result.message).toBeUndefined();
    });
  });

  describe("batched search", () => {
    const registry = {
      "send-email": action("Send an email message"),
      "list-events": action("List calendar events"),
      "export-report": action("Export a report to CSV"),
      "delete-event": action("Delete a calendar event"),
    };

    it("unions the matches of several queries into one result", () => {
      const result = searchToolRegistry(registry, {
        queries: ["send email", "export report"],
      });

      expect(result.results.map((r) => r.name).sort()).toEqual([
        "export-report",
        "send-email",
      ]);
      expect(result.count).toBe(2);
      expect(result.query).toBe("send email | export report");
    });

    it("keeps the single query alongside queries without duplicating it", () => {
      const result = searchToolRegistry(registry, {
        query: "send email",
        queries: ["Send Email", "calendar"],
      });

      expect(result.query).toBe("send email | calendar");
      expect(result.results.map((r) => r.name)).toEqual(
        expect.arrayContaining(["send-email", "list-events", "delete-event"]),
      );
      expect(
        result.results.filter((r) => r.name === "send-email"),
      ).toHaveLength(1);
    });

    it("loads exact names, ignoring fuzzy matches, and reports the ones it lacks", () => {
      const result = searchToolRegistry(registry, {
        names: ["list-events", "no-such-tool"],
      });

      expect(result.results.map((r) => r.name)).toEqual(["list-events"]);
      expect(result.query).toBe("names: list-events, no-such-tool");
      expect(result.message).toBe(
        "No tool named no-such-tool is available in the current mode.",
      );
    });

    it("combines queries and names in one result", () => {
      const result = searchToolRegistry(registry, {
        queries: ["send email"],
        names: ["delete-event"],
      });

      expect(result.results.map((r) => r.name).sort()).toEqual([
        "delete-event",
        "send-email",
      ]);
    });

    it("runs at most five queries and ignores blanks and repeats", () => {
      const result = searchToolRegistry(registry, {
        queries: [
          "email",
          " ",
          "EMAIL",
          "report",
          "events",
          "calendar",
          "csv",
          "delete",
        ],
      });

      expect(result.query).toBe("email | report | events | calendar | csv");
      expect(result.message).toContain("Only the first 5 queries were used");
      expect(result.message).toContain("delete");
    });

    it("says so when names past the limit are ignored", () => {
      const names = Array.from({ length: 22 }, (_, i) => `tool-${i}`);
      const result = searchToolRegistry(registry, { names });

      expect(result.query).toBe(`names: ${names.slice(0, 20).join(", ")}`);
      expect(result.message).toContain("Only the first 20 names were used");
      expect(result.message).toContain("2 more were ignored");
      expect(result.message).toContain("tool-21");
    });

    it("keeps the per-name misses and adds the truncation note", () => {
      const result = searchToolRegistry(registry, {
        queries: ["email", "report", "events", "calendar", "csv", "delete"],
        names: ["no-such-tool"],
      });

      expect(result.message).toContain("No tool named no-such-tool");
      expect(result.message).toContain("Only the first 5 queries were used");
    });

    it("does not mention truncation when nothing was dropped", () => {
      const result = searchToolRegistry(registry, {
        queries: ["email", "report"],
      });

      expect(result.message ?? "").not.toContain("Only the first");
    });

    it("never cuts the ignored-entries note inside an emoji", () => {
      const loneSurrogate =
        /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
      for (let pad = 0; pad < 2; pad += 1) {
        const result = searchToolRegistry(registry, {
          queries: [
            "email",
            "report",
            "events",
            "calendar",
            "csv",
            `${"a".repeat(pad)}${"😀".repeat(120)}`,
          ],
        });
        expect(result.message).toContain("Only the first 5 queries");
        expect(result.message).not.toMatch(loneSurrogate);
      }
    });

    describe("isTargetedToolSearch", () => {
      it.each([
        ["a query", { query: "email" }, true],
        ["a queries array", { queries: ["email"] }, true],
        ["a bare string queries", { queries: "email" }, true],
        ["a names array", { names: ["send-email"] }, true],
        ["a bare string names", { names: "send-email" }, true],
        ["no arguments", {}, false],
        ["blank entries", { query: " ", queries: [" "], names: [""] }, false],
        ["a nested list", { queries: [["email"]] }, false],
        ["a non-string list", { queries: [1], names: [{}] }, false],
      ])("agrees with the search on %s", (_label, args, targeted) => {
        expect(isTargetedToolSearch(args)).toBe(targeted);
        if (targeted) {
          expect(
            searchToolRegistry(registry, args).results.length,
          ).toBeGreaterThan(0);
        }
      });
    });

    it("keeps a repeat guard per query, flagging the call only when all repeated", async () => {
      await runWithRequestContext(
        { userEmail: "agent@example.com", run: {} },
        () => {
          const first = searchToolRegistry(registry, {
            queries: ["send email", "export report"],
          });
          const partial = searchToolRegistry(registry, {
            queries: ["send email", "calendar"],
          });
          const again = searchToolRegistry(registry, {
            queries: ["send email", "export report"],
          });

          expect(first.repeated).toBeUndefined();
          expect(partial.repeated).toBeUndefined();
          expect(partial.results.map((r) => r.name)).toEqual(
            expect.arrayContaining(["send-email", "list-events"]),
          );
          expect(again.repeated).toBe(true);
          expect(again.message).toContain("already ran");
        },
      );
    });

    it("leaves single-query results and menu mode unchanged", () => {
      expect(searchToolRegistry(registry, { query: "email" }).query).toBe(
        "email",
      );
      expect(searchToolRegistry(registry, { queries: [" "] }).query).toBe("");
      expect(searchToolRegistry(registry, {}).results).toHaveLength(4);
    });
  });
});

describe("readLoadedToolNames", () => {
  const output = {
    query: "alpha",
    totalTools: 2,
    count: 1,
    results: [
      { name: "alpha-tool", callable: true },
      { name: "plan-only", callable: false },
    ],
  };

  it("reads the loaded list from a result followed by notes", () => {
    const stored = `${JSON.stringify(
      withLoadedToolNames(output, ["alpha-tool", 'odd "name"']),
      null,
      2,
    )}\n\nLoaded matching tool schemas for the next step, not this one: alpha-tool`;
    expect(readLoadedToolNames(stored)).toEqual(["alpha-tool", 'odd "name"']);
  });

  it("keeps the loaded list readable after the rest of the result is clipped", () => {
    const stored = JSON.stringify(
      withLoadedToolNames(output, ["alpha-tool", "beta-tool"]),
      null,
      2,
    );
    const clipped = `${stored.slice(0, stored.indexOf('"results"') + 20)}\n\n...[truncated]`;
    expect(readLoadedToolNames(clipped)).toEqual(["alpha-tool", "beta-tool"]);
  });

  it("reads a compact result and an empty loaded list", () => {
    expect(
      readLoadedToolNames(JSON.stringify(withLoadedToolNames(output, []))),
    ).toEqual([]);
    expect(
      readLoadedToolNames(
        JSON.stringify(withLoadedToolNames(output, ["a", "b"])),
      ),
    ).toEqual(["a", "b"]);
  });

  it("reads the callable matches of a result stored before the loaded list", () => {
    const stored = `${JSON.stringify(output, null, 2)}\n\nLoaded matching tool schemas for next step: alpha-tool`;
    expect(readLoadedToolNames(stored)).toEqual(["alpha-tool"]);
    expect(readLoadedToolNames(JSON.stringify(output))).toEqual(["alpha-tool"]);
  });

  it("tells a result that loaded nothing from one it cannot read", () => {
    expect(
      readLoadedToolNames("Interrupted before this tool returned"),
    ).toEqual([]);
    expect(
      readLoadedToolNames(JSON.stringify({ query: "", results: [] })),
    ).toEqual([]);
    const stored = JSON.stringify(output, null, 2);
    expect(
      readLoadedToolNames(`${stored.slice(0, 60)}\n\n...[truncated]`),
    ).toBeNull();
    expect(readLoadedToolNames('{"query": "alpha", "results": [')).toBeNull();
  });
});

describe("tool-search ranking", () => {
  it("ranks a rare query word above words most tools share", () => {
    const registry = {
      "list-dashboards": action("List dashboards in the app"),
      "list-gong-calls": action("List recorded Gong calls"),
      "list-users": action("List users in the app"),
      "list-events": action("List calendar events"),
    };

    const result = searchToolRegistry(registry, { query: "list gong calls" });

    expect(result.results[0]?.name).toBe("list-gong-calls");
  });

  it("matches plural queries to singular names and ignores stop words", () => {
    const registry = {
      "create-dashboard": action("Create a dashboard"),
      "send-email": action("Send an email message"),
    };

    const result = searchToolRegistry(registry, {
      query: "the dashboards",
    });

    expect(result.results.map((r) => r.name)).toEqual(["create-dashboard"]);
  });

  it("finds an action by its search hints, which never reach the model", () => {
    const registry = {
      "manage-automations": {
        ...action("Create, list, update, or delete inbox automations."),
        searchHints: ["auto-archive rule", "inbox rule"],
      },
      "archive-email": action("Archive one or more emails by ID."),
      "list-labels": action("List labels for the connected accounts."),
    };

    const result = searchToolRegistry(registry, {
      query: "can you edit my auto archive rules?",
    });

    expect(result.results[0]?.name).toBe("manage-automations");
    expect(JSON.stringify(result)).not.toContain("auto-archive rule");
  });

  it("matches tense, a joined camel-case word, and a common synonym", () => {
    const registry = {
      "archive-email": action("Archive one or more emails by ID."),
      "import-pptx": action("Import a PowerPoint file as a new deck."),
      "duplicate-deck": action("Duplicate a deck with new slide ids."),
      "list-decks": action("List decks."),
    };

    const rank = (query: string) =>
      searchToolRegistry(registry, { query }).results[0]?.name;

    expect(rank("archived")).toBe("archive-email");
    expect(rank("archiving")).toBe("archive-email");
    expect(rank("powerpoint")).toBe("import-pptx");
    expect(rank("copy this deck")).toBe("duplicate-deck");
  });

  it("meets a doubled-consonant -ing form at its base verb, and keeps base double letters", () => {
    const registry = {
      "run-check": action("Run a check now."),
      "stop-timer": action("Stop the timer."),
      "add-label": action("Add a label."),
      "fill-form": action("Fill a form."),
      "dress-slide": action("Dress a slide up."),
    };
    const rank = (query: string) =>
      searchToolRegistry(registry, { query }).results[0]?.name;

    expect(rank("running")).toBe("run-check");
    expect(rank("run")).toBe("run-check");
    expect(rank("stopping")).toBe("stop-timer");
    expect(rank("stopped")).toBe("stop-timer");
    for (const [base, name] of [
      ["add", "add-label"],
      ["fill", "fill-form"],
      ["dress", "dress-slide"],
    ] as const) {
      expect(rank(base)).toBe(name);
      expect(rank(`${base}ing`)).toBe(name);
    }
  });

  describe("destructive mark", () => {
    const writeAction = (
      description: string,
      properties: Record<string, unknown> = {},
    ): ActionEntry => ({ ...action(description, properties), readOnly: false });
    const annotations = (destructiveHint: boolean) => ({
      readOnlyHint: false,
      destructiveHint,
      openWorldHint: false,
    });
    const marks = (registry: Record<string, ActionEntry>) =>
      Object.fromEntries(
        searchToolRegistry(registry, {
          names: Object.keys(registry),
        }).results.map((r) => [r.name, r.destructive]),
      );

    it("marks results and still finds them for a negated request", () => {
      const registry = {
        "delete-email": writeAction("Delete an email."),
        "archive-email": writeAction("Archive an email."),
      };

      expect(
        searchToolRegistry(registry, { query: "don't delete this email" })
          .results[0],
      ).toMatchObject({ name: "delete-email", destructive: true });
      expect(marks(registry)).toEqual({
        "delete-email": true,
        "archive-email": undefined,
      });
    });

    it("reads a destructive verb from the name, the hint, or any schema value", () => {
      expect(
        marks({
          "cancel-booking": writeAction("Cancel a booking."),
          "remove-tag": writeAction("Remove a tag from an email."),
          // A declared hint wins over the name in both directions.
          "trash-preview": {
            ...writeAction("Preview what trashing would move."),
            mcpAnnotations: annotations(false),
          },
          "manage-email-rules": {
            ...writeAction("Create, update, or remove rules."),
            mcpAnnotations: annotations(true),
          },
          "manage-filters": writeAction("Change filters.", {
            operation: { type: "string", enum: ["list", "create", "delete"] },
          }),
          // Any key, in camelCase, nested in a list of tagged edits.
          "apply-edit": writeAction("Apply edits.", {
            edits: {
              type: "array",
              items: {
                anyOf: [
                  { properties: { kind: { const: "setText" } } },
                  { properties: { kind: { const: "deleteNode" } } },
                ],
              },
            },
          }),
          "purge-cache": writeAction("Rebuild the cache.", {
            scope: { type: "string", enum: ["all_purge", "purge_all"] },
          }),
          // Removing or clearing is often a reversible edit.
          "manage-tags": writeAction("Add or remove tags.", {
            change: { type: "string", enum: ["addTag", "removeTag", "clear"] },
          }),
          // A read is never destructive, whatever its filters are called.
          "list-bookings": {
            ...action("List bookings.", {
              status: { type: "string", enum: ["confirmed", "cancelled"] },
            }),
          },
        }),
      ).toEqual({
        "cancel-booking": true,
        "remove-tag": undefined,
        "trash-preview": undefined,
        "manage-email-rules": true,
        "manage-filters": true,
        "apply-edit": true,
        "purge-cache": true,
        "manage-tags": undefined,
        "list-bookings": undefined,
      });
    });

    it("lets an explicit destructiveHint: false win over the name and schema", () => {
      expect(
        marks({
          "delete-preview": {
            ...writeAction("Preview what a delete would remove.", {
              operation: { type: "string", enum: ["delete"] },
            }),
            mcpAnnotations: annotations(false),
          },
        }),
      ).toEqual({ "delete-preview": undefined });
    });

    it("marks a connected MCP tool by its server's hints and MCP's defaults", () => {
      const upstream = (
        name: string,
        hints: Record<string, unknown>,
      ): McpTool => ({
        source: "files",
        name: `mcp__files__${name}`,
        originalName: name,
        description: "Work with a file.",
        inputSchema: { type: "object", properties: {} },
        annotations: hints,
        raw: {},
      });
      const entries = mcpToolsToActionEntries({
        getTools: () => [
          upstream("tidy_folder", { destructiveHint: true }),
          upstream("delete_draft", { destructiveHint: false }),
          upstream("sync_folder", {}),
          upstream("read_folder", { readOnlyHint: true }),
        ],
      } as unknown as McpClientManager);

      expect(entries["mcp__files__tidy_folder"]?.mcpAnnotations).toEqual({
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: true,
      });
      // MCP's default: a tool that is not read-only may be destructive.
      expect(entries["mcp__files__sync_folder"]?.mcpAnnotations).toEqual({
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: true,
      });
      expect(marks(entries)).toEqual({
        mcp__files__tidy_folder: true,
        mcp__files__delete_draft: undefined,
        mcp__files__sync_folder: true,
        mcp__files__read_folder: undefined,
      });
    });

    it("stops walking a schema past its depth bound", () => {
      let schema: Record<string, unknown> = {
        type: "object",
        properties: { op: { const: "delete" } },
      };
      for (let level = 0; level < 10; level++) {
        schema = { type: "object", properties: { nested: schema } };
      }
      const deep = writeAction("Edit.");

      expect(
        marks({
          "deep-edit": { ...deep, tool: { ...deep.tool, parameters: schema } },
        }),
      ).toEqual({ "deep-edit": undefined });
    });

    it("keeps the mark on a repeated search and in the menu", () => {
      const registry = {
        "delete-email": writeAction("Delete an email."),
        "send-email": writeAction("Send an email."),
      };

      const [first, second, menu] = runWithRequestContext(
        { userEmail: "agent@example.com", run: {} },
        () => [
          searchToolRegistry(registry, { query: "delete email" }),
          searchToolRegistry(registry, { query: "delete email" }),
          searchToolRegistry(registry, {}),
        ],
      );

      expect(second.repeated).toBe(true);
      for (const result of [first, second, menu]) {
        expect(
          result.results.find((r) => r.name === "delete-email")?.destructive,
        ).toBe(true);
        expect(
          result.results.find((r) => r.name === "send-email")?.destructive,
        ).toBeUndefined();
      }
    });
  });

  it("keeps 'setting' and 'settings' apart from the verb 'set'", () => {
    const registry = {
      "set-theme": action("Set the theme."),
      "get-mail-settings": action("Read mail settings."),
    };
    const rank = (query: string) =>
      searchToolRegistry(registry, { query }).results.map((r) => r.name);

    expect(rank("settings")).toEqual(["get-mail-settings"]);
    expect(rank("mail setting")).toEqual(["get-mail-settings"]);
    expect(rank("set")).toEqual(["set-theme"]);
  });

  it("keeps protected nouns apart and meets -e verbs in every tense", () => {
    const registry = {
      "create-post": action("Make a new post."),
      "list-news": action("List company news."),
      "save-draft": action("Save a draft."),
      "move-email": action("Move an email to a label."),
      "list-recordings": action("List session recordings."),
      "record-feedback": action("Record feedback on an email."),
    };
    const rank = (query: string) =>
      searchToolRegistry(registry, { query }).results.map((r) => r.name);

    expect(rank("news")).toEqual(["list-news"]);
    for (const query of ["save", "saved", "saving"]) {
      expect(rank(query)[0]).toBe("save-draft");
    }
    for (const query of ["move", "moved", "moving"]) {
      expect(rank(query)[0]).toBe("move-email");
    }
    expect(rank("recording")).toEqual(["list-recordings"]);
    expect(rank("record")).toEqual(["record-feedback"]);
  });

  it("drops a stray letter from an apostrophe but keeps single digits", () => {
    const registry = {
      "list-events": action("List calendar events."),
      "get-profile": action("Read the user's profile."),
      "set-aspect-ratio": action("Set the slide shape to 4:3."),
    };
    const names = (query: string) =>
      searchToolRegistry(registry, { query }).results.map((r) => r.name);

    expect(names("what's on my calendar")).toEqual(["list-events"]);
    expect(names("4:3")).toEqual(["set-aspect-ratio"]);
  });

  it("ranks a word in the first sentence above the same word later on", () => {
    // Alphabetical order, the tie-break, would put deck-a first.
    const registry = {
      "deck-a": action("Read a deck. Export it later."),
      "deck-b": action("Export a deck. Keeps its slides."),
    };

    const names = searchToolRegistry(registry, {
      query: "export",
    }).results.map((r) => r.name);

    expect(names).toEqual(["deck-b", "deck-a"]);
  });

  it("ranks a short description above a long one with the same match", () => {
    const registry = {
      "tool-a": action(
        "Read a deck. It returns slides, notes, comments, owners, history, layout, theme, and export settings.",
      ),
      "tool-b": action("Read a deck. It returns export settings."),
    };

    const names = searchToolRegistry(registry, {
      query: "export",
    }).results.map((r) => r.name);

    expect(names).toEqual(["tool-b", "tool-a"]);
  });

  it("indexes parameter descriptions but not their JSON types", () => {
    const registry = {
      "send-email": action("Send a message.", {
        to: { type: "string", description: "Recipient address" },
      }),
    };
    const names = (query: string) =>
      searchToolRegistry(registry, { query }).results.map((r) => r.name);

    expect(names("recipient")).toEqual(["send-email"]);
    expect(names("string")).toEqual([]);
  });

  it("gives the name phrase bonus only to whole tokens in order", () => {
    // Each pair differs only by a name whose tokens merely end in the query.
    const scores = (query: string, registry: Record<string, ActionEntry>) =>
      Object.fromEntries(
        searchToolRegistry(registry, { query }).results.map((r) => [
          r.name,
          r.score,
        ]),
      );

    const view = scores("view email", {
      "view-email": action("Open an email."),
      "preview-email": action("Show an email."),
      "send-email": action("Show an email."),
    });
    expect(view["preview-email"]).toBe(view["send-email"]);
    expect(view["view-email"]).toBeGreaterThan(view["preview-email"]! + 5);

    const archive = scores("archive email", {
      "archive-email": action("Move an email out of the inbox."),
      "unarchive-email": action("Restore an email."),
      "restore-email": action("Restore an email."),
    });
    expect(archive["unarchive-email"]).toBe(archive["restore-email"]);
    expect(archive["archive-email"]).toBeGreaterThan(
      archive["unarchive-email"]! + 5,
    );
  });

  it("drops conversational words, so a description's 'you can' never matches", () => {
    const registry = {
      "list-events": action("List calendar events for a date range."),
      "get-settings": action("Settings you can change, and what they do."),
    };

    const result = searchToolRegistry(registry, {
      query: "can you show me what events I have",
    });

    expect(result.results.map((r) => r.name)).toEqual(["list-events"]);
  });

  it("ranks the app's own action above a framework tool with the same words", () => {
    // Same words, so only the prior separates them; alphabetically the
    // framework tool would come first.
    const registry = {
      "email-list": frameworkMcpTool(action("List sent emails.")),
      "list-email": action("List sent emails."),
    };

    const names = searchToolRegistry(registry, {
      query: "sent emails",
    }).results.map((r) => r.name);

    expect(names).toEqual(["list-email", "email-list"]);
  });
});

describe("tool-search zero-hit fallback", () => {
  it("suggests close names that are never loaded", () => {
    const registry = {
      "send-email": action("Send an email message"),
      "list-calendars": action("List available calendars"),
    };

    const result = searchToolRegistry(registry, {
      query: "sender notification",
    });

    expect(result.results).toEqual([]);
    expect(result.suggestions?.map((s) => s.name)).toEqual(["send-email"]);
    expect(result.message).toContain("Closest tool names: send-email");
    expect(extractToolSearchResultNames(result)).toEqual([]);
    expect(
      readLoadedToolNames(JSON.stringify(withLoadedToolNames(result, []))),
    ).toEqual([]);
  });

  it("keeps suggestions when the same empty search repeats in one run", () => {
    const registry = {
      "send-email": action("Send an email message"),
      "list-calendars": action("List available calendars"),
    };

    const [first, second] = runWithRequestContext(
      { userEmail: "agent@example.com", run: {} },
      () => [
        searchToolRegistry(registry, { query: "sender notification" }),
        searchToolRegistry(registry, { query: "sender notification" }),
      ],
    );

    expect(first.suggestions?.map((s) => s.name)).toEqual(["send-email"]);
    expect(second.repeated).toBe(true);
    expect(second.suggestions?.map((s) => s.name)).toEqual(["send-email"]);
  });

  it("points at the Tool index when nothing is close", () => {
    const result = searchToolRegistry(
      { "send-email": action("Send an email message") },
      { query: "zzzzzzzzzzz" },
    );

    expect(result.suggestions).toBeUndefined();
    expect(result.message).toContain("Check the Tool index");
  });

  it("does not dead-end a query made only of stop words", () => {
    const result = searchToolRegistry(
      { "send-email": action("Send an email message") },
      { query: "the" },
    );

    expect(result.results).toEqual([]);
    expect(result.message).toContain("Check the Tool index");
  });

  it("leaves menu mode without suggestions", () => {
    const result = searchToolRegistry(
      { "send-email": action("Send an email message") },
      {},
    );

    expect(result.suggestions).toBeUndefined();
    expect(result.message).not.toContain("No tool matched");
  });
});
