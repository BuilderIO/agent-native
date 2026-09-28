import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { closeDbExec, getDbExec } from "./client.js";
import { withMigrationRuntime } from "./migration-runtime.js";
import {
  SchemaNotMigratedError,
  STORE_MIGRATIONS_TABLE,
  __resetStoreLedgerSnapshotForTests,
  defineStore,
} from "./store-registry.js";

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

beforeEach(() => {
  vi.unstubAllEnvs();
  __resetStoreLedgerSnapshotForTests();
});

let seq = 0;
function widgetStore(extra: Array<{ name: string; sql: string }> = []) {
  const table = `widgets_${++seq}`;
  const store = defineStore({
    id: table,
    migrations: [
      {
        name: "baseline",
        sql: `CREATE TABLE IF NOT EXISTS ${table} (id TEXT PRIMARY KEY)`,
      },
      ...extra,
    ],
  });
  return { table, store };
}

async function tableExists(table: string): Promise<boolean> {
  const { rows } = await getDbExec().execute({
    sql: `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ?`,
    args: [table],
  });
  return rows.length > 0;
}

function simulateHostedFunction(): void {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("NETLIFY", "true");
}

describe("defineStore", () => {
  it("rejects duplicate and empty migrations", () => {
    expect(() =>
      defineStore({
        id: "dupes",
        migrations: [
          { name: "a", sql: "SELECT 1" },
          { name: "a", sql: "SELECT 1" },
        ],
      }),
    ).toThrow(/duplicate migration "a"/);
    expect(() =>
      defineStore({ id: "empty", migrations: [{ name: "a" }] }),
    ).toThrow(/no sql or run/);
  });
});

describe("apply (release runtime)", () => {
  it("runs each migration once per database and records it", async () => {
    const backfill = vi.fn(async () => {});
    const table = `apply_${++seq}`;
    const define = () =>
      defineStore({
        id: table,
        migrations: [
          {
            name: "baseline",
            sql: `CREATE TABLE IF NOT EXISTS ${table} (id TEXT)`,
          },
          { name: "backfill", run: backfill },
        ],
      });

    await withMigrationRuntime(() => define().ready());
    // A fresh process: new store object, same database.
    await withMigrationRuntime(() => define().ready());

    expect(await tableExists(table)).toBe(true);
    expect(backfill).toHaveBeenCalledTimes(1);
    const { rows } = await getDbExec().execute({
      sql: `SELECT name FROM ${STORE_MIGRATIONS_TABLE} WHERE store_id = ? ORDER BY name`,
      args: [table],
    });
    expect(rows.map((row) => row.name)).toEqual(["backfill", "baseline"]);
  });

  it("does not record a migration that failed", async () => {
    const { store } = widgetStore([
      { name: "broken", sql: "ALTER TABLE does_not_exist ADD COLUMN x TEXT" },
    ]);

    await expect(withMigrationRuntime(() => store.ready())).rejects.toThrow(
      /migration "broken" failed/,
    );
    const { rows } = await getDbExec().execute({
      sql: `SELECT name FROM ${STORE_MIGRATIONS_TABLE} WHERE store_id = ?`,
      args: [store.id],
    });
    expect(rows.map((row) => row.name)).toEqual(["baseline"]);
  });
});

describe("verify (hosted request runtime)", () => {
  it("serves a migrated store without issuing DDL", async () => {
    const { table, store } = widgetStore();
    await withMigrationRuntime(() => store.ready());

    simulateHostedFunction();
    const fresh = defineStore({ id: table, migrations: store.migrations });
    await expect(fresh.ready()).resolves.toBeUndefined();
  });

  it("reads the ledger once per process for every store", async () => {
    const a = widgetStore();
    const b = widgetStore();
    await withMigrationRuntime(async () => {
      await a.store.ready();
      await b.store.ready();
    });

    simulateHostedFunction();
    const execute = vi.fn(getDbExec().execute);
    const exec = { execute };
    const { withDbExec } = await import("./client.js");
    await withDbExec(exec, async () => {
      await defineStore({
        id: a.table,
        migrations: a.store.migrations,
      }).ready();
      await defineStore({
        id: b.table,
        migrations: b.store.migrations,
      }).ready();
    });

    expect(execute).toHaveBeenCalledTimes(1);
    expect(String(execute.mock.calls[0][0])).toMatch(
      new RegExp(`FROM ${STORE_MIGRATIONS_TABLE}`),
    );
  });

  it("fails loudly and names the missing migrations", async () => {
    const { table, store } = widgetStore();
    await withMigrationRuntime(() => store.ready());

    simulateHostedFunction();
    const ahead = defineStore({
      id: table,
      migrations: [...store.migrations, { name: "next", sql: "SELECT 1" }],
    });

    const error = await ahead.ready().catch((err) => err);
    expect(error).toBeInstanceOf(SchemaNotMigratedError);
    expect(error.missing).toEqual(["next"]);
    expect(await tableExists(table)).toBe(true);
  });

  it("rejects DDL even after the client is initialized", async () => {
    await getDbExec().execute("SELECT 1");
    simulateHostedFunction();

    await expect(
      getDbExec().execute("CREATE TABLE IF NOT EXISTS sneaky (id TEXT)"),
    ).rejects.toThrow(/Schema mutation attempted/);
  });
});

describe("replay (local and self-provisioning runtimes)", () => {
  it("creates tables on first use without a release step", async () => {
    const { table, store } = widgetStore();

    await store.ready();

    expect(await tableExists(table)).toBe(true);
  });
});
