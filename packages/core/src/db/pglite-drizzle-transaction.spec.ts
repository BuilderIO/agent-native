import { describe, it, expect, vi, afterEach } from "vitest";

import { sql } from "./sql.js";

// Drizzle's PGlite session opens a transaction by calling `client.transaction`
// on the raw PGlite engine directly — it never goes through this module's own
// `createDbExecInternal` transaction() path. Without `pgliteDrizzleClient`
// wiring that call into the shared AsyncLocalStorage registry, any
// `getDbExec().execute()` inside a `getDb().transaction(...)` callback falls
// through to the main PGlite client and queues behind the open transaction on
// PGlite's single connection — a permanent deadlock.

describe("Drizzle-opened PGlite transactions register with the shared exec", () => {
  afterEach(async () => {
    const { closeDbExec } = await import("./client.js");
    await closeDbExec();
    Reflect.deleteProperty(globalThis as object, "__agentNativePgliteClients");
    Reflect.deleteProperty(
      globalThis as object,
      "__agentNativePgliteProcessLocks",
    );
    Reflect.deleteProperty(
      globalThis as object,
      "__agentNativePgliteProcessExitCleanupRegistered",
    );
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("runs getDbExec().execute() inside a Drizzle transaction on that transaction, never queued behind it", async () => {
    vi.stubEnv("DATABASE_URL", "pglite:memory");

    const { getDbExec, getPgliteClient, getRuntimeDatabaseUrl } =
      await import("./client.js");
    const { createGetDb } = await import("./create-get-db.js");
    const { sql: drizzleSql } = await import("drizzle-orm");
    const getDb = createGetDb({});
    const engine = await getPgliteClient(
      getRuntimeDatabaseUrl("pglite:./data/pglite"),
    );

    const seenByExec = await getDb().transaction(async (tx) => {
      // A statement that reaches the engine now waits for this transaction to
      // end, so fail it instead of passing it through: a regression then
      // reports the route it took rather than hanging until the test times out.
      const engineQuery = vi
        .spyOn(engine, "query")
        .mockRejectedValue(
          new Error(
            "getDbExec() queued on the PGlite engine behind the open Drizzle transaction",
          ),
        );
      try {
        await tx.execute(
          drizzleSql`SELECT set_config('agent_native.tx_probe', 'drizzle-tx', true)`,
        );
        const { rows } = await getDbExec().execute(
          "SELECT current_setting('agent_native.tx_probe', true) AS probe",
        );
        expect(engineQuery).not.toHaveBeenCalled();
        return rows[0]?.probe;
      } finally {
        engineQuery.mockRestore();
      }
    });

    expect(seenByExec).toBe("drizzle-tx");
  });

  it("runs getDbExec() writes on the same transaction, rolling back on throw", async () => {
    vi.stubEnv("DATABASE_URL", "pglite:memory");

    const { getDbExec } = await import("./client.js");
    const { createGetDb } = await import("./create-get-db.js");
    const getDb = createGetDb({});
    const db = await getDb();

    await getDbExec().execute(
      "CREATE TABLE pglite_drizzle_tx_probe (id TEXT PRIMARY KEY)",
    );

    await expect(
      db.transaction(async () => {
        await getDbExec().execute(
          "INSERT INTO pglite_drizzle_tx_probe (id) VALUES ('row')",
        );
        throw new Error("roll back probe");
      }),
    ).rejects.toThrow("roll back probe");

    const { rows } = await getDbExec().execute(
      "SELECT count(*)::int AS count FROM pglite_drizzle_tx_probe",
    );
    expect(rows[0]?.count).toBe(0);
  });

  it("executes a typed SQL fragment with bound values", async () => {
    vi.stubEnv("DATABASE_URL", "pglite:memory");

    const { getDbExec } = await import("./client.js");
    const { rows } = await getDbExec().execute(
      sql`SELECT ${sql.value("fragment-value")}::text AS value`,
    );

    expect(rows[0]?.value).toBe("fragment-value");
  });
});
