import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActionEntry } from "./production-agent.js";
import { attachToolSearch, searchToolRegistry } from "./tool-search.js";

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
});
