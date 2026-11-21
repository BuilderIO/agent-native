import { beforeAll, describe, expect, it, vi } from "vitest";

import { countTextTokens } from "../agent/context-xray/tokenize.js";
import {
  LOAD_TIMEOUT_MS,
  loadAppCatalogs,
  withCatalogClient,
  type AppCatalog,
} from "./advertised-catalog.harness.js";

const SCOPES: ReadonlyArray<{ label: string; oauthScopes: string[] }> = [
  { label: "read", oauthScopes: ["mcp:read"] },
  { label: "read + write", oauthScopes: ["mcp:read", "mcp:write"] },
];

interface Measurement {
  app: string;
  scope: string;
  tools: number;
  tokens: number;
  appTokens: number;
  largest: { name: string; tokens: number };
  exact: boolean;
}

async function measure(
  app: AppCatalog,
  scope: (typeof SCOPES)[number],
): Promise<Measurement> {
  const production = app.surfaces.find(
    ({ surface }) => !surface.dev && surface.codeExecution === "off",
  );
  if (!production) {
    throw new Error(`${app.appId} has no plain production catalog.`);
  }
  const { tools } = await withCatalogClient(
    production.config,
    { fullCatalog: false, fullSurface: false, oauthScopes: scope.oauthScopes },
    (client) => client.listTools(),
  );
  const total = await countTextTokens(JSON.stringify(tools));
  const perTool = await Promise.all(
    tools.map(async (tool) => ({
      name: tool.name,
      ...(await countTextTokens(JSON.stringify(tool))),
    })),
  );
  const largest = perTool.reduce(
    (max, tool) => (tool.tokens > max.tokens ? tool : max),
    { name: "-", tokens: 0, method: total.method },
  );
  return {
    app: app.appId,
    scope: scope.label,
    tools: tools.length,
    tokens: total.tokens,
    appTokens: perTool
      .filter((tool) => app.templateActionNames.has(tool.name))
      .reduce((sum, tool) => sum + tool.tokens, 0),
    largest: { name: largest.name, tokens: largest.tokens },
    exact:
      total.method === "exact" &&
      perTool.every((tool) => tool.method === "exact"),
  };
}

function formatReport(rows: Measurement[]): string {
  const lines = [
    "tools/list size per app: default production catalog, inline app cards off,",
    "the JSON result counted with @anthropic-ai/tokenizer.",
    "",
    "| App | Scope | Tools | Tokens | App's own tools | Largest tool |",
    "| --- | --- | ---: | ---: | ---: | --- |",
    ...rows.map(
      (row) =>
        `| ${row.app} | ${row.scope} | ${row.tools} | ${row.tokens} | ${row.appTokens} | ${row.largest.name} (${row.largest.tokens}) |`,
    ),
  ];
  return `${lines.join("\n")}\n`;
}

describe("tools/list size report", () => {
  let apps: AppCatalog[] = [];
  const rows: Measurement[] = [];

  beforeAll(async () => {
    apps = await loadAppCatalogs();
    vi.stubEnv("AGENT_MODE", "production");
    vi.stubEnv("AGENT_PROD_CODE_EXECUTION", "off");
    try {
      for (const app of apps) {
        for (const scope of SCOPES) rows.push(await measure(app, scope));
      }
    } finally {
      vi.unstubAllEnvs();
    }
    rows.sort((a, b) => b.tokens - a.tokens || a.app.localeCompare(b.app));
    process.stdout.write(formatReport(rows));
  }, LOAD_TIMEOUT_MS);

  it("measures every app under each scope", () => {
    expect(apps.length).toBeGreaterThan(0);
    expect(rows).toHaveLength(apps.length * SCOPES.length);
    for (const row of rows) {
      expect(row.tools, `${row.app} (${row.scope})`).toBeGreaterThan(0);
    }
  });

  it("counts tokens with the tokenizer, not the length estimate", () => {
    expect(rows.filter((row) => !row.exact)).toEqual([]);
  });
});
