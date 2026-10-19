import { createRequire } from "node:module";

import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { PGlite } = createRequire(
  new URL("../../../../packages/core/package.json", import.meta.url),
)("@electric-sql/pglite");
const mocks = vi.hoisted(() => ({ getDb: vi.fn(), openDashboard: vi.fn() }));
vi.mock("../db/index.js", async () => ({
  getDb: mocks.getDb,
  schema: await vi.importActual("../db/schema.js"),
}));
vi.mock("./open-dashboard", () => ({ openDashboard: mocks.openDashboard }));
vi.mock("@agent-native/core/server", () => ({ recordChange: vi.fn() }));

import { BUILTIN_DASHBOARD_HIDDEN_BY } from "../../shared/builtin-dashboard-ids.js";
import { saveDashboardReportSubscription } from "./dashboard-report-subscriptions";

const ctx = { email: "owner@example.test", orgId: null };
const input = {
  dashboardId: "demo-node-exporter-aabbccdd",
  recipients: [ctx.email],
  timeOfDay: "09:00",
  timezone: "UTC",
  enabled: true,
};
const opened = {
  saved: {
    id: input.dashboardId,
    kind: "sql",
    title: "Copy",
    config: {},
    ownerEmail: ctx.email,
    orgId: null,
  },
};

describe("report subscription dashboard locking", () => {
  type Client = Awaited<ReturnType<typeof PGlite.create>>;
  let client: Client;
  let db: ReturnType<typeof drizzle>;
  let queries: string[];

  beforeEach(async () => {
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
    await client.query("INSERT INTO dashboards (id) VALUES ($1)", [
      input.dashboardId,
    ]);
    queries = [];
    db = drizzle(client, {
      logger: { logQuery: (query: string) => queries.push(query) },
    });
    mocks.getDb.mockReturnValue(db);
    mocks.openDashboard.mockResolvedValue(opened);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await client.close();
  });

  it("locks the parent before inserting a report subscription", async () => {
    const saved = await saveDashboardReportSubscription(input, ctx);
    expect(saved.dashboardId).toBe(input.dashboardId);
    const lock = queries.findIndex(
      (query) =>
        query.includes('from "dashboards"') && query.endsWith("for update"),
    );
    const insert = queries.findIndex((query) =>
      query.startsWith('insert into "dashboard_report_subscriptions"'),
    );
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(insert).toBeGreaterThan(lock);
  });

  it.each([false, true])(
    "rejects a deploy hide after the initial read (update=%s)",
    async (update) => {
      const existing = update
        ? await saveDashboardReportSubscription(input, ctx)
        : null;
      mocks.openDashboard.mockImplementationOnce(async () => {
        await client.query(
          "UPDATE dashboards SET hidden_by = $1 WHERE id = $2",
          [BUILTIN_DASHBOARD_HIDDEN_BY, input.dashboardId],
        );
        return opened;
      });
      await expect(
        saveDashboardReportSubscription(
          { ...input, id: existing?.id, name: "Changed" },
          ctx,
        ),
      ).rejects.toThrow("changed between read and write");
      const rows = await client.query(
        "SELECT name FROM dashboard_report_subscriptions",
      );
      expect(rows.rows).toEqual(update ? [{ name: "Copy daily email" }] : []);
    },
  );

  it("continues to support built-ins without a stored parent", async () => {
    mocks.openDashboard.mockResolvedValue({
      builtin: { id: "builtin-demo-node-exporter", title: "Demo", config: {} },
    });
    const saved = await saveDashboardReportSubscription(
      { ...input, dashboardId: "builtin-demo-node-exporter" },
      ctx,
    );
    expect(saved.dashboardId).toBe("builtin-demo-node-exporter");
  });

  it("rejects a custom parent deleted after the initial read", async () => {
    mocks.openDashboard.mockResolvedValue({
      saved: { ...opened.saved, id: "custom-dashboard" },
    });
    await expect(
      saveDashboardReportSubscription(
        { ...input, dashboardId: "custom-dashboard" },
        ctx,
      ),
    ).rejects.toThrow("changed between read and write");
    const rows = await client.query(
      "SELECT id FROM dashboard_report_subscriptions",
    );
    expect(rows.rows).toEqual([]);
  });

  it("continues to support an alias already forwarding to a built-in", async () => {
    await client.query("UPDATE dashboards SET hidden_by = $1 WHERE id = $2", [
      BUILTIN_DASHBOARD_HIDDEN_BY,
      input.dashboardId,
    ]);
    mocks.openDashboard.mockResolvedValue({
      builtin: { id: "builtin-demo-node-exporter", title: "Demo", config: {} },
    });
    const saved = await saveDashboardReportSubscription(input, ctx);
    expect(saved.dashboardId).toBe(input.dashboardId);
    expect(saved.name).toBe("Demo daily email");
  });
});
