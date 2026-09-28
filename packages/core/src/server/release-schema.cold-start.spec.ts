import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  closeDbExec,
  getDbExec,
  withDbExec,
  type DbExec,
} from "../db/client.js";
import { withMigrationRuntime } from "../db/migration-runtime.js";
import { FRAMEWORK_STORES } from "../db/store-registry.generated.js";
import { __resetStoreLedgerSnapshotForTests } from "../db/store-registry.js";
import { runFrameworkSchemaEnsures } from "./release-schema.js";

let previousDatabaseUrl: string | undefined;

beforeAll(async () => {
  previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "pglite:memory";
  await closeDbExec();
  await withMigrationRuntime(() => runFrameworkSchemaEnsures());
}, 120_000);

afterAll(async () => {
  vi.unstubAllEnvs();
  await closeDbExec();
  if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabaseUrl;
});

describe("hosted cold start against a released database", () => {
  it("readies every framework store with one schema query and no DDL", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NETLIFY", "true");
    __resetStoreLedgerSnapshotForTests();
    const stores = await Promise.all(
      FRAMEWORK_STORES.map(([, load]) => load()),
    );
    for (const store of stores) store.reset();

    const real = getDbExec();
    const statements: string[] = [];
    const counting: DbExec = {
      execute: (statement) => {
        statements.push(
          typeof statement === "string" ? statement : statement.sql,
        );
        return real.execute(statement);
      },
    };
    await withDbExec(counting, () =>
      Promise.all(stores.map((store) => store.ready())),
    );

    expect(stores.length).toBeGreaterThan(50);
    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatch(/FROM _an_store_migrations/);
  });
});
