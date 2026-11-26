import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ActionRunContext } from "../action.js";
import {
  createMCPServerForRequest,
  type MCPCallerIdentity,
  type MCPConfig,
} from "./build-server.js";
import { frameworkMcpTool } from "./framework-tools.js";

vi.mock("../labs/store.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../labs/store.js")>()),
  getUserLabEnabled: vi.fn(async () => false),
}));

vi.mock("../audit/record.js", () => ({
  recordActionAudit: vi.fn(async () => {}),
}));

let grant: string[] | null = null;

vi.mock("../org/service-principal-guard.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../org/service-principal-guard.js")
  >()),
  assertServicePrincipalMayRun: vi.fn(async () => ({ allowedActions: grant })),
}));

vi.mock("./analytics.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./analytics.js")>()),
  trackMcpToolCall: () => {},
}));

vi.mock("../agent/production-agent.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../agent/production-agent.js")>()),
  getJevContextCredentials: vi.fn(async () => ({})),
}));

vi.mock("../server/better-auth-instance.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../server/better-auth-instance.js")
  >()),
  findBetterAuthUserIdForEmail: vi.fn(async () => undefined),
}));

const alice: MCPCallerIdentity = {
  userEmail: "alice@example.com",
  identityAssurance: "user",
  orgId: null,
  orgDomain: undefined,
};

function action(
  name: string,
  description: string,
  extra: Record<string, unknown> = {},
) {
  return {
    tool: {
      description,
      parameters: {
        type: "object" as const,
        properties: { id: { type: "string" } },
      },
    },
    run: async () => ({ ran: name }),
    ...extra,
  };
}

function searchTool() {
  return {
    tool: {
      description: "Discover callable tools",
      parameters: {
        type: "object" as const,
        properties: {
          query: { type: "string" },
          task: { type: "string" },
          names: { type: "array", items: { type: "string" } },
        },
      },
    },
    readOnly: true,
    run: async () => ({ results: [] }),
  };
}

function actions(): Record<string, unknown> {
  return {
    "tool-search": frameworkMcpTool(searchTool()),
    "list-reports": action("list-reports", "List the saved reports.", {
      readOnly: true,
      mcpTool: true,
    }),
    "archive-report": action("archive-report", "Archive a saved report.", {
      mcpTool: "search",
    }),
    "send-report-now": action(
      "send-report-now",
      "Email a saved report to its subscribers now.",
      { mcpTool: false },
    ),
    "schedule-report-email": action(
      "schedule-report-email",
      "Schedule a saved report's email to its subscribers.",
    ),
  };
}

function config(overrides: Partial<MCPConfig> = {}): MCPConfig {
  const all = { ...actions(), ...(overrides.actions ?? {}) };
  return {
    name: "Reports",
    appId: "reports",
    description: "Reports agent",
    askAgent: async () => "agent reply",
    connectorCatalog: ["list-reports"],
    ...overrides,
    actions: all,
    productionActions: all,
  } as MCPConfig;
}

async function clientFor(
  mcpConfig: MCPConfig = config(),
  identity: MCPCallerIdentity = alice,
) {
  const server = await createMCPServerForRequest(mcpConfig, identity, {
    origin: "http://localhost:8100",
    transport: "http",
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);
  return client;
}

interface SearchOutput {
  results: Array<{ name: string }>;
  notServed?: {
    message: string;
    tools: Array<{ name: string; description: string }>;
  };
}

async function search(
  client: Client,
  args: Record<string, unknown>,
): Promise<SearchOutput> {
  const out = (await client.callTool({
    name: "tool-search",
    arguments: args,
  })) as { isError?: boolean; content: Array<{ text?: string }> };
  expect(out.isError).toBeFalsy();
  return JSON.parse(out.content.map((part) => part.text).join("\n"));
}

const notServedNames = (output: SearchOutput) =>
  output.notServed?.tools.map((tool) => tool.name) ?? [];

beforeEach(() => {
  grant = null;
});

describe("tool-search names what the app's own agent can do", () => {
  it("names the closest actions this connection can't call", async () => {
    const output = await search(await clientFor(), {
      query: "email report subscribers",
    });
    expect(notServedNames(output).sort()).toEqual([
      "schedule-report-email",
      "send-report-now",
    ]);
    expect(output.notServed?.message).toContain("ask_app");
    expect(
      output.notServed?.tools.find((tool) => tool.name === "send-report-now")
        ?.description,
    ).toBe("Email a saved report to its subscribers now.");
    const served = output.results.map((result) => result.name);
    expect(served).not.toContain("send-report-now");
    expect(served).not.toContain("schedule-report-email");
  });

  it("names an action asked for by its exact name", async () => {
    const output = await search(await clientFor(), {
      names: ["send-report-now"],
    });
    expect(output.results).toEqual([]);
    expect(notServedNames(output)).toEqual(["send-report-now"]);
  });

  it("ranks a task's text like a query", async () => {
    const output = await search(await clientFor(), {
      task: "send the report now",
    });
    expect(notServedNames(output)[0]).toBe("send-report-now");
  });

  it("leaves out tools the connection serves, listed or not", async () => {
    const names = notServedNames(
      await search(await clientFor(), { query: "report" }),
    );
    expect(names).not.toContain("list-reports");
    expect(names).not.toContain("archive-report");
    expect(names).not.toContain("tool-search");
  });

  it("names served writes the app sends through ask_app", async () => {
    const output = await search(
      await clientFor(config({ externalAgents: { writes: "ask_app_only" } })),
      { query: "archive report" },
    );
    expect(output.results.map((result) => result.name)).not.toContain(
      "archive-report",
    );
    expect(notServedNames(output)).toContain("archive-report");
  });

  it("names a served action whose input MCP can't take", async () => {
    const output = await search(
      await clientFor(
        config({
          actions: {
            "query-report-rows": {
              ...action("query-report-rows", "Query a saved report's rows.", {
                mcpTool: true,
              }),
              tool: {
                description: "Query a saved report's rows.",
                parameters: {
                  type: "object" as const,
                  properties: { sql: { type: "string" } },
                },
              },
            },
          },
        }),
      ),
      { query: "query report rows" },
    );
    expect(output.results.map((result) => result.name)).not.toContain(
      "query-report-rows",
    );
    expect(notServedNames(output)).toContain("query-report-rows");
  });

  it("names at most three", async () => {
    const extra = Object.fromEntries(
      ["one", "two", "three", "four"].map((word) => [
        `export-report-${word}`,
        action(`export-report-${word}`, `Export a report, ${word}.`, {
          mcpTool: false,
        }),
      ]),
    );
    const output = await search(await clientFor(config({ actions: extra })), {
      query: "export report",
    });
    expect(output.notServed?.tools).toHaveLength(3);
  });

  it("names nothing for a menu search or when nothing matches", async () => {
    const client = await clientFor();
    expect((await search(client, {})).notServed).toBeUndefined();
    expect(
      (await search(client, { query: "calendar invitations" })).notServed,
    ).toBeUndefined();
  });
});

describe("tool-search leaves unnamed", () => {
  const hidden: Record<
    string,
    { flags: Record<string, unknown>; policy?: MCPConfig["externalAgents"] }
  > = {
    "denied by the operator": {
      flags: {},
      policy: { denyActions: ["forward-report"] },
    },
    "only for outside agents, kept off MCP by the write policy": {
      flags: { agentTool: false, mcpTool: true },
      policy: { writes: "ask_app_only" },
    },
    "UI only": { flags: { uiOnly: true } },
    "ending the in-app turn": { flags: { endsTurn: true } },
    "unavailable to this caller": {
      flags: { agentDiscoveryAvailable: () => false },
    },
  };

  for (const [reason, { flags, policy }] of Object.entries(hidden)) {
    it(`an action ${reason}`, async () => {
      const output = await search(
        await clientFor(
          config({
            actions: {
              "forward-report": action(
                "forward-report",
                "Forward a report by email.",
                { mcpTool: false, ...flags },
              ),
            },
            ...(policy ? { externalAgents: policy } : {}),
          }),
        ),
        { query: "forward report" },
      );
      expect(notServedNames(output)).not.toContain("forward-report");
    });
  }

  it("a framework action every app carries, such as navigate", async () => {
    const output = await search(
      await clientFor(
        config({
          actions: {
            navigate: frameworkMcpTool(
              action("navigate", "Navigate the user's screen to a report.", {
                mcpTool: false,
              }),
            ),
          },
        }),
      ),
      { query: "navigate report" },
    );
    expect(notServedNames(output)).not.toContain("navigate");
  });

  it("an action the framework never serves over MCP", async () => {
    const output = await search(
      await clientFor(
        config({
          actions: {
            "db-report-rows": action("db-report-rows", "Report rows.", {
              mcpTool: false,
            }),
          },
        }),
      ),
      { query: "report rows" },
    );
    expect(notServedNames(output)).not.toContain("db-report-rows");
  });

  it("everything when the app denies ask_app", async () => {
    const output = await search(
      await clientFor(config({ externalAgents: { denyActions: ["ask_app"] } })),
      { query: "email report subscribers" },
    );
    expect(output.notServed).toBeUndefined();
  });

  it("everything when the caller's grant leaves out ask_app", async () => {
    grant = ["tool-search", "list-reports"];
    const output = await search(await clientFor(), {
      query: "email report subscribers",
    });
    expect(output.notServed).toBeUndefined();
  });

  it("everything for a read-only token, which can't call ask_app", async () => {
    const output = await search(
      await clientFor(config(), { ...alice, oauthScopes: ["mcp:read"] }),
      { query: "email report subscribers" },
    );
    expect(output.notServed).toBeUndefined();
  });

  it("a read action from a token that can't read, through an app's own tool-search", async () => {
    const output = await search(
      await clientFor(
        config({
          actions: {
            "tool-search": { ...searchTool(), readOnly: false, mcpTool: true },
            "list-report-subscribers": action(
              "list-report-subscribers",
              "List a report's email subscribers.",
              { readOnly: true, mcpTool: false },
            ),
          },
        }),
        { ...alice, oauthScopes: ["mcp:write"] },
      ),
      { query: "report subscribers" },
    );
    expect(notServedNames(output)).toContain("send-report-now");
    expect(notServedNames(output)).not.toContain("list-report-subscribers");
  });

  it("everything for a search that asks for read-only tools only", async () => {
    const output = await search(await clientFor(), {
      query: "email report subscribers",
      readOnlyOnly: true,
    });
    expect(output.notServed).toBeUndefined();
  });

  it("everything for a caller that isn't a signed-in person", async () => {
    const output = await search(
      await clientFor(config(), {
        userEmail: "bot@example.com",
        identityAssurance: "service",
        orgId: "org-1",
        orgDomain: undefined,
      }),
      { query: "email report subscribers" },
    );
    expect(output.notServed).toBeUndefined();
  });
});

describe("tool-search's not-served lookup", () => {
  const forwardReport = (agentDiscoveryAvailable: () => Promise<boolean>) =>
    config({
      actions: {
        "forward-report": action(
          "forward-report",
          "Forward a report by email.",
          { mcpTool: false, agentDiscoveryAvailable },
        ),
      },
    });

  it("tells the app's discovery checks who is asking", async () => {
    const available = vi.fn<(context?: ActionRunContext) => Promise<boolean>>(
      async () => true,
    );
    await search(await clientFor(forwardReport(available)), {
      query: "forward report",
    });
    expect(available).toHaveBeenCalledWith(
      expect.objectContaining({
        caller: "mcp",
        userEmail: "alice@example.com",
        orgId: null,
      }),
    );
  });

  it("doesn't run the app's discovery checks for a menu search", async () => {
    const available = vi.fn(async () => true);
    const client = await clientFor(forwardReport(available));
    available.mockClear();
    expect((await search(client, {})).notServed).toBeUndefined();
    expect(available).not.toHaveBeenCalled();
    const output = await search(client, { query: "forward report" });
    expect(available).toHaveBeenCalled();
    expect(notServedNames(output)).toContain("forward-report");
  });

  it("drops notServed and keeps the results when a discovery check fails", async () => {
    const output = await search(
      await clientFor(
        forwardReport(async () => {
          throw new Error("provider unavailable");
        }),
      ),
      { query: "list saved reports" },
    );
    expect(output.results.map((result) => result.name)).toContain(
      "list-reports",
    );
    expect(output.notServed).toBeUndefined();
  });

  it("drops notServed when one check rejects and a later one throws", async () => {
    const output = await search(
      await clientFor(
        config({
          actions: {
            "forward-report": action(
              "forward-report",
              "Forward a report by email.",
              {
                mcpTool: false,
                agentDiscoveryAvailable: () =>
                  Promise.reject(new Error("provider unavailable")),
              },
            ),
            "print-report": action("print-report", "Print a saved report.", {
              mcpTool: false,
              agentDiscoveryAvailable: () => {
                throw new Error("printer unavailable");
              },
            }),
          },
        }),
      ),
      { query: "list saved reports" },
    );
    expect(output.results.map((result) => result.name)).toContain(
      "list-reports",
    );
    expect(output.notServed).toBeUndefined();
  });

  it("drops notServed when a discovery check doesn't answer in time", async () => {
    const output = await search(
      await clientFor(forwardReport(() => new Promise<boolean>(() => {}))),
      { query: "list saved reports" },
    );
    expect(output.results.map((result) => result.name)).toContain(
      "list-reports",
    );
    expect(output.notServed).toBeUndefined();
  });
});
