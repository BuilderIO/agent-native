import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, afterEach, describe, expect, it } from "vitest";

import {
  closeDbExec,
  getDbExec,
  withDbExec,
  type DbExec,
} from "../db/client.js";
import { withMigrationRuntime } from "../db/migration-runtime.js";
import { schemaFingerprint } from "../db/schema-catalog.js";
import { SCHEMA_SNAPSHOT } from "../db/schema-snapshot.generated.js";
import { FRAMEWORK_STORES } from "../db/store-registry.generated.js";
import {
  __resetStoreLedgerSnapshotForTests,
  __setSchemaSnapshotForTests,
  migrationChecksum,
} from "../db/store-registry.js";
import { runFrameworkReleaseMigrations } from "./release-migrations.js";

const previousUrl = process.env.DATABASE_URL;
const dirs: string[] = [];

async function freshDatabase(): Promise<void> {
  await closeDbExec();
  __resetStoreLedgerSnapshotForTests();
  const stores = await Promise.all(FRAMEWORK_STORES.map(([, load]) => load()));
  for (const store of stores) store.reset();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "schema-snapshot-"));
  dirs.push(dir);
  process.env.DATABASE_URL = `pglite:${dir}`;
}

/** Runs a release on a fresh database, counting every statement it sends. */
async function release(useSnapshot: boolean) {
  await freshDatabase();
  __setSchemaSnapshotForTests(useSnapshot ? undefined : null);
  const real = getDbExec();
  let statements = 0;
  const counting: DbExec = {
    execute: (statement) => {
      statements++;
      return real.execute(statement);
    },
    transaction: real.transaction
      ? (fn) =>
          real.transaction!((tx) =>
            fn({
              ...tx,
              execute: (statement) => {
                statements++;
                return tx.execute(statement);
              },
            }),
          )
      : undefined,
  };
  await withDbExec(counting, () =>
    withMigrationRuntime(() => runFrameworkReleaseMigrations()),
  );
  const fingerprint = await schemaFingerprint(getDbExec());
  const { rows } = await getDbExec().execute(
    "SELECT store_id, name, source FROM _an_store_migrations ORDER BY store_id, name",
  );
  return {
    statements,
    fingerprint,
    ledger: rows,
    bootLists: await oldBookkeeping(),
  };
}

/** What hosted apps without release migrations replay boot lists against. */
async function oldBookkeeping(): Promise<Record<string, unknown>> {
  const { rows: tables } = await getDbExec().execute(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE '\\_%migrations' AND tablename NOT LIKE '\\_an\\_%' ORDER BY 1",
  );
  const lists: Record<string, unknown> = {};
  for (const { tablename } of tables) {
    const table = String(tablename);
    const max = await getDbExec().execute(
      `SELECT MAX(version)::int AS v FROM ${table}`,
    );
    const names = await getDbExec().execute(
      `SELECT name FROM ${table}_named ORDER BY name`,
    );
    lists[table] = {
      maxVersion: max.rows[0]?.v,
      names: names.rows.map((row) => row.name),
    };
  }
  return lists;
}

afterEach(() => __setSchemaSnapshotForTests(undefined));

afterAll(async () => {
  await closeDbExec();
  if (previousUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousUrl;
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

describe("schema snapshot", () => {
  it("installs the same schema and ledger as the step-by-step release, in far fewer statements", async () => {
    const stepByStep = await release(false);
    const snapshot = await release(true);

    expect(snapshot.fingerprint).toEqual(stepByStep.fingerprint);
    const names = (ledger: typeof snapshot.ledger) =>
      ledger.map((row) => `${row.store_id}/${row.name}`);
    expect(names(snapshot.ledger)).toEqual(names(stepByStep.ledger));
    expect(Object.keys(stepByStep.bootLists)).toEqual(
      expect.arrayContaining(["_better_auth_migrations", "_org_migrations"]),
    );
    expect(snapshot.bootLists).toEqual(stepByStep.bootLists);
    expect(
      snapshot.ledger.filter((row) => row.source === "snapshot").length,
    ).toBe(SCHEMA_SNAPSHOT.migrations.length);
    console.info(
      `[schema snapshot] fresh release: ${stepByStep.statements} statements step by step, ${snapshot.statements} with the snapshot`,
    );
    expect(snapshot.statements).toBeLessThan(stepByStep.statements / 2);
  }, 300_000);

  it("covers every schema migration the stores declare (run `pnpm gen:schema-snapshot`)", async () => {
    const stores = await Promise.all(
      FRAMEWORK_STORES.map(([, load]) => load()),
    );
    // The checksum catches an edited SQL migration; a `run` migration has none,
    // so the equivalence test above is what catches an edited one.
    const declared = stores
      .flatMap((store) =>
        store.migrations
          .filter((migration) => migration.kind !== "data")
          .map(
            (migration) =>
              `${store.id}/${migration.name}@${migrationChecksum(migration)}`,
          ),
      )
      .sort();
    const covered = SCHEMA_SNAPSHOT.migrations
      .map(([storeId, name, checksum]) => `${storeId}/${name}@${checksum}`)
      .sort();
    expect(covered).toEqual(declared);
  });

  it("names every data migration in a boot list, so the snapshot's MAX(version) cannot mark one applied", async () => {
    const stores = await Promise.all(
      FRAMEWORK_STORES.map(([, load]) => load()),
    );
    const unnamed = stores.flatMap((store) =>
      store.migrations
        .filter(
          (migration) =>
            migration.kind === "data" &&
            migration.legacy?.ranAtBoot &&
            !migration.legacy.name,
        )
        .map((migration) => `${store.id}/${migration.name}`),
    );
    expect(unnamed).toEqual([]);
  });

  it("installs on a first local boot", async () => {
    await freshDatabase();
    const { settingsStore } = await import("../settings/store.js");
    await settingsStore.ready();

    const { rows } = await getDbExec().execute(
      "SELECT count(*)::int AS n FROM _an_store_migrations WHERE source = 'snapshot'",
    );
    expect(rows[0]?.n).toBe(SCHEMA_SNAPSHOT.migrations.length);
  }, 120_000);

  it("never installs on a database an older core already touched", async () => {
    await freshDatabase();
    await getDbExec().execute(
      "CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at BIGINT NOT NULL)",
    );
    const { settingsStore } = await import("../settings/store.js");
    await settingsStore.ready();

    const { rows } = await getDbExec().execute(
      "SELECT count(*)::int AS n FROM _an_store_migrations WHERE source = 'snapshot'",
    );
    expect(rows[0]?.n).toBe(0);
  }, 120_000);
});
