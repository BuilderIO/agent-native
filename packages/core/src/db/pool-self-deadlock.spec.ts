import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SINGLE_CONNECTION_NEON_URL,
  createSingleConnectionNeonPool,
} from "./test-single-connection-neon-pool.js";

describe("assertPoolConnectionAvailable", () => {
  it("throws only inside a transaction that holds a pool with one connection", async () => {
    const { assertPoolConnectionAvailable, runHoldingPoolConnection } =
      await import("./pool-self-deadlock.js");
    const onePool = { options: { max: 1 } };
    const bigPool = { options: { max: 20 } };
    const unknownPool = {};

    expect(() => assertPoolConnectionAvailable(onePool, "x")).not.toThrow();
    await runHoldingPoolConnection(onePool, async () => {
      await Promise.resolve();
      expect(() => assertPoolConnectionAvailable(onePool, "x")).toThrow(
        /holds it/,
      );
      expect(() => assertPoolConnectionAvailable(bigPool, "x")).not.toThrow();
      expect(() =>
        assertPoolConnectionAvailable({ options: { max: 1 } }, "x"),
      ).not.toThrow();
    });
    await runHoldingPoolConnection(unknownPool, async () => {
      expect(() =>
        assertPoolConnectionAvailable(unknownPool, "x"),
      ).not.toThrow();
    });
    expect(() => assertPoolConnectionAvailable(onePool, "x")).not.toThrow();
  });

  it("is not a connection error, so no layer retries it", async () => {
    const { DbPoolSelfDeadlockError } = await import("./pool-self-deadlock.js");
    const { isConnectionError, isTransientDatabaseError } =
      await import("./client.js");
    const error = new DbPoolSelfDeadlockError("A database query");

    expect(error.code).toBe("DB_POOL_SELF_DEADLOCK");
    expect(isConnectionError(error)).toBe(false);
    expect(isTransientDatabaseError(error)).toBe(false);
  });
});

describe("transactions on a one-connection Neon pool", () => {
  afterEach(async () => {
    const { closeDbExec } = await import("./client.js");
    await closeDbExec();
    vi.unstubAllEnvs();
    Reflect.deleteProperty(globalThis as Record<string, unknown>, "__cf_env");
    vi.resetModules();
  });

  async function bootPool() {
    vi.stubEnv("DATABASE_URL", SINGLE_CONNECTION_NEON_URL);
    vi.stubEnv("AWS_LAMBDA_FUNCTION_NAME", "pool-self-deadlock-test");
    // Longer than the test's own deadline, so only the guard can finish first.
    vi.stubEnv("DB_OP_TIMEOUT_MS", "5000");
    const { pool, pglite, stats } = await createSingleConnectionNeonPool();
    const { getRuntimeDatabaseUrl, sharedDbPool } = await import("./client.js");
    sharedDbPool(
      "neon",
      getRuntimeDatabaseUrl("pglite:./data/pglite"),
      () => pool,
    );
    return { pglite, stats };
  }

  async function bootWorkerPool() {
    vi.stubEnv("DATABASE_URL", SINGLE_CONNECTION_NEON_URL);
    vi.stubEnv("DB_OP_TIMEOUT_MS", "250");
    vi.stubGlobal("__cf_env", {});
    const { pool, pglite, stats } = await createSingleConnectionNeonPool();
    const { getRuntimeDatabaseUrl, sharedDbPool } = await import("./client.js");
    sharedDbPool(
      "neon",
      getRuntimeDatabaseUrl("pglite:./data/pglite"),
      () => pool,
    );
    return { pglite, stats };
  }

  it("fails a getDbExec() call made inside getDbExec().transaction() immediately", async () => {
    const { stats } = await bootPool();
    const { getDbExec } = await import("./client.js");
    const { DbPoolSelfDeadlockError } = await import("./pool-self-deadlock.js");

    const startedAt = Date.now();
    await expect(
      getDbExec().transaction(async () => {
        await getDbExec().execute("SELECT 1 AS ok");
      }),
    ).rejects.toBeInstanceOf(DbPoolSelfDeadlockError);

    expect(Date.now() - startedAt).toBeLessThan(1_000);
    expect(stats.maxWaiting).toBe(0);
  });

  it("checks the active request pool identity inside a Worker transaction", async () => {
    const { stats } = await bootWorkerPool();
    const { getDbExec } = await import("./client.js");
    const { runWithRequestDbPoolScope } =
      await import("./request-pool-context.js");
    const { DbPoolSelfDeadlockError } = await import("./pool-self-deadlock.js");

    const startedAt = Date.now();
    await runWithRequestDbPoolScope(true, undefined, async () => {
      await expect(
        getDbExec().transaction(async () => {
          await getDbExec().execute("SELECT 1 AS ok");
        }),
      ).rejects.toBeInstanceOf(DbPoolSelfDeadlockError);
    });

    expect(Date.now() - startedAt).toBeLessThan(1_000);
    expect(stats.maxWaiting).toBe(0);
  });

  it("keeps getDbExec() inside a getDb() transaction on that transaction's connection", async () => {
    const { pglite, stats } = await bootPool();
    await pglite.exec(`CREATE TABLE audit_rows (id INT PRIMARY KEY)`);
    const { createGetDb } = await import("./create-get-db.js");
    const { getDbExec } = await import("./client.js");
    const getDb = createGetDb({});

    let thrown: unknown;
    try {
      await getDb().transaction(async () => {
        await getDbExec().execute("INSERT INTO audit_rows (id) VALUES (1)");
        throw new Error("roll back");
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({ message: "roll back" });
    expect((await pglite.query(`SELECT id FROM audit_rows`)).rows).toEqual([]);
    expect(stats.maxWaiting).toBe(0);
  });
});
