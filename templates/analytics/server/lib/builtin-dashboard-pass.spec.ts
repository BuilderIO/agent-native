import { createRequire } from "node:module";

import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { PGlite } = createRequire(
  new URL("../../../../packages/core/package.json", import.meta.url),
)("@electric-sql/pglite");

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  settings: new Map<string, Record<string, unknown>>(),
}));

vi.mock("../db/index.js", async () => {
  const schema =
    await vi.importActual<typeof import("../db/schema.js")>("../db/schema.js");
  return { getDb: mocks.getDb, schema };
});
vi.mock("./dashboards-store", () => ({
  getDashboard: vi.fn(async () => null),
}));
vi.mock("@agent-native/core/settings", () => {
  const mutate =
    (scope: string) =>
    async (
      id: string,
      key: string,
      update: (current: Record<string, unknown> | null) => any,
    ) => {
      const next = await update(
        mocks.settings.get(`${scope}:${id}:${key}`) ?? null,
      );
      mocks.settings.set(`${scope}:${id}:${key}`, next);
      return next;
    };
  return {
    getUserSetting: async (email: string, key: string) =>
      mocks.settings.get(`u:${email}:${key}`) ?? null,
    getOrgSetting: async (orgId: string, key: string) =>
      mocks.settings.get(`o:${orgId}:${key}`) ?? null,
    mutateUserSetting: mutate("u"),
    mutateOrgSetting: mutate("o"),
    putUserSetting: async () => undefined,
  };
});

import { BUILTIN_DASHBOARD_HIDDEN_BY } from "../../shared/builtin-dashboard-ids.js";
import * as dbModule from "../db/index.js";
import { BUILTIN_DASHBOARD_CHECKS_MIGRATION_SQL } from "./builtin-dashboard-checks-migration.js";
import {
  restoreBuiltinDashboardPass,
  runBuiltinDashboardPass,
} from "./builtin-dashboard-pass.js";
import { loadBuiltinDashboard } from "./builtin-dashboards.js";
import { DATA_NOTES_MIGRATION_SQL } from "./data-notes-migration.js";
import { demoNodeExporterConfig } from "./demo-dashboards.js";
import {
  compileNativeV2Dashboard,
  getNativeV2DashboardManifest,
} from "./native-v2-dashboards.js";

const TABLES = [
  `CREATE TABLE dashboards (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL,
    config TEXT NOT NULL, certification TEXT,
    created_at TEXT NOT NULL, created_by TEXT, updated_at TEXT NOT NULL,
    archived_at TEXT, hidden_at TEXT, hidden_by TEXT, folder_id TEXT,
    updated_by TEXT, github_sync_state TEXT,
    owner_email TEXT NOT NULL, org_id TEXT, visibility TEXT NOT NULL
  )`,
  `CREATE TABLE dashboard_shares (id TEXT PRIMARY KEY, resource_id TEXT NOT NULL)`,
  `CREATE TABLE dashboard_views (id TEXT PRIMARY KEY, dashboard_id TEXT NOT NULL)`,
  `CREATE TABLE dashboard_report_subscriptions (id TEXT PRIMARY KEY, dashboard_id TEXT NOT NULL)`,
  ...DATA_NOTES_MIGRATION_SQL,
  ...BUILTIN_DASHBOARD_CHECKS_MIGRATION_SQL,
];

const UPDATED_AT = "2026-09-01T00:00:00.000Z";

/** A copy as the old demo installer wrote it, install stamps included. */
function legacyDemoConfig(): Record<string, any> {
  const config = demoNodeExporterConfig() as Record<string, any>;
  return {
    ...config,
    demo: { ...config.demo, installedAt: "2026-08-01T00:00:00.000Z" },
    catalog: { ...config.catalog, installedAt: "2026-08-01T00:00:00.000Z" },
  };
}

describe("built-in dashboard deploy pass", () => {
  type PGliteClient = Awaited<ReturnType<typeof PGlite.create>>;
  let client: PGliteClient;

  async function insertCopy(
    id: string,
    config: Record<string, unknown>,
    extra: Partial<Record<"visibility" | "org_id" | "folder_id", string>> = {},
  ) {
    await client.query(
      `INSERT INTO dashboards (id, kind, title, config, created_at, updated_at, owner_email, org_id, visibility, folder_id)
       VALUES ($1, 'sql', $2, $3, $4, $4, 'alice@example.test', $5, $6, $7)`,
      [
        id,
        config.name,
        JSON.stringify(config),
        UPDATED_AT,
        extra.org_id ?? null,
        extra.visibility ?? "private",
        extra.folder_id ?? null,
      ],
    );
  }

  async function row(id: string) {
    const result = await client.query(
      `SELECT hidden_at, hidden_by, updated_at FROM dashboards WHERE id = $1`,
      [id],
    );
    return result.rows[0] as {
      hidden_at: string | null;
      hidden_by: string | null;
      updated_at: string;
    };
  }

  beforeEach(async () => {
    client = await PGlite.create("memory://");
    mocks.getDb.mockReturnValue(drizzle(client, { schema: dbModule.schema }));
    mocks.settings.clear();
    for (const statement of TABLES) await client.exec(statement);
  });

  afterEach(async () => {
    await client.close();
  });

  it("hides an untouched copy without touching its version, and records it", async () => {
    await insertCopy("demo-node-exporter-0a1b2c3d", legacyDemoConfig());

    const result = await runBuiltinDashboardPass();

    expect(result).toMatchObject({ checked: 1, hidden: 1, kept: 0 });
    expect(await row("demo-node-exporter-0a1b2c3d")).toMatchObject({
      hidden_by: BUILTIN_DASHBOARD_HIDDEN_BY,
      updated_at: UPDATED_AT,
    });
    const checks = await client.query(
      `SELECT builtin_id, outcome, reasons FROM analytics_builtin_dashboard_checks`,
    );
    expect(checks.rows).toEqual([
      {
        builtin_id: "builtin-demo-node-exporter",
        outcome: "hidden",
        reasons: "[]",
      },
    ]);
  });

  it("keeps every copy that is somebody's work, with the reason", async () => {
    const edited = legacyDemoConfig();
    edited.panels = edited.panels.slice(1);
    await insertCopy("demo-node-exporter-00000001", edited);
    const older = legacyDemoConfig();
    older.demo.version = "2026-01-01-old";
    older.catalog.templateVersion = "2026-01-01-old";
    await insertCopy("demo-node-exporter-00000002", older);
    await insertCopy("demo-node-exporter-00000003", legacyDemoConfig());
    await client.exec(
      `INSERT INTO dashboard_shares VALUES ('s1', 'demo-node-exporter-00000003')`,
    );
    await insertCopy("demo-node-exporter-00000004", legacyDemoConfig());
    await client.exec(
      `INSERT INTO dashboard_views VALUES ('v1', 'demo-node-exporter-00000004')`,
    );
    await insertCopy("demo-node-exporter-00000005", legacyDemoConfig());
    await client.query(
      `INSERT INTO analytics_data_notes (id, owner_email, kind, title, note, panels) VALUES ('n1', 'alice@example.test', 'incident', 'Outage', 'x', $1)`,
      [
        JSON.stringify([
          { dashboardId: "demo-node-exporter-00000005", panelId: "cpu" },
        ]),
      ],
    );
    await insertCopy("demo-node-exporter-00000006", legacyDemoConfig(), {
      folder_id: "folder-1",
    });

    const result = await runBuiltinDashboardPass();

    expect(result).toMatchObject({ checked: 6, hidden: 0, kept: 6 });
    expect(result.keptByReason).toEqual({
      edited: 1,
      older_version: 1,
      shared: 1,
      saved_views: 1,
      data_notes: 1,
      in_folder: 1,
    });
    const hidden = await client.query(
      `SELECT id FROM dashboards WHERE hidden_at IS NOT NULL`,
    );
    expect(hidden.rows).toEqual([]);
  });

  it("only counts on a dry run", async () => {
    await insertCopy("demo-node-exporter-0a1b2c3d", legacyDemoConfig());

    const result = await runBuiltinDashboardPass({ dryRun: true });

    expect(result).toMatchObject({ dryRun: true, hidden: 1 });
    expect((await row("demo-node-exporter-0a1b2c3d")).hidden_at).toBeNull();
    const checks = await client.query(
      `SELECT * FROM analytics_builtin_dashboard_checks`,
    );
    expect(checks.rows).toEqual([]);
  });

  it("restores what it hid, and never hides those copies again", async () => {
    await insertCopy("demo-node-exporter-0a1b2c3d", legacyDemoConfig());
    await runBuiltinDashboardPass();

    expect(await runBuiltinDashboardPass()).toMatchObject({
      checked: 0,
      alreadyChecked: 0,
    });
    expect(await restoreBuiltinDashboardPass()).toEqual({ restored: 1 });
    expect(await row("demo-node-exporter-0a1b2c3d")).toMatchObject({
      hidden_at: null,
      hidden_by: null,
    });

    expect(await runBuiltinDashboardPass()).toMatchObject({
      hidden: 0,
      alreadyChecked: 1,
    });
    expect((await row("demo-node-exporter-0a1b2c3d")).hidden_at).toBeNull();
  });

  it("moves an org's untouched native copy onto the built-in with its bindings", async () => {
    const bindings = {
      "roi.kpi": { programId: "dp-roi-kpi" },
      "roi.trend": { programId: "dp-roi-trend" },
      "roi.detail": { programId: "dp-roi-detail" },
    };
    const config = compileNativeV2Dashboard(
      getNativeV2DashboardManifest("customer-roi-v2"),
      bindings,
      "2026-08-01T00:00:00.000Z",
    ) as unknown as Record<string, unknown>;
    await insertCopy("native-customer-roi-v2-0123456789", config, {
      org_id: "org-1",
      visibility: "org",
    });

    const result = await runBuiltinDashboardPass();

    expect(result.byBuiltin).toEqual({
      "builtin-customer-roi-v2": { hidden: 1, kept: 0 },
    });
    const builtin = await loadBuiltinDashboard("builtin-customer-roi-v2", {
      email: "bob@example.test",
      orgId: "org-1",
    });
    expect(JSON.stringify(builtin?.config)).toContain("dp-roi-trend");
  });
});
