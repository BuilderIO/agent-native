import { resetAppConfigForTests } from "@agent-native/core/app-config";
import { closeDbExec, getDbExec } from "@agent-native/core/db";
import { sql } from "@agent-native/core/db/schema";
import { ensureTable as ensureResourcesTable } from "@agent-native/core/resources";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

import { sharedDbPool } from "../../../../packages/core/dist/db/client.js";
import {
  createSingleConnectionNeonPool,
  SINGLE_CONNECTION_NEON_URL,
} from "../../../../packages/core/src/db/test-single-connection-neon-pool.js";
import { getDb } from "../db/index.js";
import { analyticsMigrations } from "../db/migrations.js";
import {
  purgeDeletedProjectFiles,
  withProjectFileGuard,
} from "./project-file-cleanup.js";

const scope = {
  ownerEmail: "hosted-cleanup@example.test",
  orgId: "hosted-cleanup-workspace",
};
let fixture: Awaited<ReturnType<typeof createSingleConnectionNeonPool>>;
let outsidePoolConnect: ReturnType<typeof vi.spyOn>;

beforeAll(async () => {
  await closeDbExec();
  vi.stubEnv("DATABASE_URL", SINGLE_CONNECTION_NEON_URL);
  vi.stubEnv("DATABASE_URL_UNPOOLED", "");
  vi.stubEnv("NETLIFY_DATABASE_URL_UNPOOLED", "");
  vi.stubEnv("AWS_LAMBDA_FUNCTION_NAME", "hosted-project-cleanup-fixture");
  vi.stubEnv("DB_OP_TIMEOUT_MS", "5000");
  resetAppConfigForTests();
  fixture = await createSingleConnectionNeonPool();
  const poolPrototype = Object.getPrototypeOf(
    Object.getPrototypeOf(fixture.pool),
  ) as {
    connect: () => Promise<unknown>;
  };
  outsidePoolConnect = vi
    .spyOn(poolPrototype, "connect")
    .mockRejectedValue(
      new Error("A test attempted a connection outside its owned pool"),
    );
  for (const migration of analyticsMigrations) {
    const statement =
      typeof migration.sql === "string"
        ? migration.sql
        : migration.sql.postgres;
    if (!statement) throw new Error("Expected PostgreSQL migration SQL");
    await fixture.pglite.exec(statement);
  }
  sharedDbPool("neon", SINGLE_CONNECTION_NEON_URL, () => fixture.pool);
});

afterAll(async () => {
  await closeDbExec();
  expect(outsidePoolConnect).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  await fixture?.pglite.close();
  vi.unstubAllEnvs();
  resetAppConfigForTests();
});

it("resolves an absent owned-project repair without checking out a second pooled connection", async () => {
  await ensureResourcesTable();
  const checkouts = fixture.stats.checkouts;
  await expect(
    purgeDeletedProjectFiles(scope, "already-deleted-project"),
  ).resolves.toEqual({
    projectId: "already-deleted-project",
    status: "absent",
    removedFiles: 0,
    retainedSharedAttachments: 0,
  });
  expect(fixture.stats.checkouts - checkouts).toBe(1);
});

it("rolls back Drizzle and raw SQL writes together on the held hosted connection", async () => {
  await ensureResourcesTable();
  await fixture.pglite.exec(
    "CREATE TABLE cleanup_guard_probe (id integer PRIMARY KEY)",
  );
  const checkouts = fixture.stats.checkouts;
  await expect(
    withProjectFileGuard(scope, "rollback-project", async () => {
      await getDb().execute(
        sql`INSERT INTO cleanup_guard_probe (id) VALUES (${1})`,
      );
      await getDbExec().execute({
        sql: "INSERT INTO cleanup_guard_probe (id) VALUES (?)",
        args: [2],
      });
      throw new Error("Abort the cleanup transaction");
    }),
  ).rejects.toThrow("Abort the cleanup transaction");
  expect(
    (await fixture.pglite.query("SELECT id FROM cleanup_guard_probe")).rows,
  ).toEqual([]);
  expect(fixture.stats.checkouts - checkouts).toBe(1);
});
