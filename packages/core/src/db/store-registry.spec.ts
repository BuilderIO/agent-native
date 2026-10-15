import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { resetAppConfigForTests } from "../app-config/index.js";
import { closeDbExec, getDbExec } from "./client.js";
import { withMigrationRuntime } from "./migration-runtime.js";
import {
  STORE_MIGRATIONS_TABLE,
  __resetStoreLedgerSnapshotForTests,
  defineStore,
  findUnappliedStoreMigrations,
  withStoreMigrationLock,
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
  resetAppConfigForTests();
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

function simulateHostedFunction(
  { releaseMigrations } = { releaseMigrations: true },
): void {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("NETLIFY", "true");
  if (releaseMigrations) vi.stubEnv("AGENT_NATIVE_RELEASE_MIGRATIONS", "1");
  resetAppConfigForTests();
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

describe("release-owned hosted runtime", () => {
  it("does no schema work on a cold start", async () => {
    const { table, store } = widgetStore();
    simulateHostedFunction();
    const execute = vi.fn(getDbExec().execute);
    const { withDbExec } = await import("./client.js");

    await withDbExec({ execute }, () => store.ready());

    expect(execute).not.toHaveBeenCalled();
    expect(await tableExists(table)).toBe(false);
  });

  it("rejects DDL even after the client is initialized", async () => {
    await getDbExec().execute("SELECT 1");
    simulateHostedFunction();

    await expect(
      getDbExec().execute("CREATE TABLE IF NOT EXISTS sneaky (id TEXT)"),
    ).rejects.toThrow(/Schema mutation attempted/);
  });
});

describe("release verification", () => {
  it("names migrations the ledger does not list", async () => {
    const { table, store } = widgetStore();
    await withMigrationRuntime(() => store.ready());
    const ahead = defineStore({
      id: table,
      migrations: [...store.migrations, { name: "next", sql: "SELECT 1" }],
    });

    await expect(findUnappliedStoreMigrations([ahead])).resolves.toEqual([
      { storeId: table, missing: ["next"] },
    ]);
  });
});

describe("release lock", () => {
  it("serializes release steps against one database", async () => {
    const order: string[] = [];
    const first = withStoreMigrationLock(async () => {
      order.push("first:start");
      await new Promise((resolve) => setTimeout(resolve, 50));
      order.push("first:end");
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const second = withStoreMigrationLock(
      async () => {
        order.push("second");
      },
      { pollMs: 10 },
    );

    await Promise.all([first, second]);

    expect(order).toEqual(["first:start", "first:end", "second"]);
  });

  it("is reentrant within one release", async () => {
    await expect(
      withStoreMigrationLock(() =>
        withStoreMigrationLock(async () => "nested", { timeoutMs: 100 }),
      ),
    ).resolves.toBe("nested");
  });

  it("renews the lease while the release runs", async () => {
    await withStoreMigrationLock(
      async () => {
        const before = await getDbExec().execute(
          "SELECT expires_at FROM _an_store_migration_lock WHERE id = 1",
        );
        await new Promise((resolve) => setTimeout(resolve, 250));
        const after = await getDbExec().execute(
          "SELECT expires_at FROM _an_store_migration_lock WHERE id = 1",
        );
        expect(Number(after.rows[0]?.expires_at)).toBeGreaterThan(
          Number(before.rows[0]?.expires_at),
        );
      },
      { leaseMs: 300 },
    );
  });

  it("reports the migration's error when releasing the lease also fails", async () => {
    await expect(
      withStoreMigrationLock(async () => {
        await getDbExec().execute("DROP TABLE _an_store_migration_lock");
        throw new Error("migration failed");
      }),
    ).rejects.toThrow("migration failed");
  });

  it("takes over a lease whose holder never released it", async () => {
    await getDbExec().execute(
      "CREATE TABLE IF NOT EXISTS _an_store_migration_lock (id INTEGER PRIMARY KEY, holder TEXT NOT NULL, expires_at BIGINT NOT NULL)",
    );
    await getDbExec().execute(
      "UPDATE _an_store_migration_lock SET holder = 'crashed', expires_at = 0",
    );
    await getDbExec().execute(
      "INSERT INTO _an_store_migration_lock (id, holder, expires_at) VALUES (1, 'crashed', 0) ON CONFLICT (id) DO NOTHING",
    );

    await expect(
      withStoreMigrationLock(async () => "ran", { pollMs: 10, timeoutMs: 500 }),
    ).resolves.toBe("ran");
  });
});

describe("hosted runtime without release migrations", () => {
  it("provisions from the request but never writes the ledger", async () => {
    const { table, store } = widgetStore();
    simulateHostedFunction({ releaseMigrations: false });

    await store.ready();

    expect(await tableExists(table)).toBe(true);
    const { rows } = await getDbExec().execute({
      sql: `SELECT to_regclass('${STORE_MIGRATIONS_TABLE}') IS NOT NULL AS present`,
    });
    if (rows[0]?.present) {
      const recorded = await getDbExec().execute({
        sql: `SELECT name FROM ${STORE_MIGRATIONS_TABLE} WHERE store_id = ?`,
        args: [table],
      });
      expect(recorded.rows).toEqual([]);
    }
  });

  it("never provisions a releaseOnly store from a request", async () => {
    const table = `widgets_${++seq}`;
    const store = defineStore({
      id: table,
      releaseOnly: true,
      migrations: [
        {
          name: "baseline",
          sql: `CREATE TABLE IF NOT EXISTS ${table} (id TEXT PRIMARY KEY)`,
        },
      ],
    });
    simulateHostedFunction({ releaseMigrations: false });

    await store.ready();

    expect(await tableExists(table)).toBe(false);
  });

  it("honors AGENT_NATIVE_SKIP_ENSURE_TABLES", async () => {
    const { table, store } = widgetStore();
    simulateHostedFunction({ releaseMigrations: false });
    vi.stubEnv("AGENT_NATIVE_SKIP_ENSURE_TABLES", "1");

    await store.ready();

    expect(await tableExists(table)).toBe(false);
  });
});

describe("ledger rows", () => {
  it("records checksum, kind and source for each applied migration", async () => {
    const table = `widgets_${++seq}`;
    const store = defineStore({
      id: table,
      migrations: [
        {
          name: "baseline",
          sql: `CREATE TABLE IF NOT EXISTS ${table} (id TEXT PRIMARY KEY)`,
        },
        { name: "seed", kind: "data", run: async () => {} },
      ],
    });

    await withMigrationRuntime(() => store.ready());

    const { rows } = await getDbExec().execute({
      sql: `SELECT name, checksum, kind, source FROM ${STORE_MIGRATIONS_TABLE} WHERE store_id = ? ORDER BY name`,
      args: [table],
    });
    expect(rows).toEqual([
      {
        name: "baseline",
        checksum: expect.stringMatching(/^[0-9a-f]{16}$/),
        kind: "schema",
        source: "step",
      },
      { name: "seed", checksum: null, kind: "data", source: "step" },
    ]);
  });
});

describe("database switch", () => {
  it("re-checks readiness after the database clients close", async () => {
    const { table, store } = widgetStore();
    await store.ready();
    await getDbExec().execute(`DROP TABLE ${table}`);

    await closeDbExec();
    await store.ready();

    expect(await tableExists(table)).toBe(true);
  });
});

describe("replay (local and self-provisioning runtimes)", () => {
  it("creates tables on first use without a release step", async () => {
    const { table, store } = widgetStore();

    await store.ready();

    expect(await tableExists(table)).toBe(true);
  });
});
