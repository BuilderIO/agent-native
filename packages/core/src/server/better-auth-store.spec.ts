import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDbExec, getDbExec } from "../db/client.js";
import { withMigrationRuntime } from "../db/migration-runtime.js";
import { __resetStoreLedgerSnapshotForTests } from "../db/store-registry.js";
import { betterAuthStore } from "./better-auth-migrations.js";

let previousDatabaseUrl: string | undefined;

beforeAll(async () => {
  previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "pglite:memory";
  await closeDbExec();
});

afterAll(async () => {
  await closeDbExec();
  if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabaseUrl;
});

describe("better_auth store", () => {
  it("expires signing keys at most once per database", async () => {
    await withMigrationRuntime(() => betterAuthStore.ready());
    await getDbExec().execute(
      `INSERT INTO "jwks" (id, public_key, private_key, created_at) VALUES ('key-after-release', 'pub', 'priv', now())`,
    );

    // Later releases and local boots, each in a fresh process.
    for (const run of [
      () => withMigrationRuntime(() => betterAuthStore.ready()),
      () => betterAuthStore.ready(),
    ]) {
      betterAuthStore.reset();
      __resetStoreLedgerSnapshotForTests();
      await run();
    }

    const { rows } = await getDbExec().execute(
      `SELECT expires_at FROM "jwks" WHERE id = 'key-after-release'`,
    );
    expect(rows[0]?.expires_at).toBeNull();
  });
});
