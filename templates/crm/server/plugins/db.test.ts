import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  migrations: [] as Array<{ version: number; name: string; sql: string }>,
  runner: vi.fn(),
}));

vi.mock(import("@agent-native/core/db"), async (importOriginal) => ({
  ...(await importOriginal()),
  ensureAdditiveColumns: vi.fn(async () => ({ errors: [] })),
  getDbExec: vi.fn(() => ({})),
  runMigrations: vi.fn(
    (migrations: Array<{ version: number; name: string; sql: string }>) => {
      mocks.migrations = migrations;
      return mocks.runner;
    },
  ),
}));

describe("CRM database migrations", () => {
  beforeEach(() => {
    mocks.runner.mockReset();
  });

  it("bootstraps the additive dashboard storage tables and indexes", async () => {
    const { default: plugin } = await import("./db.js");
    const migration = mocks.migrations.find(
      (candidate) => candidate.name === "crm-dashboard-storage-schema",
    );

    expect(migration).toMatchObject({ version: 3 });
    expect(migration?.sql).toContain(
      "CREATE TABLE IF NOT EXISTS crm_dashboards",
    );
    expect(migration?.sql).toContain(
      "CREATE TABLE IF NOT EXISTS crm_dashboard_revisions",
    );
    expect(migration?.sql).toContain(
      "CREATE TABLE IF NOT EXISTS crm_dashboard_shares",
    );
    expect(migration?.sql).toContain(
      "crm_dashboard_revisions_dashboard_created_idx",
    );

    await plugin({});
    expect(mocks.runner).toHaveBeenCalledOnce();
  });
});
