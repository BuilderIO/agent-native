import { describe, it, expect, vi, afterEach } from "vitest";


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
