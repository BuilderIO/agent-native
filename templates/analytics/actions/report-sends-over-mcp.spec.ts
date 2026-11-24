import { createRequire } from "node:module";

import type { ActionRunContext } from "@agent-native/core/action";
import { drizzle } from "drizzle-orm/pglite";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const { PGlite } = createRequire(
  new URL("../../../packages/core/package.json", import.meta.url),
)("@electric-sql/pglite");

const harness = vi.hoisted(() => ({
  db: null as unknown,
  email: "alice@example.com",
  sweep: vi.fn(),
  openDashboard: vi.fn(),
}));

vi.mock("../server/db/index.js", async () => ({
  getDb: () => harness.db,
  schema: await vi.importActual("../server/db/schema.js"),
}));
vi.mock("@agent-native/core/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/server")>()),
  getRequestUserEmail: () => harness.email,
  getRequestOrgId: () => null,
  recordChange: () => undefined,
}));
vi.mock("../server/jobs/dashboard-report", () => ({
  runDashboardReportsOnce: harness.sweep,
}));
vi.mock("../server/lib/open-dashboard", () => ({
  openDashboard: harness.openDashboard,
}));

type Run = (
  args: Record<string, unknown>,
  ctx?: ActionRunContext,
) => Promise<unknown>;

const { WRITE_RECEIPTS_MIGRATION_SQL } =
  await import("../server/lib/write-receipts-migration");
const { queueDashboardReportSubscriptionNow } =
  await import("../server/lib/dashboard-report-subscriptions");
const sendNow = (await import("./send-dashboard-report-now")).default
  .run as unknown as Run;
const save = (await import("./save-dashboard-report-subscription")).default
  .run as unknown as Run;

const MCP = { caller: "mcp" } as ActionRunContext;
const IN_APP = { caller: "tool" } as ActionRunContext;
const ALICE = "alice@example.com";
const DASHBOARD = "traffic";
const SEED_AT = "2026-11-16T12:00:00.000Z";

let client: Awaited<ReturnType<typeof PGlite.create>>;

beforeAll(async () => {
  client = await PGlite.create();
  await client.exec(`
    CREATE TABLE dashboards (id TEXT PRIMARY KEY, hidden_by TEXT);
    CREATE TABLE dashboard_report_subscriptions (
      id TEXT PRIMARY KEY, dashboard_id TEXT NOT NULL, name TEXT NOT NULL,
      recipients TEXT NOT NULL, slack_webhook_url TEXT, filters TEXT NOT NULL,
      frequency TEXT NOT NULL, time_of_day TEXT NOT NULL, timezone TEXT NOT NULL,
      enabled BOOLEAN NOT NULL, next_run_at TEXT, last_run_at TEXT, last_status TEXT,
      last_error TEXT, last_capture_at TEXT, last_capture_mode TEXT, last_capture_error TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, owner_email TEXT NOT NULL, org_id TEXT
    );
  `);
  for (const statement of WRITE_RECEIPTS_MIGRATION_SQL) {
    await client.exec(statement);
  }
  harness.db = drizzle(client);
});

afterAll(async () => {
  await client.close();
});

beforeEach(async () => {
  await client.exec(`
    DELETE FROM dashboards; DELETE FROM dashboard_report_subscriptions;
    DELETE FROM analytics_write_receipts;
  `);
  await client.query("INSERT INTO dashboards (id) VALUES ($1)", [DASHBOARD]);
  await client.query(
    `INSERT INTO dashboard_report_subscriptions (id, dashboard_id, name, recipients, filters, frequency, time_of_day, timezone, enabled, created_at, updated_at, owner_email, org_id)
     VALUES ('weekly', $1, 'Weekly', $2, '{}', 'daily', '09:00', 'UTC', false, $3, $3, $4, NULL)`,
    [DASHBOARD, JSON.stringify([ALICE]), SEED_AT, ALICE],
  );
  harness.email = ALICE;
  harness.sweep.mockReset();
  harness.sweep.mockResolvedValue({ processed: 1, failed: 0, remaining: 0 });
  harness.openDashboard.mockResolvedValue({
    saved: {
      id: DASHBOARD,
      kind: "sql",
      title: "Traffic",
      config: {},
      ownerEmail: ALICE,
      orgId: null,
    },
  });
});

async function seededRow() {
  const { rows } = await client.query(
    "SELECT enabled, next_run_at, updated_at FROM dashboard_report_subscriptions WHERE id = 'weekly'",
  );
  return rows[0];
}

async function receiptIds() {
  const { rows } = await client.query(
    "SELECT id FROM analytics_write_receipts",
  );
  return rows.map((row: { id: string }) => row.id);
}

async function subscriptionIds() {
  const { rows } = await client.query(
    "SELECT id FROM dashboard_report_subscriptions ORDER BY id",
  );
  return rows.map((row: { id: string }) => row.id);
}

describe("send-dashboard-report-now over MCP", () => {
  it("refuses a send without idempotencyKey and queues nothing", async () => {
    await expect(sendNow({ id: "weekly" }, MCP)).rejects.toThrow(
      "send-dashboard-report-now over MCP requires idempotencyKey",
    );
    expect(await seededRow()).toEqual({
      enabled: false,
      next_run_at: null,
      updated_at: SEED_AT,
    });
    expect(await receiptIds()).toEqual([]);
    expect(harness.sweep).not.toHaveBeenCalled();
  });

  it("queues a keyed send once and answers its retry from the receipt", async () => {
    const first = await sendNow(
      { id: "weekly", idempotencyKey: "send-1" },
      MCP,
    );
    const queued = await seededRow();
    const [receiptId] = await receiptIds();
    expect(first).toMatchObject({
      id: "weekly",
      success: true,
      queued: true,
      mode: "inline-sweep",
      writeReceipt: {
        receiptId,
        action: "send-dashboard-report-now",
        target: { kind: "report-subscription", id: "weekly" },
        revision: { before: SEED_AT, after: queued.updated_at },
        idempotency: { key: "send-1", result: "applied" },
      },
    });
    expect(queued).toMatchObject({ enabled: true });
    expect(queued.next_run_at).toBe(queued.updated_at);
    expect(harness.sweep).toHaveBeenCalledTimes(1);

    const retry = await sendNow(
      { id: "weekly", idempotencyKey: "send-1" },
      MCP,
    );
    expect(retry).toMatchObject({
      id: "weekly",
      queued: true,
      replayed: true,
      writeReceipt: { receiptId, idempotency: { result: "replayed" } },
      message: expect.stringContaining("nothing was sent again"),
    });
    expect(await seededRow()).toEqual(queued);
    expect(await receiptIds()).toEqual([receiptId]);
    expect(harness.sweep).toHaveBeenCalledTimes(1);
  });

  it("answers another user's subscription as not found and records nothing", async () => {
    harness.email = "bob@example.com";
    await expect(
      sendNow({ id: "weekly", idempotencyKey: "send-2" }, MCP),
    ).rejects.toThrow("Report subscription not found");
    expect(await seededRow()).toMatchObject({ enabled: false });
    expect(await receiptIds()).toEqual([]);
    expect(harness.sweep).not.toHaveBeenCalled();
  });

  it("queues only the named subscription, never every one the caller owns", async () => {
    await client.query(
      `INSERT INTO dashboard_report_subscriptions (id, dashboard_id, name, recipients, filters, frequency, time_of_day, timezone, enabled, created_at, updated_at, owner_email, org_id)
       VALUES ('monthly', $1, 'Monthly', $2, '{}', 'daily', '09:00', 'UTC', false, $3, $3, $4, NULL)`,
      [DASHBOARD, JSON.stringify([ALICE]), SEED_AT, ALICE],
    );
    await expect(
      sendNow({ id: "", idempotencyKey: "send-3" }, MCP),
    ).rejects.toThrow("Invalid action parameters");
    await expect(
      queueDashboardReportSubscriptionNow("", { email: ALICE, orgId: null }),
    ).resolves.toBeNull();
    const { rows } = await client.query(
      "SELECT id FROM dashboard_report_subscriptions WHERE enabled",
    );
    expect(rows).toEqual([]);
    expect(await receiptIds()).toEqual([]);
    expect(harness.sweep).not.toHaveBeenCalled();
  });

  it("sends for the in-app agent without a key, as before", async () => {
    const result = await sendNow({ id: "weekly" }, IN_APP);
    expect(result).toMatchObject({ id: "weekly", queued: true });
    expect(result).not.toHaveProperty("writeReceipt");
    expect(await seededRow()).toMatchObject({ enabled: true });
    expect(await receiptIds()).toEqual([]);
    expect(harness.sweep).toHaveBeenCalledTimes(1);
  });
});

describe("save-dashboard-report-subscription over MCP", () => {
  const input = {
    dashboardId: DASHBOARD,
    recipients: [ALICE],
    timeOfDay: "09:00",
    timezone: "UTC",
    enabled: true,
  };

  it("refuses a save without idempotencyKey and writes nothing", async () => {
    await expect(save(input, MCP)).rejects.toThrow(
      "save-dashboard-report-subscription over MCP requires idempotencyKey",
    );
    expect(await subscriptionIds()).toEqual(["weekly"]);
    expect(await receiptIds()).toEqual([]);
  });

  it("creates one subscription for a repeated key", async () => {
    const first = await save({ ...input, idempotencyKey: "save-1" }, MCP);
    const created = (await subscriptionIds()).filter((id) => id !== "weekly");
    expect(created).toHaveLength(1);
    expect(first).toMatchObject({
      id: created[0],
      dashboardId: DASHBOARD,
      writeReceipt: {
        target: { kind: "report-subscription", id: created[0] },
        revision: { before: null },
        idempotency: { key: "save-1", result: "applied" },
      },
    });

    const retry = await save({ ...input, idempotencyKey: "save-1" }, MCP);
    expect(retry).toMatchObject({
      id: created[0],
      replayed: true,
      writeReceipt: { idempotency: { result: "replayed" } },
    });
    expect(await subscriptionIds()).toEqual([...created, "weekly"].sort());
    expect(await receiptIds()).toHaveLength(1);
  });

  it("records the version an update replaced", async () => {
    const result = await save(
      { ...input, id: "weekly", name: "Renamed", idempotencyKey: "save-2" },
      MCP,
    );
    expect(result).toMatchObject({
      id: "weekly",
      name: "Renamed",
      writeReceipt: {
        target: { kind: "report-subscription", id: "weekly" },
        revision: { before: SEED_AT },
      },
    });
  });
});
