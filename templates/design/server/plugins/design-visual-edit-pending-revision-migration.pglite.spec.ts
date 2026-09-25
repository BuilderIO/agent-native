import {
  closeDbExec,
  getDbExec,
  getRuntimeDatabaseUrl,
  runMigrations,
  withMigrationRuntime,
} from "@agent-native/core/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { designVisualEditPendingBigintRevisionMigration } from "./db.js";

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "pglite:memory://");
  vi.stubEnv("DATABASE_URL_UNPOOLED", "pglite:memory://");
  vi.stubEnv("DESIGN_DATABASE_URL", "pglite:memory://");
  vi.stubEnv("DESIGN_DATABASE_URL_UNPOOLED", "pglite:memory://");

  expect(getRuntimeDatabaseUrl()).toBe("pglite:memory://");

  const exec = getDbExec();
  await exec.execute(
    "CREATE TABLE visual_edit_revision_migrations (version BIGINT PRIMARY KEY)",
  );
  await exec.execute(
    "INSERT INTO visual_edit_revision_migrations (version) VALUES (31)",
  );
  await exec.execute(`CREATE TABLE design_visual_edit_pending (
      design_id TEXT PRIMARY KEY,
      revision INTEGER NOT NULL DEFAULT 0
    )`);
  await exec.execute(
    `INSERT INTO design_visual_edit_pending (design_id, revision)
      VALUES ('design_v31_existing', 2147483000)`,
  );

  const migrate = runMigrations(
    [designVisualEditPendingBigintRevisionMigration],
    { table: "visual_edit_revision_migrations" },
  );
  await withMigrationRuntime(async () => {
    await migrate({});
  });
});

afterAll(async () => {
  await closeDbExec();
  vi.unstubAllEnvs();
});

describe("visual-edit pending revision forward migration", () => {
  it("adds a BIGINT revision column and backfills data from shipped v31 INTEGER", async () => {
    const { rows: migrations } = await getDbExec().execute({
      sql: "SELECT MAX(version) AS version FROM visual_edit_revision_migrations",
    });
    expect(migrations[0]?.version).toBe(32);

    const { rows: columns } = await getDbExec().execute({
      sql: `SELECT column_name, data_type
            FROM information_schema.columns
            WHERE table_name = 'design_visual_edit_pending'`,
    });
    expect(
      Object.fromEntries(
        columns.map(({ column_name, data_type }) => [column_name, data_type]),
      ),
    ).toMatchObject({ revision: "integer", revision_bigint: "bigint" });

    const { rows } = await getDbExec().execute({
      sql: `SELECT revision, revision_bigint
            FROM design_visual_edit_pending
            WHERE design_id = 'design_v31_existing'`,
    });
    expect(rows[0]).toMatchObject({
      revision: 2147483000,
      revision_bigint: 2147483000,
    });
  });
});
