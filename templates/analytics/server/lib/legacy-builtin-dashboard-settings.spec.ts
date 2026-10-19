import { createRequire } from "node:module";

import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { PGlite } = createRequire(
  new URL("../../../../packages/core/package.json", import.meta.url),
)("@electric-sql/pglite");
const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("../db/index.js", async () => ({
  getDb: mocks.getDb,
  schema: await vi.importActual("../db/schema.js"),
}));
vi.mock("./dashboards-store", () => ({
  getDashboard: vi.fn(async () => null),
}));
vi.mock("@agent-native/core/settings", () => ({
  getUserSetting: async () => null,
  getOrgSetting: async () => null,
  mutateUserSetting: async () => undefined,
  mutateOrgSetting: async () => undefined,
  putUserSetting: async () => undefined,
}));

import {
  BUILTIN_DASHBOARD_HIDDEN_BY,
  builtinDashboardIdForLegacyId,
} from "../../shared/builtin-dashboard-ids.js";
import * as dbModule from "../db/index.js";
import { BUILTIN_DASHBOARD_CHECKS_MIGRATION_SQL } from "./builtin-dashboard-checks-migration.js";
import { runBuiltinDashboardPass } from "./builtin-dashboard-pass.js";
import {
  buildBuiltinDashboard,
  loadBuiltinDashboard,
} from "./builtin-dashboards.js";
import { DATA_NOTES_MIGRATION_SQL } from "./data-notes-migration.js";

const TABLES = [
  `CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE TABLE organizations (id TEXT PRIMARY KEY, created_by TEXT NOT NULL)`,
  `CREATE TABLE dashboards (id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, config TEXT NOT NULL, certification TEXT, created_at TEXT NOT NULL, created_by TEXT, updated_at TEXT NOT NULL, archived_at TEXT, hidden_at TEXT, hidden_by TEXT, folder_id TEXT, updated_by TEXT, github_sync_state TEXT, owner_email TEXT NOT NULL, org_id TEXT, visibility TEXT NOT NULL)`,
  `CREATE TABLE dashboard_shares (id TEXT PRIMARY KEY, resource_id TEXT NOT NULL)`,
  `CREATE TABLE dashboard_views (id TEXT PRIMARY KEY, dashboard_id TEXT NOT NULL)`,
  `CREATE TABLE dashboard_report_subscriptions (id TEXT PRIMARY KEY, dashboard_id TEXT NOT NULL)`,
  `CREATE TABLE dashboard_revisions (id TEXT PRIMARY KEY, dashboard_id TEXT NOT NULL)`,
  ...DATA_NOTES_MIGRATION_SQL,
  ...BUILTIN_DASHBOARD_CHECKS_MIGRATION_SQL,
];

describe("legacy settings before the built-in dashboard deploy pass", () => {
  type Client = Awaited<ReturnType<typeof PGlite.create>>;
  let client: Client;
  beforeEach(async () => {
    client = await PGlite.create("memory://");
    mocks.getDb.mockReturnValue(drizzle(client, { schema: dbModule.schema }));
    for (const statement of TABLES) await client.exec(statement);
  });
  afterEach(async () => {
    await client.close();
  });
  async function setting(key: string, value: unknown) {
    await client.query(`INSERT INTO settings (key, value) VALUES ($1, $2)`, [
      key,
      JSON.stringify(value),
    ]);
  }
  it("preserves edited seed settings as ordinary saved dashboards", async () => {
    const config = {
      ...buildBuiltinDashboard("google-analytics")!.config,
      name: "Custom Google Analytics",
    };
    await setting(
      "u:alice@example.test:sql-dashboard-google-analytics",
      config,
    );
    const result = await runBuiltinDashboardPass();
    const { rows } = await client.query(
      `SELECT id, config, hidden_by, owner_email FROM dashboards`,
    );
    expect(result).toMatchObject({ checked: 1, kept: 1, hidden: 0 });
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0].config as string)).toEqual(config);
    expect(rows[0]).toMatchObject({
      hidden_by: null,
      owner_email: "alice@example.test",
    });
    expect(builtinDashboardIdForLegacyId(rows[0].id as string)).toBe(
      "google-analytics",
    );
  });
  it("classifies pristine seed settings as hidden built-in forwards", async () => {
    const scope = { email: "alice@example.test", orgId: null };
    const builtinBefore = await loadBuiltinDashboard("google-analytics", scope);
    await setting(
      "u:alice@example.test:sql-dashboard-google-analytics",
      buildBuiltinDashboard("google-analytics")!.config,
    );
    expect(await runBuiltinDashboardPass()).toMatchObject({
      checked: 1,
      hidden: 1,
      kept: 0,
    });
    expect(
      (await client.query(`SELECT hidden_by FROM dashboards`)).rows,
    ).toEqual([{ hidden_by: BUILTIN_DASHBOARD_HIDDEN_BY }]);
    expect(await loadBuiltinDashboard("google-analytics", scope)).toEqual(
      builtinBefore,
    );
    expect(
      (
        await client.query(
          `SELECT id FROM dashboards WHERE id = 'google-analytics'`,
        )
      ).rows,
    ).toEqual([]);
  });
  it("preserves different settings scopes at the same seed id without overwriting either", async () => {
    const config = buildBuiltinDashboard("google-analytics")!.config;
    await client.query(
      `INSERT INTO organizations (id, created_by) VALUES ('org-1', 'owner@example.test')`,
    );
    await setting("u:alice@example.test:sql-dashboard-google-analytics", {
      ...config,
      name: "Personal edits",
    });
    await setting("o:org-1:sql-dashboard-google-analytics", {
      ...config,
      name: "Organization edits",
    });
    expect(await runBuiltinDashboardPass()).toMatchObject({
      checked: 2,
      kept: 2,
    });
    expect(
      (
        await client.query(
          `SELECT title, owner_email, org_id, visibility FROM dashboards ORDER BY title`,
        )
      ).rows,
    ).toEqual([
      {
        title: "Organization edits",
        owner_email: "owner@example.test",
        org_id: "org-1",
        visibility: "org",
      },
      {
        title: "Personal edits",
        owner_email: "alice@example.test",
        org_id: null,
        visibility: "private",
      },
    ]);
    expect(await runBuiltinDashboardPass()).toMatchObject({
      alreadyChecked: 2,
      checked: 0,
    });
    expect((await client.query(`SELECT id FROM dashboards`)).rows).toHaveLength(
      2,
    );
  });
  it("rejects malformed settings instead of declaring migration complete", async () => {
    await client.query(
      `INSERT INTO settings (key, value) VALUES ('u:alice@example.test:sql-dashboard-google-analytics', 'broken json')`,
    );
    await expect(runBuiltinDashboardPass()).rejects.toThrow();
    expect((await client.query(`SELECT id FROM dashboards`)).rows).toEqual([]);
  });
  it("reports settings on a dry run without materializing or hiding rows", async () => {
    await setting(
      "u:alice@example.test:sql-dashboard-google-analytics",
      buildBuiltinDashboard("google-analytics")!.config,
    );
    expect(await runBuiltinDashboardPass({ dryRun: true })).toMatchObject({
      dryRun: true,
      checked: 0,
      hidden: 0,
      legacySettings: { scanned: 1, materialized: 0 },
    });
    expect((await client.query(`SELECT id FROM dashboards`)).rows).toEqual([]);
    expect(
      (
        await client.query(
          `SELECT dashboard_id FROM analytics_builtin_dashboard_checks`,
        )
      ).rows,
    ).toEqual([]);
  });
  it("does not resurrect a deleted migrated copy from its retained settings", async () => {
    await setting("u:alice@example.test:sql-dashboard-google-analytics", {
      ...buildBuiltinDashboard("google-analytics")!.config,
      name: "Edited legacy copy",
    });
    await runBuiltinDashboardPass();
    await client.query(`DELETE FROM dashboards`);

    expect(await runBuiltinDashboardPass()).toMatchObject({
      checked: 0,
      hidden: 0,
      legacySettings: { scanned: 1, materialized: 0 },
    });
    expect((await client.query(`SELECT id FROM dashboards`)).rows).toEqual([]);
    expect((await client.query(`SELECT key FROM settings`)).rows).toHaveLength(
      1,
    );
    expect(
      (
        await client.query(
          `SELECT dashboard_id FROM analytics_builtin_dashboard_checks`,
        )
      ).rows,
    ).toHaveLength(1);
  });
  it("retains the legacy title fallback when materializing settings", async () => {
    await setting("u:alice@example.test:sql-dashboard-google-analytics", {
      title: "Saved title",
      panels: [],
    });
    await runBuiltinDashboardPass();
    expect((await client.query(`SELECT title FROM dashboards`)).rows).toEqual([
      { title: "Saved title" },
    ]);
  });
  it("rejects an unknown organization instead of inventing its owner", async () => {
    await setting(
      "o:missing:sql-dashboard-google-analytics",
      buildBuiltinDashboard("google-analytics")!.config,
    );
    await expect(runBuiltinDashboardPass()).rejects.toThrow(
      "missing organization",
    );
    expect((await client.query(`SELECT id FROM dashboards`)).rows).toEqual([]);
  });
  it("retains settings when another user's SQL row occupies the seed id", async () => {
    const original = buildBuiltinDashboard("google-analytics")!.config;
    await setting("u:alice@example.test:sql-dashboard-google-analytics", {
      ...original,
      name: "Alice edits",
    });
    await client.query(
      `INSERT INTO dashboards (id, kind, title, config, created_at, updated_at, owner_email, visibility) VALUES ('google-analytics', 'sql', 'Bob edits', $1, '2026-10-01', '2026-10-19', 'bob@example.test', 'private')`,
      [JSON.stringify({ ...original, name: "Bob edits" })],
    );
    expect(await runBuiltinDashboardPass()).toMatchObject({
      checked: 2,
      kept: 2,
      hidden: 0,
      legacySettings: { scanned: 1, materialized: 1 },
    });
    expect(
      (
        await client.query(
          `SELECT title, owner_email FROM dashboards ORDER BY title`,
        )
      ).rows,
    ).toEqual([
      { title: "Alice edits", owner_email: "alice@example.test" },
      { title: "Bob edits", owner_email: "bob@example.test" },
    ]);
  });
  it("does not republish org settings after the migrated seed becomes private", async () => {
    const original = buildBuiltinDashboard("google-analytics")!.config;
    await setting("o:org-1:sql-dashboard-google-analytics", {
      ...original,
      name: "Original org content",
    });
    await client.query(
      `INSERT INTO organizations (id, created_by) VALUES ('org-1', 'owner@example.test')`,
    );
    await client.query(
      `INSERT INTO dashboards (id, kind, title, config, created_at, updated_at, owner_email, org_id, visibility) VALUES ('google-analytics', 'sql', 'Private edits', $1, '2026-10-01', '2026-10-19', 'owner@example.test', 'org-1', 'private')`,
      [JSON.stringify({ ...original, name: "Private edits" })],
    );
    expect(await runBuiltinDashboardPass()).toMatchObject({
      legacySettings: { scanned: 1, materialized: 0 },
    });
    expect(
      (await client.query(`SELECT id, visibility FROM dashboards`)).rows,
    ).toEqual([{ id: "google-analytics", visibility: "private" }]);
  });
  it.each(["org", "public"])(
    "retains the personal SQL seed after its visibility becomes %s",
    async (visibility) => {
      const original = buildBuiltinDashboard("google-analytics")!.config;
      await setting(
        "u:alice@example.test:sql-dashboard-google-analytics",
        original,
      );
      await client.query(
        `INSERT INTO dashboards (id, kind, title, config, created_at, updated_at, owner_email, org_id, visibility) VALUES ('google-analytics', 'sql', 'Shared edits', $1, '2026-10-01', '2026-10-19', 'alice@example.test', 'org-1', $2)`,
        [JSON.stringify({ ...original, name: "Shared edits" }), visibility],
      );
      expect(await runBuiltinDashboardPass()).toMatchObject({
        legacySettings: { scanned: 1, materialized: 0 },
      });
      expect(
        (await client.query(`SELECT id, visibility FROM dashboards`)).rows,
      ).toEqual([{ id: "google-analytics", visibility }]);
    },
  );
  it("does not resurrect stale settings when the same scope already migrated its seed", async () => {
    const original = buildBuiltinDashboard("google-analytics")!.config;
    await setting(
      "u:alice@example.test:sql-dashboard-google-analytics",
      original,
    );
    const newer = { ...original, name: "Newer saved edits" };
    await client.query(
      `INSERT INTO dashboards (id, kind, title, config, created_at, updated_at, owner_email, visibility) VALUES ('google-analytics', 'sql', 'Newer saved edits', $1, '2026-10-01', '2026-10-19', 'alice@example.test', 'private')`,
      [JSON.stringify(newer)],
    );
    expect(await runBuiltinDashboardPass()).toMatchObject({
      checked: 1,
      kept: 1,
      hidden: 0,
      legacySettings: { scanned: 1, materialized: 0 },
    });
    expect(
      (await client.query(`SELECT id, config FROM dashboards`)).rows,
    ).toEqual([{ id: "google-analytics", config: JSON.stringify(newer) }]);
  });
});
