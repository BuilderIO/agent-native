import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createMCPServerForRequest } from "@agent-native/core/mcp";
import {
  attachToolSearch,
  loadActionsFromStaticRegistry,
} from "@agent-native/core/server";
import { generateActionRegistryForProject } from "@agent-native/core/vite";
import { describe, expect, it } from "vitest";

import { filterDirectA2AActions } from "../../../packages/core/src/server/agent-chat/action-filters-a2a.js";
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
  agentTool?: boolean;
  mcpTool?: boolean;
  readOnly?: boolean;
  needsApproval?:
    | boolean
    | ((args: Record<string, unknown>, ctx?: { caller: string }) => unknown);
  publicAgent?: { expose?: boolean; allowRawQueryInput?: boolean };
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
  "open-traffic-dashboard",
  "account-deep-dive",
  "builder-blog-articles",
  // Runs one saved panel as the caller, rows capped, for a copy kept in a
  // Content page. Direct A2A shares this catalog, so Content's call needs it.
  "capture-dashboard-panel",
  "data-source-status",
  "estimate-dashboard-cost",
  "estimate-onboarding-journey-cost",
  "estimate-query-cost",
  "find-data",
  "query-dbt-semantic-metric",
  "get-analysis",
  "get-dashboard-panel-status",
  "get-data-program",
  "get-error-issue",
  "get-first-party-analytics-health",
  "get-onboarding-journey",
  "get-session-replay-summary",
  "get-session-report",
  "get-session-replay-timeline",
  "get-sql-dashboard",
  "gong-calls",
  "gong-native-insights",
  "hubspot-deals",
  "hubspot-metrics",
  "hubspot-pipelines",
  "hubspot-records",
  "list-analyses",
  "list-analysis-revisions",
  "list-dashboard-folders",
  "list-dashboard-revisions",
  "list-data-dictionary",
  "list-data-programs",
  "list-error-issues",
  "list-session-recordings",
  "list-sql-dashboards",
  "match-error-issues",
  "query-warehouse",
  "search-analytics-query-catalog",
  "search-dashboard-references",
  "search-warehouse-schema",
];

// Each takes expectedUpdatedAt and idempotencyKey; archive and hide are the
// only deletes.
const GUARDED_MCP_WRITES = [
  "archive-dashboard",
  "compose-dashboard",
  "create-dashboard-folder",
  "hide-analysis",
  "hide-dashboard",
  "mutate-dashboard",
  "rename-analysis",
  "rename-dashboard",
  "restore-analysis-revision",
  "restore-dashboard-revision",
  "save-analysis",
  "set-dashboard-folder",
  "update-dashboard",
];

const APPROVED_MCP_WRITES = [
  "export-dashboard-panel-to-google-sheet",
  "run-analytics-alerts",
  "run-monitor-check",
  "save-dashboard-report-subscription",
  "send-dashboard-report-now",
];

const APPROVED_FOR_EVERY_CALLER = [
  "export-dashboard-panel-to-google-sheet",
  "send-dashboard-report-now",
];

const KEYED_SENDS = [
  "save-dashboard-report-subscription",
  "send-dashboard-report-now",
];

const DIRECT_MCP_WRITES = [
  ...GUARDED_MCP_WRITES,
  ...APPROVED_MCP_WRITES,
  "run-gong-native-insight",
  "update-analytics-public-key",
];

// The declaration is preserved, but the shared SQL-input boundary requires
// publicAgent.allowRawQueryInput before this action can be served.
const SERVED_DIRECT_MCP_READS = DIRECT_MCP_READS.filter(
  (name) => name !== "estimate-query-cost",
);

// Raw SQL and capability minting stay off every MCP catalog, including the
// explicit full-catalog opt-in, which otherwise serves every undeclared action.
const VETOED = [
  "bigquery",
  "create-session-replay-agent-link",
  "db-admin-federated-read",
  "import-data-dictionary-index",
  "query-agent-native-analytics",
  "search-bigquery-schema",
  "list-sigma-workbooks",
  "inspect-sigma-workbook",
  "migrate-sigma-workbook",
];

// UI, bulk replay, and unapproved writes stay off the read-scoped catalog.
const DEFAULT_CONNECTOR_EXCLUDED = [
  "get-session-replay-events",
  "navigate",
  "view-screen",
];

// Hard deletes stay off every MCP catalog, and so do writes to credentials,
// connections, feature flags, alerts, monitors, status pages, and the data
// dictionary.
const HARD_DELETE = /^(?:delete-|remove)/;
const OFF_LIMITS_WRITE =
  /alert|monitor|status-page|data-dictionary|credential|ingestion-key|connected-database|feature-flag/;
const RUNS_EXISTING_ALERTS = ["run-analytics-alerts", "run-monitor-check"];

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
  const registry = attachToolSearch(
    loadActionsFromStaticRegistry(actionsRegistry),
  );
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
    expect(actions["migrate-sigma-workbook"].mcpTool).toBe(false);
    expect(actions["migrate-sigma-workbook"].readOnly).not.toBe(true);
    expect(actions["migrate-sigma-workbook"].needsApproval).toBe(true);
    expect(actions["migrate-sigma-workbook"].publicAgent?.expose).toBe(false);
    expect(actions["migrate-sigma-workbook"].agentTool).toBe(false);
  });

  it("never declares a hard delete, admin write, or alert/monitor/dictionary write", () => {
    const offLimits = Object.entries(actions)
      .filter(([, action]) => action.mcpTool === true)
      .filter(
        ([name, action]) =>
          HARD_DELETE.test(name) ||
          (action.readOnly !== true &&
            OFF_LIMITS_WRITE.test(name) &&
            !RUNS_EXISTING_ALERTS.includes(name)),
      )
      .map(([name]) => name);
    expect(offLimits).toEqual([]);
    expect(
      Object.keys(actions).filter((name) => HARD_DELETE.test(name)),
    ).not.toHaveLength(0);
  });

  it("gives every guarded write the fence and idempotency arguments", () => {
    for (const name of GUARDED_MCP_WRITES) {
      const properties = actions[name].tool.parameters?.properties ?? {};
      expect(Object.keys(properties), name).toContain("idempotencyKey");
      if (name !== "create-dashboard-folder") {
        expect(Object.keys(properties), name).toContain("expectedUpdatedAt");
      }
      expect(actions[name].readOnly, name).not.toBe(true);
    }
  });

  it("asks the user to approve every side effect an outside agent starts", async () => {
    const asks = async (caller: string) =>
      Object.fromEntries(
        await Promise.all(
          APPROVED_MCP_WRITES.map(async (name) => {
            const { needsApproval } = actions[name];
            const asked =
              typeof needsApproval === "function"
                ? await needsApproval({}, { caller })
                : needsApproval;
            return [name, asked];
          }),
        ),
      );
    const everyCall = Object.fromEntries(
      APPROVED_MCP_WRITES.map((name) => [name, true]),
    );
    expect(await asks("mcp")).toEqual(everyCall);
    expect(await asks("a2a")).toEqual(everyCall);
    expect(await asks("tool")).toEqual(
      Object.fromEntries(
        APPROVED_MCP_WRITES.map((name) => [
          name,
          APPROVED_FOR_EVERY_CALLER.includes(name),
        ]),
      ),
    );
    expect(
      APPROVED_MCP_WRITES.filter((name) => actions[name].readOnly === true),
    ).toEqual([]);
  });

  it("lets a report send or subscription save be retried with an idempotency key", () => {
    const keyless = KEYED_SENDS.filter(
      (name) =>
        !Object.keys(actions[name].tool.parameters?.properties ?? {}).includes(
          "idempotencyKey",
        ),
    );
    expect(keyless).toEqual([]);
  });

  it("classifies every direct read as read-only so mcp:read tokens can call it", () => {
    for (const name of DIRECT_MCP_READS) {
      expect(actions[name].readOnly, name).toBe(true);
    }
  });

  it("requires write scope, without a per-call approval, for Gong synthesis", () => {
    const run = actions["run-gong-native-insight"];
    expect(run.readOnly).not.toBe(true);
    expect(run.needsApproval).toBeUndefined();

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

  it("opts only query-warehouse and mutate-dashboard into raw SQL input", () => {
    const optedIn = Object.entries(actions)
      .filter(([, action]) => action.publicAgent?.allowRawQueryInput === true)
      .map(([name]) => name)
      .sort();
    expect(optedIn).toEqual(["mutate-dashboard", "query-warehouse"]);
  });

  it("tells outside agents to try saved definitions and dashboards before one aggregate warehouse query", () => {
    const order = [
      "find-data",
      "list-sql-dashboards",
      "search-warehouse-schema",
      "query-warehouse",
    ].map((name) => ANALYTICS_MCP.instructions.indexOf(name));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(ANALYTICS_MCP.instructions).toMatch(/aggregate/i);
    expect(ANALYTICS_MCP.instructions).not.toMatch(/not warehouse row queries/);
  });

  it("tells outside agents to report a dbt metric with no definition rather than compute it", () => {
    expect(ANALYTICS_MCP.instructions).toMatch(
      /dbt is connected but has no definition for a metric[^.]*do not compute that metric yourself from warehouse data unless the user asks/,
    );
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
      [...SERVED_DIRECT_MCP_READS].sort(),
    );
  }, 60_000);

  it("adds only allowlisted writes for an mcp:write token", async () => {
    expect(await listAppTools(["mcp:read", "mcp:write"])).toEqual(
      [...SERVED_DIRECT_MCP_READS, ...DIRECT_MCP_WRITES].sort(),
    );
  }, 60_000);

  it("keeps vetoed actions out of the full-catalog opt-in", async () => {
    const served = await listAppTools(["mcp:read", "mcp:write"], {
      fullCatalog: true,
    });
    expect(served).toEqual(
      expect.arrayContaining([
        ...SERVED_DIRECT_MCP_READS,
        ...DIRECT_MCP_WRITES,
      ]),
    );
    for (const name of [...VETOED, "estimate-query-cost"]) {
      expect(served, name).not.toContain(name);
    }
  }, 60_000);

  it("serves the warehouse tools over MCP only, never as direct A2A actions, because sibling apps ask Analytics in words", async () => {
    const registry = loadActionsFromStaticRegistry(actionsRegistry);
    const direct = Object.keys(
      filterDirectA2AActions(registry, {
        connectorCatalog: [...DIRECT_MCP_READS, ...ANALYTICS_MCP.keyToolNames],
        externalAgents: { authenticatedReads: "auto" },
      }),
    );
    expect(direct).toContain("get-onboarding-journey");
    expect(direct).not.toContain("query-warehouse");
    expect(direct).not.toContain("search-warehouse-schema");
    expect(
      ["query-warehouse", "search-warehouse-schema"].map(
        (name) => actions[name].publicAgent?.expose,
      ),
    ).toEqual([false, false]);
    expect(actions["query-warehouse"].publicAgent?.allowRawQueryInput).toBe(
      true,
    );
    const served = await listAppTools(["mcp:read"]);
    expect(served).toContain("query-warehouse");
    expect(served).toContain("search-warehouse-schema");
  }, 60_000);

  it("serves the bounded query tool to a read token and keeps every other raw-SQL read off", async () => {
    const served = await listAppTools(["mcp:read"]);
    expect(served).toContain("query-warehouse");
    expect(served).toContain("search-warehouse-schema");
    for (const name of [
      "bigquery",
      "estimate-query-cost",
      "query-agent-native-analytics",
      "search-bigquery-schema",
    ]) {
      expect(served).not.toContain(name);
    }
  }, 60_000);
});
