import { describe, it, expect, vi, afterEach } from "vitest";

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

  it("resolves getDbExec().execute() run inside a Drizzle transaction instead of hanging", async () => {
    vi.stubEnv("DATABASE_URL", "pglite:memory");

    const { getDbExec } = await import("./client.js");
    const { createGetDb } = await import("./create-get-db.js");
    const getDb = createGetDb({});

    const raced = await Promise.race([
      getDb().transaction(async () => {
        await getDbExec().execute("SELECT 1");
        return "resolved";
      }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("deadlocked: exec never returned")),
          5000,
        ),
      ),
    ]);

    expect(raced).toBe("resolved");
  }, 6000);

  it("runs getDbExec() writes on the same transaction, rolling back on throw", async () => {
    vi.stubEnv("DATABASE_URL", "pglite:memory");

    const { getDbExec } = await import("./client.js");
    const { createGetDb } = await import("./create-get-db.js");
    const getDb = createGetDb({});
    // Resolve the concrete Drizzle instance once up front: `expect().rejects`
    // probes `typeof x.then === "function"` before awaiting, and getDb()'s own
    // lazy chain-recording proxy re-runs its whole recorded chain — including
    // the side-effecting transaction() call — on every `.then` property read,
    // so calling `.transaction()` straight off the still-lazy `getDb()` here
    // would open two transactions instead of one.
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
});
