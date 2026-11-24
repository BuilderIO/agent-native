import { createRequire } from "node:module";

import type { ActionRunContext } from "@agent-native/core/action";
import { is, SQL } from "drizzle-orm";
import { getTableConfig, PgDialect, type PgTable } from "drizzle-orm/pg-core";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

function must<T>(value: T | null | undefined, message = "Expected a value"): T {
  if (value === null || value === undefined) throw new Error(message);
  return value;
}

const { PGlite } = createRequire(
  new URL("../../../packages/core/package.json", import.meta.url),
)("@electric-sql/pglite");
type PGliteClient = Awaited<ReturnType<typeof PGlite.create>>;

const harness = vi.hoisted(() => ({ db: null as unknown as PgliteDatabase }));
const scope = vi.hoisted(() => ({
  orgId: null as string | null,
  sink: "postgres",
  sinkUnreadable: false,
}));
const budget = vi.hoisted(() => ({
  admit: vi.fn(),
  settle: vi.fn(async () => true),
  read: vi.fn(),
  rows: [] as Array<Record<string, unknown>>,
}));

vi.mock("../server/db/index.js", async () => ({
  getDb: () => harness.db,
  schema: await vi.importActual("../server/db/schema.js"),
}));
vi.mock("@agent-native/core/sharing", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@agent-native/core/sharing")>();
  const { eq } = await import("drizzle-orm");
  const schema = await vi.importActual<typeof import("../server/db/schema.js")>(
    "../server/db/schema.js",
  );
  const tables = new Map([["dashboard", schema.dashboards]]);
  async function resolveAccess(type: string, id: string) {
    const table = tables.get(type);
    if (!table) return null;
    const rows = await harness.db.select().from(table).where(eq(table.id, id));
    return rows.length > 0 ? { resource: rows[0], role: "owner" } : null;
  }
  async function assertAccess(type: string, id: string) {
    const access = await resolveAccess(type, id);
    if (!access) throw new actual.ForbiddenError(`No access to ${type} ${id}`);
    return access;
  }
  function accessFilter(table: typeof schema.dashboards) {
    return eq(table.ownerEmail, "alice@example.com");
  }
  return { ...actual, resolveAccess, assertAccess, accessFilter };
});
vi.mock("@agent-native/core/settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/settings")>()),
  getOrgSetting: async () => null,
  getUserSetting: async () => null,
  deleteOrgSetting: async () => undefined,
  deleteUserSetting: async () => undefined,
  listSettingsByPrefix: async () => [],
}));
vi.mock("@agent-native/core/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/server")>()),
  getRequestUserEmail: () => "alice@example.com",
  getRequestOrgId: () => scope.orgId,
  getRequestRunContext: () => undefined,
  recordChange: () => undefined,
}));
vi.mock(
  "@agent-native/core/server/request-context",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@agent-native/core/server/request-context")
    >()),
    getCredentialContext: () => ({
      userEmail: "alice@example.com",
      orgId: scope.orgId,
    }),
  }),
);
vi.mock("@agent-native/core/tracking", () => ({ track: () => undefined }));
vi.mock("../server/lib/dashboard-collab-sync", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../server/lib/dashboard-collab-sync")
  >()),
  queueDashboardCollabSync: async () => undefined,
}));
vi.mock("../server/lib/bigquery", () => ({
  dryRunQuery: async () => null,
  dryRunQuerySchema: async () => ({ error: null }),
}));
vi.mock("../server/lib/first-party-analytics.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../server/lib/first-party-analytics.js")
  >()),
  validateFirstPartyAnalyticsSqlForScope: async () => undefined,
}));
vi.mock("../server/lib/dashboard-report-subscriptions", () => ({
  countEnabledDashboardReportSubscriptions: async () => 0,
}));
vi.mock("../server/lib/bigquery-agent-budget", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../server/lib/bigquery-agent-budget")
  >()),
  admitBigQueryAgentJob: budget.admit,
  settleBigQueryAgentJob: budget.settle,
  readBigQueryAgentBudget: budget.read,
}));
vi.mock("../server/lib/bigquery-agent-approval", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../server/lib/bigquery-agent-approval")
  >()),
  firstPartyQueriesRunOnBigQuery: async () => {
    if (scope.sinkUnreadable) throw new Error("settings read failed");
    return scope.sink === "bigquery";
  },
}));
vi.mock("../server/lib/dashboard-panel-source-resolver", () => ({
  resolveAnalyticsPanelSource: async () => {
    const { bigQueryJobGate } =
      await import("../server/lib/bigquery-agent-context");
    const gate = bigQueryJobGate();
    if (gate) {
      const admission = await gate.admit({
        projectId: "builder-3b0a2",
        jobId: `agent_native_${budget.admit.mock.calls.length + 1}`,
        credentialScope: "default",
        credentialFingerprint: null,
        exclusive: true,
        capBytes: gate.jobCapFor(750_000_000_000),
        estimate: async () => ({ status: "ok", bytes: 2 * 1024 ** 3 }),
      });
      await gate.settle(admission, async () => ({
        kind: "found",
        state: "DONE",
        billedBytes: 1024 ** 3,
        cacheHit: false,
        statementType: "SELECT",
        errorReason: null,
        location: "US",
      }));
    }
    return {
      rows: budget.rows,
      schema: Object.keys(budget.rows[0] ?? { label: "", n: 0 }).map(
        (name) => ({ name, type: "STRING" }),
      ),
    };
  },
}));

const schema = await import("../server/db/schema.js");
const { WRITE_RECEIPTS_MIGRATION_SQL } =
  await import("../server/lib/write-receipts-migration");
const {
  OUTSIDE_AGENT_JOB_CAP_BYTES,
  OUTSIDE_AGENT_ORG_LIMIT_BYTES,
  OUTSIDE_AGENT_PERSON_BASE_BYTES,
  OUTSIDE_AGENT_PERSON_CEILING_BYTES,
} = await import("../server/lib/bigquery-agent-budget");
const { default: getHealth } =
  await import("./get-first-party-analytics-health");
const actions = {
  compose: (await import("./compose-dashboard")).default,
  inspect: (await import("./inspect-dashboard-panel")).default,
  mutate: (await import("./mutate-dashboard")).default,
  restore: (await import("./restore-dashboard-revision")).default,
  update: (await import("./update-dashboard")).default,
};

const MCP = { caller: "mcp" } as ActionRunContext;
const IN_APP = { caller: "tool" } as ActionRunContext;
const SEED_AT = "2026-11-16T12:00:00.000Z";
const ALICE = "alice@example.com";
const ROWS = [{ label: "mail", n: 3, signups: 3 }];

let client: PGliteClient;
let keySeq = 0;
const newKey = () => `key-${++keySeq}`;

function createTableSql(table: PgTable): string {
  const config = getTableConfig(table);
  const dialect = new PgDialect();
  const columns = config.columns.map((column) => {
    let definition = `"${column.name}" ${column.getSQLType()}`;
    if (column.primary) definition += " PRIMARY KEY";
    if (column.notNull) definition += " NOT NULL";
    if (column.default !== undefined) {
      const value = column.default;
      definition += ` DEFAULT ${
        is(value, SQL)
          ? dialect.sqlToQuery(value).sql
          : typeof value === "string"
            ? `'${value.replace(/'/g, "''")}'`
            : String(value)
      }`;
    }
    return definition;
  });
  return `CREATE TABLE "${config.name}" (${columns.join(", ")})`;
}

function panel(id: string) {
  // raw-sql-ok: fixed fixture SQL written in this file, no runtime values.
  return {
    id,
    title: `Panel ${id}`,
    source: "bigquery",
    chartType: "table",
    width: 2,
    sql: `SELECT '${id}' AS label, 1 AS n`,
  };
}

function config(name: string, ids: string[]) {
  return { name, panels: ids.map(panel) };
}

async function seedDashboard(id: string, ids: string[]) {
  await harness.db.insert(schema.dashboards).values({
    id,
    kind: "sql",
    title: "Traffic",
    config: JSON.stringify(config("Traffic", ids)),
    ownerEmail: ALICE,
    orgId: null,
    visibility: "private",
    createdAt: SEED_AT,
    createdBy: ALICE,
    updatedAt: SEED_AT,
    updatedBy: ALICE,
    archivedAt: null,
    hiddenAt: null,
    hiddenBy: null,
    folderId: null,
  });
}

async function seedRevision(dashboardId: string, ids: string[]) {
  const id = `rev-${dashboardId}`;
  await harness.db.insert(schema.dashboardRevisions).values({
    id,
    dashboardId,
    kind: "sql",
    title: "Older",
    config: JSON.stringify(config("Older", ids)),
    createdAt: "2026-11-01T00:00:00.000Z",
    createdBy: ALICE,
    ownerEmail: ALICE,
    orgId: null,
  });
  return id;
}

function today() {
  return {
    utcDay: "2026-11-17",
    resetsAt: "2026-11-18T00:00:00.000Z",
    jobCapBytes: OUTSIDE_AGENT_JOB_CAP_BYTES,
    person: {
      limitBytes: OUTSIDE_AGENT_PERSON_BASE_BYTES,
      settledBytes: 10 * 1024 ** 2,
      reservedBytes: 0,
      remainingBytes: OUTSIDE_AGENT_PERSON_BASE_BYTES - 10 * 1024 ** 2,
      baseAllowanceBytes: OUTSIDE_AGENT_PERSON_BASE_BYTES,
      ceilingBytes: OUTSIDE_AGENT_PERSON_CEILING_BYTES,
      approvedToday: false,
    },
    org: {
      limitBytes: OUTSIDE_AGENT_ORG_LIMIT_BYTES,
      settledBytes: 10 * 1024 ** 2,
      reservedBytes: 0,
      remainingBytes: OUTSIDE_AGENT_ORG_LIMIT_BYTES - 10 * 1024 ** 2,
    },
    limitsSource: { person: "default", org: "default" },
  };
}

beforeAll(async () => {
  client = await PGlite.create();
  for (const table of [
    schema.dashboards,
    schema.dashboardRevisions,
    schema.dashboardNameLocks,
    schema.dashboardFolders,
  ]) {
    await client.exec(createTableSql(table));
  }
  for (const statement of WRITE_RECEIPTS_MIGRATION_SQL) {
    await client.exec(statement);
  }
  harness.db = drizzle(client);
});

beforeEach(async () => {
  await client.exec(`
    DELETE FROM dashboards; DELETE FROM dashboard_revisions;
    DELETE FROM dashboard_name_locks; DELETE FROM analytics_write_receipts;
  `);
  budget.rows = ROWS;
  budget.admit.mockReset();
  budget.admit.mockImplementation(async (_identity, request) => ({
    status: "admitted",
    requestId: `request-${request.jobId}`,
    reservedBytes: request.reservedBytes,
    created: true,
    leaseExpiresAt: new Date(Date.now() + request.leaseMs).toISOString(),
    budget: today(),
  }));
  budget.settle.mockClear();
  budget.read.mockReset();
  budget.read.mockResolvedValue(today());
  scope.orgId = null;
  scope.sink = "postgres";
  scope.sinkUnreadable = false;
});

interface ReportedCost {
  bigQueryBudget: {
    thisCall: unknown;
    today: { person: { remainingUsd: number } };
    jobs: Array<{
      billedUsd: number;
      estimatedUsd: number;
      reservedUsd: number;
    }>;
  };
}

function expectOneJob(output: unknown, source: string) {
  const result = output as ReportedCost;
  expect(result.bigQueryBudget).toMatchObject({
    thisCall: { jobsAdmitted: 1, stillReservedUsd: 0, cacheHits: 0 },
    jobs: [
      {
        jobId: expect.stringMatching(/^agent_native_/),
        cacheHit: false,
        state: "settled",
      },
    ],
    today: {
      person: { limitUsd: 1, noAskAllowanceUsd: 1 },
      org: { limitUsd: 50 },
      resetsAt: "2026-11-18T00:00:00.000Z",
    },
  });
  expect(result.bigQueryBudget.today.person.remainingUsd).toBeLessThan(1);
  expect(budget.admit).toHaveBeenCalledTimes(1);
  const request = must(budget.admit.mock.calls[0])[1];
  expect(request).toMatchObject({ source, estimatedBytes: 2 * 1024 ** 3 });
  expect(request.reservedBytes).toBeGreaterThan(request.estimatedBytes);
  const job = must(result.bigQueryBudget.jobs[0]);
  expect(job.billedUsd).toBeLessThan(job.estimatedUsd);
  expect(job.estimatedUsd).toBeLessThan(job.reservedUsd);
  expect(result.bigQueryBudget.thisCall).toMatchObject({
    reservedUsd: job.reservedUsd,
    billedUsd: job.billedUsd,
  });
}

describe("dashboard writes over MCP report their verification jobs' cost", () => {
  it("update-dashboard", async () => {
    await seedDashboard("d1", ["a"]);
    const result = await actions.update.run(
      {
        dashboardId: "d1",
        ops: [{ op: "insert", path: "/panels/1", value: panel("b") }],
        expectedUpdatedAt: SEED_AT,
        idempotencyKey: newKey(),
      },
      MCP,
    );
    expect(result).toMatchObject({ verified: true });
    expectOneJob(result, "update-dashboard");
  });

  it("mutate-dashboard", async () => {
    await seedDashboard("d1", ["a"]);
    const result = await actions.mutate.run(
      {
        dashboardId: "d1",
        operations: [{ op: "insertPanel", panel: panel("b") }],
        expectedUpdatedAt: SEED_AT,
        idempotencyKey: newKey(),
      },
      MCP,
    );
    expect(result).toMatchObject({ verified: true });
    expectOneJob(result, "mutate-dashboard");
  });

  it("compose-dashboard", async () => {
    const result = await actions.compose.run(
      {
        dashboardId: "composed",
        title: "Signups",
        metrics: ["total-signups"],
        idempotencyKey: newKey(),
      },
      MCP,
    );
    expect(result).toMatchObject({ verified: true });
    expectOneJob(result, "compose-dashboard");
  });

  it("restore-dashboard-revision", async () => {
    await seedDashboard("d1", ["a"]);
    const revisionId = await seedRevision("d1", ["a", "b"]);
    const result = await actions.restore.run(
      {
        dashboardId: "d1",
        revisionId,
        expectedUpdatedAt: SEED_AT,
        idempotencyKey: newKey(),
      },
      MCP,
    );
    expect(result).toMatchObject({ verified: true });
    expectOneJob(result, "restore-dashboard-revision");
  });

  it("inspect-dashboard-panel", async () => {
    await seedDashboard("d1", ["a"]);
    const result = await actions.inspect.run(
      { dashboardId: "d1", panelId: "a" },
      MCP,
    );
    expect(result).toMatchObject({ status: "ok" });
    expectOneJob(result, "panel-verification");
  });

  it("names the spend in a refused save, whose message is all an MCP client sees", async () => {
    await seedDashboard("d1", ["a"]);
    budget.rows = [];
    const error = await actions.update
      .run(
        {
          dashboardId: "d1",
          ops: [{ op: "insert", path: "/panels/1", value: panel("b") }],
          expectedUpdatedAt: SEED_AT,
          idempotencyKey: newKey(),
        },
        MCP,
      )
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({
      errorCode: "dashboard_panel_verification_failed",
      message: expect.stringContaining(
        "BigQuery jobs this call ran against your outside-agent budget: 1, reserved ",
      ),
    });
    expect((error as Error).message).toMatch(/Left today: .*00:00 UTC/);
    expect((error as Error).message.match(/BigQuery jobs this call/g)).toEqual([
      "BigQuery jobs this call",
    ]);
    expect(budget.admit).toHaveBeenCalledTimes(1);
  });
});

describe("a paid verification is reported however the MCP write then ends", () => {
  const SPEND =
    "BigQuery jobs this call ran against your outside-agent budget: 1, reserved ";
  const update = (extra: Record<string, unknown>) =>
    actions.update.run(
      {
        dashboardId: "d1",
        expectedUpdatedAt: SEED_AT,
        idempotencyKey: newKey(),
        ...extra,
      },
      MCP,
    );

  function anotherWriterSavesDuringVerification() {
    budget.settle.mockImplementationOnce(async () => {
      const { eq } = await import("drizzle-orm");
      await harness.db
        .update(schema.dashboards)
        .set({ updatedAt: "2026-11-17T00:01:00.000Z" })
        .where(eq(schema.dashboards.id, "d1"));
      return true;
    });
  }

  it.each([
    [
      "update-dashboard with ops",
      () =>
        update({
          ops: [{ op: "insert", path: "/panels/1", value: panel("b") }],
        }),
    ],
    [
      "update-dashboard with a config",
      () => update({ config: config("Traffic", ["a", "b"]) }),
    ],
    [
      "mutate-dashboard",
      () =>
        actions.mutate.run(
          {
            dashboardId: "d1",
            operations: [{ op: "insertPanel", panel: panel("b") }],
            expectedUpdatedAt: SEED_AT,
            idempotencyKey: newKey(),
          },
          MCP,
        ),
    ],
    [
      "compose-dashboard",
      () =>
        actions.compose.run(
          {
            dashboardId: "d1",
            metrics: ["total-signups"],
            expectedUpdatedAt: SEED_AT,
            idempotencyKey: newKey(),
          },
          MCP,
        ),
    ],
  ])(
    "%s keeps its conflict and names the spend when another save lands during verification",
    async (_label, write) => {
      await seedDashboard("d1", ["a"]);
      anotherWriterSavesDuringVerification();
      const error = await write().catch((caught: unknown) => caught);
      expect(budget.admit).toHaveBeenCalledTimes(1);
      expect(error).toMatchObject({
        statusCode: 409,
        errorCode: "dashboard_conflict",
      });
      const message = (error as Error).message;
      expect(message).toMatch(/^Dashboard "d1" .*changed/);
      expect(message).toContain(SPEND);
      expect(message).toMatch(/Left today: .*00:00 UTC/);
    },
  );

  it("returns the spend with the receipt when a duplicate under the same key saved first", async () => {
    await seedDashboard("d1", ["a"]);
    const ops = [{ op: "insert", path: "/panels/1", value: panel("b") }];
    const idempotencyKey = newKey();
    budget.settle.mockImplementationOnce(async () => {
      const { guardWrite } = await import("../server/lib/guarded-writes");
      const { upsertDashboardWithRetryOutcome } =
        await import("../server/lib/dashboards-store");
      const scope = { email: ALICE, orgId: null };
      const duplicate = guardWrite({
        action: "update-dashboard",
        target: { kind: "dashboard", id: "d1" },
        caller: "mcp",
        scope,
        idempotencyKey,
        expectedUpdatedAt: SEED_AT,
        request: {
          ops,
          panelOrder: null,
          config: null,
          allowEmptyResult: false,
        },
      });
      await upsertDashboardWithRetryOutcome(
        "d1",
        scope,
        () => ({ kind: "sql", body: config("Traffic", ["a", "b"]) }),
        undefined,
        duplicate.store,
      );
      return true;
    });
    const result = await actions.update.run(
      { dashboardId: "d1", ops, expectedUpdatedAt: SEED_AT, idempotencyKey },
      MCP,
    );
    expect(result).toMatchObject({
      replayed: true,
      writeReceipt: { idempotency: { result: "replayed" } },
    });
    expectOneJob(result, "update-dashboard");
  });

  it("leaves a failure before any job unchanged", async () => {
    await seedDashboard("d1", ["a"]);
    const error = await update({
      config: config("Traffic", ["a", "b"]),
      expectedUpdatedAt: "2026-11-01T00:00:00.000Z",
    }).catch((caught: unknown) => caught);
    expect(budget.admit).not.toHaveBeenCalled();
    expect(error).toMatchObject({ statusCode: 409 });
    expect((error as Error).message).not.toContain("BigQuery");
  });
});

describe("in-app dashboard writes are unchanged", () => {
  it("update-dashboard and inspect-dashboard-panel admit nothing and report no budget", async () => {
    await seedDashboard("d1", ["a"]);
    const updated = await actions.update.run(
      {
        dashboardId: "d1",
        ops: [{ op: "insert", path: "/panels/1", value: panel("b") }],
      },
      IN_APP,
    );
    const inspected = await actions.inspect.run(
      { dashboardId: "d1", panelId: "a" },
      IN_APP,
    );
    expect(updated).toMatchObject({ verified: true });
    expect(updated).not.toHaveProperty("bigQueryBudget");
    expect(inspected).not.toHaveProperty("bigQueryBudget");
    expect(budget.admit).not.toHaveBeenCalled();
    expect(budget.read).not.toHaveBeenCalled();
  });
});

describe("an MCP dashboard edit past the no-ask allowance", () => {
  const SAVED =
    "Saved, but not run: b, whose BigQuery queries would take you past today's no-ask allowance; inspect-dashboard-panel would stop at the same point.";
  const ASKING_READS =
    "a get-onboarding-journey or get-first-party-analytics-health call over MCP asks the person once, on Analytics' review page, when it needs more.";
  const ADMIN =
    "An Analytics organization admin can raise the daily allowance.";
  const UNTIL = "Until then, do not claim those panels render.";

  function nearlySpent() {
    const snapshot = today();
    const settledBytes = OUTSIDE_AGENT_PERSON_BASE_BYTES - 10 * 1024 ** 2;
    return {
      ...snapshot,
      person: {
        ...snapshot.person,
        settledBytes,
        remainingBytes: OUTSIDE_AGENT_PERSON_BASE_BYTES - settledBytes,
      },
    };
  }

  async function editPastTheAllowance() {
    await seedDashboard("d1", ["a"]);
    budget.read.mockResolvedValue(nearlySpent());
    budget.admit.mockImplementation(async (_identity, request) => ({
      status: "refused",
      code: "approval_required",
      scope: "person",
      reservedBytes: request.reservedBytes,
      budget: nearlySpent(),
    }));
    const result = (await actions.mutate.run(
      {
        dashboardId: "d1",
        operations: [{ op: "insertPanel", panel: panel("b") }],
        expectedUpdatedAt: SEED_AT,
        idempotencyKey: newKey(),
      },
      MCP,
    )) as {
      verified: boolean;
      nextStep: string;
      unverified: Array<{ panelId: string; note?: string; reason: string }>;
    };
    const [saved] = await harness.db
      .select({ config: schema.dashboards.config })
      .from(schema.dashboards);
    expect(JSON.parse(must(saved).config).panels).toHaveLength(2);
    expect(result.verified).toBe(false);
    expect(result.unverified).toEqual([
      {
        panelId: "b",
        title: "Panel b",
        status: "unverified",
        note: "outside_agent_approval_required",
        reason:
          "its query would take the outside agent past today's no-ask BigQuery allowance, so it was not run",
      },
    ]);
    return result.nextStep;
  }

  it.each([
    {
      sink: "bigquery",
      orgId: "org-1",
      readsAsk: true,
      help: `A dashboard edit can't ask for more, but ${ASKING_READS} ${ADMIN}`,
    },
    {
      sink: "bigquery",
      orgId: null,
      readsAsk: true,
      help: `A dashboard edit can't ask for more, but ${ASKING_READS}`,
    },
    { sink: "dual", orgId: "org-1", readsAsk: false, help: ADMIN },
    {
      sink: "postgres",
      orgId: null,
      readsAsk: false,
      help: "Nothing can raise today's no-ask allowance, which resets at 00:00 UTC.",
    },
  ])(
    "is saved, and names only what can raise the allowance (sink $sink, org $orgId)",
    async ({ sink, orgId, readsAsk, help }) => {
      scope.sink = sink;
      scope.orgId = orgId;
      expect(await editPastTheAllowance()).toBe(`${SAVED} ${help} ${UNTIL}`);
      expect(
        await must(getHealth.mcpNeedsApproval)(
          {},
          { userEmail: ALICE, orgId, caller: "mcp" },
        ),
      ).toBe(readsAsk);
    },
  );

  it("says the reads ask only on BigQuery when where its queries run can't be read", async () => {
    scope.sinkUnreadable = true;
    expect(await editPastTheAllowance()).toBe(
      `${SAVED} A dashboard edit can't ask for more; if Analytics' first-party queries run on BigQuery, ${ASKING_READS} ${UNTIL}`,
    );
  });
});
