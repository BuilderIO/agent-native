import { createRequire } from "node:module";

import { createMCPServerForRequest } from "@agent-native/core/mcp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function must<T>(value: T | null | undefined, message = "Expected a value"): T {
  if (value === null || value === undefined) throw new Error(message);
  return value;
}

const requireCore = createRequire(
  new URL("../../../packages/core/package.json", import.meta.url),
);
const { Client } = requireCore("@modelcontextprotocol/client");
const { InMemoryTransport } = requireCore("@modelcontextprotocol/server");
const { PGlite } = requireCore("@electric-sql/pglite");
type PGliteClient = Awaited<ReturnType<typeof PGlite.create>>;

const database = vi.hoisted(() => {
  const state = { queue: Promise.resolve() };
  return {
    client: null as null | PGliteClient,
    failing: null as null | ((sql: string) => boolean),
    runExclusive: async <T>(operation: () => Promise<T>): Promise<T> => {
      const previous = state.queue;
      let release!: () => void;
      state.queue = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        return await operation();
      } finally {
        release();
      }
    },
  };
});

interface GrantCall {
  nonce: string;
  actionName: string;
  argumentsHash: string;
  expiresAt: number;
  approvalNotice?: string | null;
  createdAt?: number;
}
interface Grant extends GrantCall {
  consumed: boolean;
  createdAt: number;
  reviewed?: "approved";
}

const approvalStore = vi.hoisted(() => {
  const grants = new Map<string, Grant>();
  return {
    grants,
    mock: async (importOriginal: () => Promise<object>) => ({
      ...(await importOriginal()),
      createMcpApprovalGrant: vi.fn(async (grant: GrantCall) => {
        grants.set(grant.nonce, {
          ...grant,
          consumed: false,
          createdAt: grant.createdAt ?? Date.now(),
        });
      }),
      consumeMcpApprovalGrant: vi.fn(async () => {
        throw new Error("a review-page approval never takes a form answer");
      }),
      answerMcpApprovalPrompt: vi.fn(async () => true),
      consumeReviewedMcpApprovalGrant: vi.fn(
        async (call: Pick<GrantCall, "actionName" | "argumentsHash">) => {
          for (const existing of grants.values()) {
            if (
              existing.reviewed === "approved" &&
              !existing.consumed &&
              existing.expiresAt >= Date.now() &&
              existing.actionName === call.actionName &&
              existing.argumentsHash === call.argumentsHash
            ) {
              existing.consumed = true;
              return { ...existing, status: "approved" };
            }
          }
          return null;
        },
      ),
      findRecentMcpApprovalRun: vi.fn(async () => null),
      recordMcpApprovalRun: vi.fn(async () => undefined),
    }),
  };
});
const { approvalAuth, userSettings } = vi.hoisted(() => ({
  approvalAuth: () => ({
    getAuthSecret: () => "fake-test-only-mcp-approval-secret",
    findBetterAuthUserIdForEmail: async () => undefined,
  }),
  userSettings: async (importOriginal: () => Promise<object>) => ({
    ...(await importOriginal()),
    getUserSetting: async () => null,
  }),
}));
vi.mock(
  "../../../packages/core/dist/server/better-auth-instance.js",
  approvalAuth,
);
vi.mock(
  "../../../packages/core/src/server/better-auth-instance.js",
  approvalAuth,
);
vi.mock(
  "../../../packages/core/dist/mcp/approval-store.js",
  approvalStore.mock,
);
vi.mock("../../../packages/core/src/mcp/approval-store.js", approvalStore.mock);
vi.mock("../../../packages/core/dist/settings/user-settings.js", userSettings);
vi.mock("../../../packages/core/src/settings/user-settings.js", userSettings);

vi.mock("@agent-native/core/db", async (importOriginal) => {
  const query = async (
    run: (
      sql: string,
      args: unknown[],
    ) => Promise<{ rows: unknown[]; affectedRows?: number }>,
    { sql, args }: { sql: string; args?: unknown[] },
  ) => {
    if (database.failing?.(sql)) throw new Error("connection reset");
    const result = await run(sql, args ?? []);
    return { rows: result.rows, rowsAffected: result.affectedRows ?? 0 };
  };
  return {
    ...(await importOriginal<typeof import("@agent-native/core/db")>()),
    getDbExec: () => ({
      execute: (input: { sql: string; args?: unknown[] }) =>
        database.runExclusive(() =>
          query((sql, args) => must(database.client).query(sql, args), input),
        ),
      transaction: <T>(callback: (tx: unknown) => Promise<T>) =>
        database.runExclusive(() =>
          must(database.client).transaction((tx: PGliteClient) =>
            callback({
              execute: (input: { sql: string; args?: unknown[] }) =>
                query((sql, args) => tx.query(sql, args), input),
            }),
          ),
        ),
    }),
  };
});
vi.mock("@agent-native/core/settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/settings")>()),
  getOrgSetting: async () => null,
}));
vi.mock("@agent-native/core/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/server")>()),
  getRequestUserEmail: () => "alice@example.com",
  getRequestOrgId: () => "org-1",
}));
vi.mock("@agent-native/core/tracking", () => ({ track: () => undefined }));
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

const {
  BIGQUERY_AGENT_BUDGET_MIGRATION_SQL,
  BIGQUERY_AGENT_CREDENTIAL_FINGERPRINT_MIGRATION_SQL,
  BIGQUERY_AGENT_EXECUTION_JOB_IDENTITY_MIGRATION_SQL,
  BIGQUERY_AGENT_EXECUTION_CANCEL_MIGRATION_SQL,
  OUTSIDE_AGENT_JOB_CAP_BYTES,
  OUTSIDE_AGENT_PERSON_BASE_BYTES,
  OUTSIDE_AGENT_PERSON_CEILING_BYTES,
} = await import("../server/lib/bigquery-agent-budget");
const { BIGQUERY_USAGE_MIGRATION_SQL } =
  await import("../server/lib/bigquery-usage");
const { reservationForEstimate } =
  await import("../server/lib/bigquery-agent-context");
const { default: queryWarehouse } = await import("./query-warehouse");

const USERS = {
  projectId: "builder-3b0a2",
  datasetId: "dbt_mart",
  tableId: "users",
};
const SQL =
  "SELECT DATE_TRUNC(DATE(created_at), WEEK) AS week, COUNT(*) AS signups FROM @project.dbt_mart.users GROUP BY week";
const GIB = 1024 ** 3;
const MB = 1_000_000;

interface ToolResult {
  isError?: boolean;
  content: Array<{ text?: unknown }>;
  structuredContent?: Record<string, unknown> & {
    bigQueryBudget?: {
      today?: { person: { limitUsd: number; approvedToday: boolean } };
    };
  };
}

const bigQuery = {
  dryRuns: 0,
  submissions: 0,
  onDryRun: null as null | (() => Promise<void>),
};
const closeClients: Array<() => Promise<void>> = [];

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function connect(action: typeof queryWarehouse = queryWarehouse) {
  const server = await createMCPServerForRequest(
    {
      name: "Analytics",
      description: "Analytics test server",
      appId: "analytics",
      actions: { "query-warehouse": action },
    },
    {
      userEmail: "alice@example.com",
      orgDomain: undefined,
      orgId: "org-1",
      identityAssurance: "user",
      oauthScopes: ["mcp:read"],
    },
    { origin: "http://localhost:8080", transport: "http" },
  );
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client(
    { name: "query-warehouse-approval-test", version: "1.0.0" },
    { versionNegotiation: { mode: "auto" } },
  );
  client.registerCapabilities({ elicitation: { form: {} } });
  client.setRequestHandler("elicitation/create", async () => ({
    action: "accept",
    content: { decision: "approve" },
  }));
  closeClients.push(async () => {
    await client.close();
    await server.close();
  });
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);
  return async (args: Record<string, unknown>): Promise<ToolResult> =>
    client.callTool({ name: "query-warehouse", arguments: args });
}

async function seedSpend(bytes: number) {
  const id = `seed_${Math.random().toString(36).slice(2)}`;
  const now = new Date();
  await must(database.client).query(
    `INSERT INTO analytics_bigquery_agent_jobs (request_id, project_id, job_id, owner_email, org_id, org_key,
       credential_scope, source, utc_day, reserved_bytes, billed_bytes, state, submission_state, created_at,
       lease_expires_at, resolved_at)
     VALUES ($1, 'builder-3b0a2', $1, 'alice@example.com', 'org-1', 'org:org-1', 'default', 'seed', $2, $3,
       $3, 'settled', 'accepted', $4, $4, $4)`,
    [id, now.toISOString().slice(0, 10), bytes, now.toISOString()],
  );
}

function text(result: ToolResult): string {
  return result.content.map((part) => String(part.text)).join("\n");
}

function onlyGrant(): Grant {
  const grants = [...approvalStore.grants.values()];
  expect(grants).toHaveLength(1);
  return must(grants[0]);
}

function approveOnReviewPage(grant: Grant) {
  grant.reviewed = "approved";
  grant.expiresAt = Date.now() + 10 * 60_000;
}

async function rows(sql: string) {
  return (await must(database.client).query(sql)).rows as Array<
    Record<string, unknown>
  >;
}

beforeEach(async () => {
  vi.stubEnv("DATABASE_URL", "pglite:memory");
  database.client = await PGlite.create("memory://");
  database.failing = null;
  for (const statement of [
    ...BIGQUERY_AGENT_BUDGET_MIGRATION_SQL,
    ...BIGQUERY_AGENT_CREDENTIAL_FINGERPRINT_MIGRATION_SQL,
    ...BIGQUERY_AGENT_EXECUTION_JOB_IDENTITY_MIGRATION_SQL,
    ...BIGQUERY_AGENT_EXECUTION_CANCEL_MIGRATION_SQL,
    BIGQUERY_USAGE_MIGRATION_SQL,
  ]) {
    await database.client.exec(statement);
  }
  approvalStore.grants.clear();
  bigQuery.dryRuns = 0;
  bigQuery.submissions = 0;
  bigQuery.onDryRun = null;
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
          bigQuery.dryRuns++;
          await bigQuery.onDryRun?.();
          return json({
            statistics: {
              totalBytesProcessed: String(GIB),
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
        bigQuery.submissions++;
        return json({ jobReference: { ...body.jobReference, location: "US" } });
      }
      if (url.pathname.includes("/queries/")) {
        return json({
          jobComplete: true,
          totalBytesProcessed: String(GIB),
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
              totalBytesBilled: String(GIB),
              cacheHit: false,
              statementType: "SELECT",
            },
          },
        });
      }
      throw new Error(`Unexpected request ${method} ${url}`);
    }),
  );
});

afterEach(async () => {
  for (const close of closeClients.splice(0)) await close();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await database.client?.close();
  database.client = null;
});

describe("query-warehouse over MCP, past the $1 no-ask allowance", () => {
  it("asks once on the review page with a notice from one plan, then runs once the person approves", async () => {
    await seedSpend(OUTSIDE_AGENT_PERSON_BASE_BYTES - 20 * MB);
    const call = await connect();

    const asked = await call({ sql: SQL });
    expect(asked.isError).toBe(true);
    const grant = onlyGrant();
    expect(text(asked)).toContain(
      `query-warehouse needs the user's approval on its review page before it runs. Ask the user to review it here: http://localhost:8080/_agent-native/mcp/approvals/${grant.nonce}`,
    );
    expect(must(grant.approvalNotice)).toMatch(
      /^Allow up to \$5\.00 of BigQuery today\?\nAt today's limits, this call can bill up to \$0\.01\./,
    );
    expect(bigQuery.dryRuns).toBe(1);
    expect(bigQuery.submissions).toBe(0);
    expect(
      await rows(
        "SELECT job_id FROM analytics_bigquery_agent_jobs WHERE source <> 'seed'",
      ),
    ).toEqual([]);

    approveOnReviewPage(grant);
    const ran = await call({ sql: SQL });
    expect(ran.isError).not.toBe(true);
    expect(ran.structuredContent).toMatchObject({
      status: "ok",
      rows: [{ week: "2026-11-16", signups: 42 }],
      bigQueryBudget: { today: { person: { approvedToday: true } } },
    });
    expect(
      await rows(
        "SELECT allowance_bytes::text AS allowance, approved_via FROM analytics_bigquery_agent_allowance_approvals",
      ),
    ).toEqual([
      {
        allowance: String(OUTSIDE_AGENT_PERSON_CEILING_BYTES),
        approved_via: "mcp-review-page",
      },
    ]);
    expect(bigQuery.submissions).toBe(1);
  });

  it("asks with a review link when a concurrent spend pushes a cleared call past $1 before it is admitted", async () => {
    const call = await connect();
    bigQuery.onDryRun = async () => {
      bigQuery.onDryRun = null;
      await seedSpend(OUTSIDE_AGENT_PERSON_BASE_BYTES - 10 * MB);
    };
    const asked = await call({ sql: SQL });
    expect(asked.isError).toBe(true);
    const grant = onlyGrant();
    expect(text(asked)).toContain(
      `http://localhost:8080/_agent-native/mcp/approvals/${grant.nonce}`,
    );
    expect(bigQuery.submissions).toBe(0);

    approveOnReviewPage(grant);
    const ran = await call({ sql: SQL });
    expect(ran.isError).not.toBe(true);
    expect(bigQuery.submissions).toBe(1);
  });

  it("never asks about SQL its own checks refuse, however close to $1 the person is", async () => {
    await seedSpend(OUTSIDE_AGENT_PERSON_BASE_BYTES - MB);
    const call = await connect();
    const result = await call({
      sql: "DELETE FROM `builder-3b0a2.dbt_mart.users` WHERE TRUE",
    });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("query_statement_not_allowed");
    expect(approvalStore.grants.size).toBe(0);
    expect(bigQuery.dryRuns).toBe(0);
    expect(
      await rows("SELECT * FROM analytics_bigquery_agent_allowance_approvals"),
    ).toEqual([]);
  });

  it("refuses budget_unavailable, and records the call, when the approval can't be written to the ledger", async () => {
    await seedSpend(OUTSIDE_AGENT_PERSON_BASE_BYTES - 10 * MB);
    const call = await connect();
    await call({ sql: SQL });
    approveOnReviewPage(onlyGrant());
    database.failing = (sql) =>
      sql.includes("INSERT INTO analytics_bigquery_agent_allowance_approvals");
    const result = await call({ sql: SQL });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("budget_unavailable");
    expect(bigQuery.submissions).toBe(0);
    expect(
      await rows(
        "SELECT status, code FROM analytics_bigquery_agent_executions",
      ),
    ).toEqual([{ status: "refused", code: "budget_unavailable" }]);
  });
});

describe("query-warehouse over MCP: overlapping identical calls", () => {
  it("keeps each call on its own decision when one asks while the other, already cleared, has yet to run", async () => {
    const reserved = reservationForEstimate(GIB, OUTSIDE_AGENT_JOB_CAP_BYTES);
    await seedSpend(
      OUTSIDE_AGENT_PERSON_BASE_BYTES - reserved - Math.floor(reserved / 2),
    );
    let firstRunEntered!: () => void;
    const firstCleared = new Promise<void>((resolve) => {
      firstRunEntered = resolve;
    });
    let releaseFirstRun!: () => void;
    const secondAsked = new Promise<void>((resolve) => {
      releaseFirstRun = resolve;
    });
    let runs = 0;
    const call = await connect({
      ...queryWarehouse,
      run: async (args, context) => {
        if (++runs === 1) {
          firstRunEntered();
          await secondAsked;
        }
        return queryWarehouse.run(args, context);
      },
    } as typeof queryWarehouse);

    const first = call({ sql: SQL });
    await firstCleared;
    const second = await call({ sql: SQL });
    releaseFirstRun();
    const ran = await first;

    expect(second.isError).toBe(true);
    const grant = onlyGrant();
    expect(text(second)).toContain(
      `http://localhost:8080/_agent-native/mcp/approvals/${grant.nonce}`,
    );
    expect(must(grant.approvalNotice)).toMatch(/^Allow up to \$5\.00/);
    expect(ran.isError).not.toBe(true);
    expect(ran.structuredContent).toMatchObject({
      status: "ok",
      rows: [{ week: "2026-11-16", signups: 42 }],
    });
    expect(runs).toBe(1);
    expect(bigQuery.submissions).toBe(1);
    expect(
      await rows(
        "SELECT state FROM analytics_bigquery_agent_jobs WHERE source <> 'seed'",
      ),
    ).toEqual([{ state: "settled" }]);
  });
});
