import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// buildResilientNeonPool — unit tests
//
// Tests the three retry-safety scenarios mandated by the task:
//   1. read (SELECT) retried on connection-class errors
//   2. write NOT retried on post-send errors
//   3. write retried once on acquire-timeout (pre-send CONNECT_TIMEOUT)
//
// Pool and client are plain mocks — no real DB required.
// ---------------------------------------------------------------------------

// Use a tight per-test timeout so hung-pool scenarios resolve quickly.
const TIMEOUT_MS = 20;

/** Build a minimal mock pool that records calls and can be configured to fail. */
function makeMockPool(
  opts: {
    connectBehavior?: "ok" | "fail" | "timeout";
    queryBehavior?: "ok" | "fail-connection" | "fail-app";
    rows?: unknown[];
  } = {},
) {
  const {
    connectBehavior = "ok",
    queryBehavior = "ok",
    rows = [{ id: 1 }],
  } = opts;

  let connectCalls = 0;
  let queryCalls = 0;

  // Track released clients
  const releaseCalls: Array<{ err: any }> = [];

  function makeClient() {
    const client = {
      query: vi.fn(async (_sql: string, _args?: any[]) => {
        queryCalls++;
        if (queryBehavior === "fail-connection") {
          const err: any = new Error("ECONNRESET during query");
          err.code = "ECONNRESET";
          throw err;
        }
        if (queryBehavior === "fail-app") {
          const err: any = new Error("duplicate key value");
          err.code = "23505";
          throw err;
        }
        return { rows, rowCount: rows.length };
      }),
      release: vi.fn((err?: any) => {
        releaseCalls.push({ err });
      }),
    };
    return client;
  }

  const pool = {
    connectCalls: () => connectCalls,
    queryCalls: () => queryCalls,
    releaseCalls: () => releaseCalls,

    connect: vi.fn(async () => {
      connectCalls++;
      if (connectBehavior === "fail") {
        const err: any = new Error("ECONNRESET on connect");
        err.code = "ECONNRESET";
        throw err;
      }
      if (connectBehavior === "timeout") {
        // Never resolves — simulates a frozen WebSocket.
        return new Promise<never>(() => {});
      }
      return makeClient();
    }),

    query: vi.fn(async (sql: string, args?: any[]) => {
      // Pool-level query (used by drizzle for simple queries outside transactions)
      const client = await pool.connect();
      try {
        const result = await client.query(sql, args);
        client.release();
        return result;
      } catch (err) {
        client.release(err as any);
        throw err;
      }
    }),

    end: vi.fn(async () => {}),
    on: vi.fn(),
  };

  return pool;
}

describe("buildResilientNeonPool", () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  // Override DB_OP_TIMEOUT_MS so tests run fast without relying on the
  // serverless/non-serverless default (8 s or 30 s).
  beforeEach(() => {
    vi.stubEnv("DB_OP_TIMEOUT_MS", String(TIMEOUT_MS));
  });

  it("read (SELECT) is retried on a connection error", async () => {
    const { buildResilientNeonPool } = await import("./create-get-db.js");

    let callCount = 0;
    const pool = {
      connect: vi.fn(async () => {
        callCount++;
        if (callCount === 1) {
          // First acquire succeeds, but query fails with ECONNRESET.
          return {
            query: vi.fn(async () => {
              const err: any = new Error("ECONNRESET");
              err.code = "ECONNRESET";
              throw err;
            }),
            release: vi.fn(),
          };
        }
        // Second attempt succeeds.
        return {
          query: vi.fn(async () => ({ rows: [{ id: 42 }], rowCount: 1 })),
          release: vi.fn(),
        };
      }),
      query: vi.fn(),
      end: vi.fn(),
      on: vi.fn(),
    };

    const resilient = buildResilientNeonPool(pool as any);
    const result = await resilient.query("SELECT id FROM users");

    // Should have retried: connect called twice.
    expect(pool.connect).toHaveBeenCalledTimes(2);
    expect(result.rows).toEqual([{ id: 42 }]);
  });

  it("write (INSERT) is NOT retried on a post-send connection error", async () => {
    const { buildResilientNeonPool } = await import("./create-get-db.js");

    let connectCount = 0;
    const pool = {
      connect: vi.fn(async () => {
        connectCount++;
        return {
          query: vi.fn(async () => {
            // Error surfaces after the statement was sent — post-send failure.
            const err: any = new Error("ECONNRESET after write");
            err.code = "ECONNRESET";
            throw err;
          }),
          release: vi.fn(),
        };
      }),
      query: vi.fn(),
      end: vi.fn(),
      on: vi.fn(),
    };

    const resilient = buildResilientNeonPool(pool as any);

    await expect(
      resilient.query("INSERT INTO users (name) VALUES ($1)", ["alice"]),
    ).rejects.toMatchObject({ code: "ECONNRESET" });

    // Connect must have been called only once — no retry on post-send write errors.
    expect(connectCount).toBe(1);
  });

  it("write (INSERT) IS retried when acquire times out (pre-send CONNECT_TIMEOUT)", async () => {
    const { buildResilientNeonPool } = await import("./create-get-db.js");

    let connectCount = 0;
    const pool = {
      connect: vi.fn(async () => {
        connectCount++;
        if (connectCount === 1) {
          // First acquire: never resolves → withDbTimeout fires CONNECT_TIMEOUT.
          return new Promise<never>(() => {});
        }
        // Second acquire: succeeds.
        return {
          query: vi.fn(async () => ({ rows: [], rowCount: 1 })),
          release: vi.fn(),
        };
      }),
      query: vi.fn(),
      end: vi.fn(),
      on: vi.fn(),
    };

    const resilient = buildResilientNeonPool(pool as any);

    const result = await resilient.query(
      "INSERT INTO users (name) VALUES ($1)",
      ["bob"],
    );

    // Should have retried after the acquire timeout.
    expect(connectCount).toBe(2);
    expect(result.rowCount).toBe(1);
  });

  it("forwards non-query pool members unchanged (end, on, etc.)", async () => {
    const { buildResilientNeonPool } = await import("./create-get-db.js");

    const pool = makeMockPool();
    const resilient = buildResilientNeonPool(pool as any);

    // end() and on() are forwarded
    await resilient.end();
    expect(pool.end).toHaveBeenCalledTimes(1);

    resilient.on("error", () => {});
    expect(pool.on).toHaveBeenCalledWith("error", expect.any(Function));
  });

  it("releases the client on success", async () => {
    const { buildResilientNeonPool } = await import("./create-get-db.js");

    const releasesMock = vi.fn();
    const pool = {
      connect: vi.fn(async () => ({
        query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
        release: releasesMock,
      })),
      query: vi.fn(),
      end: vi.fn(),
      on: vi.fn(),
    };

    const resilient = buildResilientNeonPool(pool as any);
    await resilient.query("SELECT 1");

    expect(releasesMock).toHaveBeenCalledTimes(1);
    // Called with no error argument on clean release (undefined = return slot to pool)
    expect(releasesMock).toHaveBeenCalledWith(undefined);
  });
});

describe("isSqlRead", () => {
  it("recognises SELECT statements as reads", async () => {
    const { isSqlRead } = await import("./create-get-db.js");
    expect(isSqlRead("SELECT id FROM users")).toBe(true);
    expect(isSqlRead("  select * from t")).toBe(true);
    expect(isSqlRead("WITH cte AS (SELECT 1) SELECT * FROM cte")).toBe(true);
  });

  it("treats INSERT/UPDATE/DELETE as writes", async () => {
    const { isSqlRead } = await import("./create-get-db.js");
    expect(isSqlRead("INSERT INTO users (name) VALUES ($1)")).toBe(false);
    expect(isSqlRead("UPDATE users SET name=$1 WHERE id=$2")).toBe(false);
    expect(isSqlRead("DELETE FROM sessions WHERE id=$1")).toBe(false);
  });
});
