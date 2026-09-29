import { afterEach, describe, expect, it, vi } from "vitest";

import {
  mcpToolsToActionEntries,
  type McpClientManager,
  type McpTool,
} from "../mcp-client/index.js";
import type { ActionEntry } from "./production-agent.js";
import {
  attachToolSearch,
  createToolSearchEntry,
  searchToolRegistry,
  TOOL_SEARCH_ACTION_NAME,
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
});
