import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createMCPServerForRequest } from "@agent-native/core/mcp";
import { loadActionsFromStaticRegistry } from "@agent-native/core/server";
import { generateActionRegistryForProject } from "@agent-native/core/vite";
import { describe, expect, it } from "vitest";

import { ANALYTICS_MCP } from "../server/lib/analytics-mcp";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

generateActionRegistryForProject(projectRoot);
const { default: actionsRegistry } = await import(
  `${pathToFileURL(path.join(projectRoot, ".generated/actions-registry.ts")).href}?cacheBust=${Date.now()}`
);

type ActionDefinition = {
  mcpTool?: boolean;
  readOnly?: boolean;
  needsApproval?: unknown;
  tool: {
    description: string;
    parameters?: { properties?: Record<string, unknown> };
  };
};

const actions: Record<string, ActionDefinition> = Object.fromEntries(
  Object.entries(actionsRegistry as Record<string, { default?: unknown }>)
    .filter(([, mod]) => mod?.default && typeof mod.default === "object")
    .map(([name, mod]) => [name, mod.default as ActionDefinition]),
);

const DIRECT_MCP_READS = [
  "account-deep-dive",
  "builder-blog-articles",
  "data-source-status",
  "get-analysis",
  "get-data-program",
  "get-error-issue",
  "get-first-party-analytics-health",
  "get-session-replay-summary",
  "get-session-replay-timeline",
  "get-sql-dashboard",
  "gong-calls",
  "gong-native-insights",
  "hubspot-deals",
  "hubspot-metrics",
  "hubspot-pipelines",
  "hubspot-records",
  "list-analyses",
  "list-dashboard-folders",
  "list-data-dictionary",
  "list-data-programs",
  "list-error-issues",
  "list-session-recordings",
  "list-sql-dashboards",
  "match-error-issues",
  "search-analytics-query-catalog",
  "search-dashboard-references",
];

const DIRECT_MCP_WRITES = ["run-gong-native-insight"];

// Raw SQL and capability minting stay off every MCP catalog, including the
// explicit full-catalog opt-in, which otherwise serves every undeclared action.
const VETOED = [
  "bigquery",
  "create-session-replay-agent-link",
  "db-admin-federated-read",
  "query-agent-native-analytics",
  "search-bigquery-schema",
];

// Left off the default connector; the full-catalog opt-in can still serve them.
const DEFAULT_CONNECTOR_EXCLUDED = [
  "get-session-replay-events",
  "navigate",
  "save-analysis",
  "update-dashboard",
  "view-screen",
];

// The MCP SDK is a dependency of core, not of this template.
const requireFromCore = createRequire(
  createRequire(import.meta.url).resolve("@agent-native/core"),
);
const { createMcpHandler } = await import(
  pathToFileURL(requireFromCore.resolve("@modelcontextprotocol/server")).href
);

async function listAppTools(
  oauthScopes: string[],
  requestMeta: { fullCatalog?: boolean } = {},
): Promise<string[]> {
  const registry = loadActionsFromStaticRegistry(actionsRegistry);
  const config = {
    name: "Analytics",
    appId: "analytics",
    description: "Agent-Native analytics agent",
    actions: registry,
    productionActions: registry,
    ...ANALYTICS_MCP,
  } as Parameters<typeof createMCPServerForRequest>[0];
  const handler = createMcpHandler(
    () =>
      createMCPServerForRequest(
        config,
        {
          userEmail: "contract@example.com",
          orgDomain: undefined,
          orgId: null,
          oauthScopes,
        },
        requestMeta,
      ),
    { legacy: "stateless", responseMode: "auto" },
  );
  const rpc = { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} };
  const res = await handler.fetch(
    new Request("https://analytics.example.test/_agent-native/mcp", {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "mcp-protocol-version": "2025-06-18",
      },
      body: JSON.stringify(rpc),
    }),
    { parsedBody: rpc },
  );
  const text = await res.text();
  const payload = text.includes("data:")
    ? text
        .split("\n")
        .find((line: string) => line.startsWith("data:"))!
        .slice(5)
    : text;
  const tools = JSON.parse(payload).result.tools as Array<{ name: string }>;
  // Framework builtins such as list_apps and ask_app are not Analytics actions.
  return tools
    .map((tool) => tool.name)
    .filter((name) => name in actions)
    .sort();
}

describe("Analytics direct MCP tools", () => {
  it("pins the actions declared as direct MCP tools", () => {
    const declared = Object.entries(actions)
      .filter(([, action]) => action.mcpTool === true)
      .map(([name]) => name)
      .sort();

    expect(declared).toEqual(
      [...DIRECT_MCP_READS, ...DIRECT_MCP_WRITES].sort(),
    );
  });

  it("vetoes raw SQL and capability minting on every MCP catalog", () => {
    for (const name of VETOED) {
      expect(actions[name], name).toBeDefined();
      expect(actions[name].mcpTool, name).toBe(false);
    }
  });

  it("keeps writes, UI, and bulk replay actions off the default connector", () => {
    for (const name of DEFAULT_CONNECTOR_EXCLUDED) {
      expect(actions[name], name).toBeDefined();
      expect(actions[name].mcpTool, name).not.toBe(true);
    }
    for (const [name, action] of Object.entries(actions)) {
      if (/^(seed|ensure|migrate|purge)-/.test(name)) {
        expect(action.mcpTool, name).not.toBe(true);
      }
    }
  });

  it("classifies every direct read as read-only so mcp:read tokens can call it", () => {
    for (const name of DIRECT_MCP_READS) {
      expect(actions[name].readOnly, name).toBe(true);
    }
  });

  it("requires write scope and approval for paid Gong synthesis", () => {
    const run = actions["run-gong-native-insight"];
    expect(run.readOnly).not.toBe(true);
    expect(typeof run.needsApproval).toBe("function");

    const discovery = actions["gong-native-insights"];
    expect(discovery.needsApproval).toBeUndefined();
    expect(Object.keys(discovery.tool.parameters?.properties ?? {})).toEqual(
      [],
    );
  });

  it("gives every direct tool a description an external agent can route on", () => {
    const terse = [...DIRECT_MCP_READS, ...DIRECT_MCP_WRITES].filter(
      (name) => actions[name].tool.description.length <= 80,
    );
    expect(terse).toEqual([]);
  });

  it("names only tools a read-scoped token receives in keyToolNames and instructions", () => {
    const mentioned = Object.keys(actions).filter((name) =>
      new RegExp(`(?<![\\w-])${name}(?![\\w-])`).test(
        ANALYTICS_MCP.instructions,
      ),
    );
    for (const name of [...ANALYTICS_MCP.keyToolNames, ...mentioned]) {
      expect(DIRECT_MCP_READS, name).toContain(name);
    }
  });
});

describe("Analytics MCP tools/list", () => {
  it("serves only the direct reads to an mcp:read token", async () => {
    expect(await listAppTools(["mcp:read"])).toEqual(
      [...DIRECT_MCP_READS].sort(),
    );
  }, 60_000);

  it("adds only paid Gong synthesis for an mcp:write token", async () => {
    expect(await listAppTools(["mcp:read", "mcp:write"])).toEqual(
      [...DIRECT_MCP_READS, ...DIRECT_MCP_WRITES].sort(),
    );
  }, 60_000);

  it("keeps vetoed actions out of the full-catalog opt-in", async () => {
    const served = await listAppTools(["mcp:read", "mcp:write"], {
      fullCatalog: true,
    });
    expect(served).toEqual(
      expect.arrayContaining([...DIRECT_MCP_READS, ...DIRECT_MCP_WRITES]),
    );
    for (const name of VETOED) {
      expect(served, name).not.toContain(name);
    }
  }, 60_000);
});
