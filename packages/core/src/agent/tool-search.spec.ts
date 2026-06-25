import { afterEach, describe, expect, it, vi } from "vitest";

import type { ActionEntry } from "./production-agent.js";
import {
  attachToolSearch,
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
    expect(result.results[0].inputSchema).toMatchObject({
      properties: {
        channel: { type: "string" },
      },
    });
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
      // Sorted alphabetically by name.
      expect(result.results.map((tool) => tool.name)).toEqual([
        "create-doc",
        "list-events",
        "send-email",
      ]);
      // No parameter summaries, no input schema, score 0 — even for the entry
      // that has parameters (send-email).
      for (const tool of result.results) {
        expect(tool.parameters).toEqual([]);
        expect(tool.score).toBe(0);
        expect(tool).not.toHaveProperty("inputSchema");
      }
      // Descriptions are still present (truncated form).
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

    it("is not capped by limit or maxLimit — returns all tools beyond the cap", () => {
      const registry: Record<string, ActionEntry> = {};
      for (let i = 0; i < 30; i++) {
        // Zero-padded so alphabetical name sort is also numeric order.
        const name = `tool-${String(i).padStart(2, "0")}`;
        registry[name] = action(`Tool number ${i}`);
      }

      const result = searchToolRegistry(registry, {});

      // 30 > DEFAULT_LIMIT (8) and > MAX_LIMIT (25): menu mode ignores both.
      expect(result.totalTools).toBe(30);
      expect(result.count).toBe(30);
      expect(result.results).toHaveLength(30);
      expect(result.results[0].name).toBe("tool-00");
      expect(result.results[29].name).toBe("tool-29");

      // An explicit oversized limit is also ignored in menu mode.
      const withLimit = searchToolRegistry(registry, { limit: 5 });
      expect(withLimit.count).toBe(30);
      expect(withLimit.results).toHaveLength(30);
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
      // Only the two real actions are counted, not the tool-search entry.
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

  describe("query mode (unchanged behavior)", () => {
    it("returns ranked matches with parameters populated and includes inputSchema when requested", () => {
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
      expect(result.results[0].inputSchema).toMatchObject({
        type: "object",
        properties: {
          to: { type: "string" },
          subject: { type: "string" },
        },
        required: ["to"],
      });
    });

    it("respects limit in query mode", () => {
      const registry: Record<string, ActionEntry> = {};
      for (let i = 0; i < 30; i++) {
        registry[`report-${String(i).padStart(2, "0")}`] = action(
          `Generate report number ${i}`,
        );
      }

      // All entries match "report"; limit must cap query-mode results.
      const result = searchToolRegistry(registry, {
        query: "report",
        limit: 5,
      });
      expect(result.totalTools).toBe(30);
      expect(result.count).toBe(5);
      expect(result.results).toHaveLength(5);
    });
  });
});
