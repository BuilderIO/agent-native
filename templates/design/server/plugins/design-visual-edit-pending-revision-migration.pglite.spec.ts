import {
  closeDbExec,
  getDbExec,
  getRuntimeDatabaseUrl,
  runMigrations,
  withMigrationRuntime,
} from "@agent-native/core/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  designLiveCollaborationOptInMigration,
  designVisualEditPendingBigintRevisionMigration,
} from "./db.js";

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
      revision INTEGER NOT NULL DEFAULT 0,
      client_revision INTEGER NOT NULL DEFAULT 0
    )`);
  await exec.execute(
    `INSERT INTO design_visual_edit_pending (design_id, revision, client_revision)
      VALUES ('design_v31_existing', 2147483000, 2147483000)`,
  );

  const migrate = runMigrations(
    [designVisualEditPendingBigintRevisionMigration],
    { table: "visual_edit_revision_migrations" },
  );
  await withMigrationRuntime(async () => {
    await migrate({});
  });

  await exec.execute("CREATE TABLE designs (id TEXT PRIMARY KEY)");
  await exec.execute("INSERT INTO designs (id) VALUES ('existing_design')");
  const collaborationMigrations = runMigrations(
    [designLiveCollaborationOptInMigration],
    { table: "design_collaboration_migrations" },
  );
  await withMigrationRuntime(async () => {
    await collaborationMigrations({});
  });
});

afterAll(async () => {
  await closeDbExec();
  vi.unstubAllEnvs();
});

describe("visual-edit pending revision forward migration", () => {
  it("widens the existing revision column so old and new workers share revisions", async () => {
    const { rows: migrations } = await getDbExec().execute({
      sql: "SELECT MAX(version) AS version FROM visual_edit_revision_migrations",
    });
    expect(migrations[0]?.version).toBe(36);

    const { rows: columns } = await getDbExec().execute({
      sql: `SELECT column_name, data_type
            FROM information_schema.columns
            WHERE table_name = 'design_visual_edit_pending'`,
    });
    expect(
      Object.fromEntries(
        columns.map(({ column_name, data_type }) => [column_name, data_type]),
      ),
    ).toMatchObject({ revision: "bigint", client_revision: "bigint" });

    const { rows } = await getDbExec().execute({
      sql: `SELECT revision
            FROM design_visual_edit_pending
            WHERE design_id = 'design_v31_existing'`,
    });
    expect(rows[0]).toMatchObject({
      revision: 2147483000,
    });

    // Old workers still write the legacy column name; new workers read that
    // same column through the widened schema.
    await getDbExec().execute({
      sql: `UPDATE design_visual_edit_pending
            SET revision = 1750000000000,
                client_revision = 1750000000001
            WHERE design_id = 'design_v31_existing'`,
    });
    const { rows: oldWorkerWrite } = await getDbExec().execute({
      sql: `SELECT revision, client_revision
            FROM design_visual_edit_pending
            WHERE design_id = 'design_v31_existing'`,
    });
    expect(oldWorkerWrite[0]).toMatchObject({
      revision: 1750000000000,
      client_revision: 1750000000001,
    });
  });

  it("defaults collaboration to off for existing and new designs", async () => {
    const { rows } = await getDbExec().execute({
      sql: `SELECT id, live_collaboration_enabled
            FROM designs
            ORDER BY id`,
    });
    expect(rows).toEqual([
      { id: "existing_design", live_collaboration_enabled: false },
    ]);

    await getDbExec().execute("INSERT INTO designs (id) VALUES ('new_design')");
    const { rows: newRows } = await getDbExec().execute({
      sql: `SELECT live_collaboration_enabled FROM designs WHERE id = 'new_design'`,
    });
    expect(newRows[0]?.live_collaboration_enabled).toBe(false);
  });
});
