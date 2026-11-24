import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

import { createMCPServerForRequest } from "@agent-native/core/mcp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function must<T>(value: T | null | undefined, message = "Expected a value"): T {
  if (value === null || value === undefined) throw new Error(message);
  return value;
}

const { PGlite } = createRequire(
  new URL("../../../packages/core/package.json", import.meta.url),
)("@electric-sql/pglite");
type PGliteClient = Awaited<ReturnType<typeof PGlite.create>>;

const database = vi.hoisted(() => ({ client: null as null | PGliteClient }));

vi.mock("@agent-native/core/db", async (importOriginal) => {
  const query = async (
    run: (
      sql: string,
      args: unknown[],
    ) => Promise<{ rows: unknown[]; affectedRows?: number }>,
    { sql, args }: { sql: string; args?: unknown[] },
  ) => {
    const result = await run(sql, args ?? []);
    return { rows: result.rows, rowsAffected: result.affectedRows ?? 0 };
  };
  return {
    ...(await importOriginal<typeof import("@agent-native/core/db")>()),
    getDbExec: () => ({
      execute: (input: { sql: string; args?: unknown[] }) =>
        query((sql, args) => must(database.client).query(sql, args), input),
      transaction: <T>(callback: (tx: unknown) => Promise<T>) =>
        must(database.client).transaction((tx: PGliteClient) =>
          callback({
            execute: (input: { sql: string; args?: unknown[] }) =>
              query((sql, args) => tx.query(sql, args), input),
          }),
        ),
    }),
  };
});
vi.mock("@agent-native/core/settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/settings")>()),
  getOrgSetting: async () => null,
}));
vi.mock("../server/lib/credentials", () => ({
  resolveCredential: async (key: string) =>
    key === "BIGQUERY_PROJECT_ID" ? "builder-3b0a2" : null,
}));
vi.mock("../server/lib/gcloud", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server/lib/gcloud")>()),
  getBigQueryAccessToken: async () => "test-token",
  getBigQueryAccess: async () => ({
    token: "test-token",
    principal: "sa:runner@builder-3b0a2.iam.gserviceaccount.com#0a1b",
  }),
}));

const { default: queryWarehouse } = await import("./query-warehouse.js");
const {
  BIGQUERY_AGENT_BUDGET_MIGRATION_SQL,
  BIGQUERY_AGENT_CREDENTIAL_FINGERPRINT_MIGRATION_SQL,
  BIGQUERY_AGENT_EXECUTION_JOB_IDENTITY_MIGRATION_SQL,
  BIGQUERY_AGENT_EXECUTION_CANCEL_MIGRATION_SQL,
} = await import("../server/lib/bigquery-agent-budget.js");
const { BIGQUERY_USAGE_MIGRATION_SQL } =
  await import("../server/lib/bigquery-usage.js");

const requireFromCore = createRequire(
  createRequire(import.meta.url).resolve("@agent-native/core"),
);
const { createMcpHandler } = await import(
  pathToFileURL(requireFromCore.resolve("@modelcontextprotocol/server")).href
);

const USERS = {
  projectId: "builder-3b0a2",
  datasetId: "dbt_mart",
  tableId: "users",
};
const SQL =
  "SELECT DATE_TRUNC(DATE(created_at), WEEK) AS week, COUNT(*) AS signups FROM @project.dbt_mart.users GROUP BY week";
const submissions: unknown[] = [];

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function callTool(args: Record<string, unknown>) {
  const handler = createMcpHandler(
    () =>
      createMCPServerForRequest(
        {
          name: "Analytics",
          appId: "analytics",
          description: "Analytics",
          builtinCrossAppTools: false,
          actions: { "query-warehouse": queryWarehouse },
        } as Parameters<typeof createMCPServerForRequest>[0],
        {
          userEmail: "alice@example.com",
          orgDomain: undefined,
          orgId: "org-1",
          oauthScopes: ["mcp:read"],
        },
      ),
    { legacy: "stateless", responseMode: "auto" },
  );
  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "query-warehouse", arguments: args },
  };
  const res = await handler.fetch(
    new Request("https://analytics.example.test/_agent-native/mcp", {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "mcp-protocol-version": "2025-06-18",
      },
      body: JSON.stringify(body),
    }),
    { parsedBody: body },
  );
  const text = await res.text();
  const payload = text.includes("data:")
    ? must(
        text.split("\n").find((line: string) => line.startsWith("data:")),
      ).slice(5)
    : text;
  return JSON.parse(payload).result as {
    isError?: boolean;
    structuredContent?: Record<string, unknown>;
    content: Array<{ type: string; text?: string }>;
  };
}

beforeEach(async () => {
  database.client = await PGlite.create("memory://");
  for (const statement of [
    ...BIGQUERY_AGENT_BUDGET_MIGRATION_SQL,
    ...BIGQUERY_AGENT_CREDENTIAL_FINGERPRINT_MIGRATION_SQL,
    ...BIGQUERY_AGENT_EXECUTION_JOB_IDENTITY_MIGRATION_SQL,
    ...BIGQUERY_AGENT_EXECUTION_CANCEL_MIGRATION_SQL,
    BIGQUERY_USAGE_MIGRATION_SQL,
  ]) {
    await must(database.client).exec(statement);
  }
  submissions.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const method = init?.method ?? "GET";
      if (url.pathname.includes("/tables/")) {
        return json({ type: "TABLE", location: "US" });
      }
      if (method === "POST" && url.pathname.endsWith("/jobs")) {
        const body = JSON.parse(String(init?.body));
        if (body.configuration?.dryRun) {
          return json({
            statistics: {
              totalBytesProcessed: String(1024 ** 3),
              query: {
                statementType: "SELECT",
                referencedTables: [USERS],
                schema: {
                  fields: [
                    { name: "week", type: "DATE" },
                    { name: "signups", type: "INT64" },
                  ],
                },
              },
            },
          });
        }
        submissions.push(body);
        return json({
          jobReference: { ...body.jobReference, location: "US" },
        });
      }
      if (url.pathname.includes("/queries/")) {
        return json({
          jobComplete: true,
          totalBytesProcessed: String(1024 ** 3),
          schema: {
            fields: [
              { name: "week", type: "DATE" },
              { name: "signups", type: "INT64" },
            ],
          },
          totalRows: "1",
          rows: [{ f: [{ v: "2026-11-16" }, { v: "42" }] }],
        });
      }
      if (url.pathname.includes("/jobs/")) {
        const jobId = decodeURIComponent(url.pathname.split("/").pop() ?? "");
        return json({
          jobReference: { projectId: "builder-3b0a2", jobId, location: "US" },
          status: { state: "DONE" },
          statistics: {
            query: {
              totalBytesProcessed: String(1024 ** 3),
              totalBytesBilled: String(1024 ** 3),
              cacheHit: false,
            },
          },
        });
      }
      throw new Error(`Unexpected request ${method} ${url}`);
    }),
  );
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await database.client?.close();
  database.client = null;
});

describe("query-warehouse over MCP", () => {
  it("runs one aggregate and returns rows that meet its output contract", async () => {
    const result = await callTool({ sql: SQL });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      status: "ok",
      executedSql:
        "SELECT DATE_TRUNC(DATE(created_at), WEEK) AS week, COUNT(*) AS signups FROM `builder-3b0a2`.dbt_mart.users GROUP BY week",
      referencedTables: ["builder-3b0a2.dbt_mart.users"],
      rowCount: 1,
      rows: [{ week: "2026-11-16", signups: 42 }],
      truncated: false,
      bigQueryBudget: { thisCall: { jobsAdmitted: 1 } },
    });
    expect(submissions).toHaveLength(1);
    const { rows } = await must(database.client).query(
      "SELECT caller, source, status FROM analytics_bigquery_agent_executions",
    );
    expect(rows).toEqual([
      { caller: "mcp", source: "query-warehouse", status: "completed" },
    ]);
  });

  it("dry-runs without sending a job", async () => {
    const result = await callTool({ sql: SQL, dryRun: true });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      status: "estimated",
      rows: [],
      jobId: null,
      columns: [
        { name: "week", type: "DATE" },
        { name: "signups", type: "INT64" },
      ],
    });
    expect(submissions).toHaveLength(0);
  });

  it("returns a refused statement as an error with its code and no rows", async () => {
    const result = await callTool({
      sql: "DELETE FROM `builder-3b0a2.dbt_mart.users` WHERE TRUE",
    });
    expect(result.isError).toBe(true);
    const text = result.content.map((block) => block.text ?? "").join("\n");
    expect(text).toContain("query_statement_not_allowed");
    expect(text).not.toContain('"rows"');
    expect(submissions).toHaveLength(0);
  });
});
