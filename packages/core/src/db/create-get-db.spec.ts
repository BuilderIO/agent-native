import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("createGetDb pooled transaction scoping", () => {
  afterEach(async () => {
    const { closeDbExec } = await import("./client.js");
    await closeDbExec();
    vi.doUnmock("drizzle-orm/neon-serverless");
    vi.doUnmock("@neondatabase/serverless");
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("keeps raw queries, access checks, nested scopes, and timeouts in Neon transactions", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://db.neon.tech/agent-native");
    vi.stubEnv("DB_OP_TIMEOUT_MS", "100");
    let statementTimeout = "0";
    let rolledBackTransactions = 0;
    let releasedTransactions = 0;
    let delayCancellationResponse = false;
    const timeoutOperations: string[] = [];
    const execute = vi.fn(async (query: any) => {
      const compiled = query.toQuery();
      if (
        compiled.sql.startsWith("SELECT set_config('statement_timeout', CASE")
      ) {
        statementTimeout =
          compiled.sql.match(/THEN '(\d+ms)'/)?.[1] ?? statementTimeout;
        return { rows: [{ set_config: statementTimeout }], rowCount: 1 };
      }
      if (
        compiled.sql.startsWith("SELECT current_setting('statement_timeout')")
      ) {
        timeoutOperations.push(`read:${statementTimeout}`);
        return { rows: [{ statement_timeout: statementTimeout }], rowCount: 1 };
      }
      if (compiled.sql.startsWith("SET LOCAL statement_timeout = ")) {
        statementTimeout = `${compiled.sql.match(/= (\d+)/)?.[1]}ms`;
        timeoutOperations.push(`set:${statementTimeout}`);
        return { rows: [], rowCount: 0 };
      }
      if (
        compiled.sql.startsWith(
          "SELECT set_config('statement_timeout', $1, true)",
        )
      ) {
        statementTimeout = String(compiled.params[0]);
        timeoutOperations.push(`restore:${statementTimeout}`);
        return { rows: [], rowCount: 0 };
      }
      if (compiled.sql === "ROLLBACK") {
        rolledBackTransactions++;
        return { rows: [], rowCount: 0 };
      }
      if (
        compiled.sql === "SELECT 101" ||
        compiled.sql === "SELECT 102" ||
        compiled.sql === "SELECT 103" ||
        compiled.sql === "SELECT 104"
      ) {
        timeoutOperations.push(`query:${compiled.sql}@${statementTimeout}`);
      }
      if (compiled.sql.includes('"transaction_scope_access_docs"')) {
        return {
          rows: [
            ["doc-1", "Document", "owner@example.com", "org-1", "private"],
          ],
          rowCount: 1,
        };
      }
      if (compiled.sql.includes("pg_sleep")) {
        const match = statementTimeout.match(/^(\d+)(ms|s)$/);
        const delayMs = match
          ? Number(match[1]) * (match[2] === "s" ? 1_000 : 1)
          : 25;
        const responseDelayMs = delayCancellationResponse ? 75 : delayMs;
        return new Promise((_, reject) =>
          setTimeout(
            () =>
              reject(new Error("canceling statement due to statement timeout")),
            responseDelayMs,
          ),
        );
      }
      return { rows: [{ id: 42 }], rowCount: 1 };
    });
    const runTransaction = async (run: (transaction: any) => unknown) => {
      const previousTimeout = statementTimeout;
      try {
        return await run(makeTransaction());
      } catch (error) {
        await execute({ toQuery: () => ({ sql: "ROLLBACK", params: [] }) });
        throw error;
      } finally {
        statementTimeout = previousTimeout;
        releasedTransactions++;
      }
    };
    const makeTransaction = () => ({
      execute,
      transaction: runTransaction,
    });
    const db = {
      transaction: runTransaction,
    };
    vi.doMock("drizzle-orm/neon-serverless", () => ({ drizzle: () => db }));
    vi.doMock("@neondatabase/serverless", () => ({
      Pool: class {
        connect = vi.fn();
        query = vi.fn();
        end = vi.fn(async () => {});
        on = vi.fn();
      },
    }));

    const { createGetDb } = await import("./create-get-db.js");
    const { getDbExec, getScopedDbExec } = await import("./client.js");
    const database = await createGetDb({})();
    const { assertAccess } = await import("../sharing/access.js");
    const { registerShareableResource } =
      await import("../sharing/registry.js");
    const { createSharesTable } = await import("../sharing/schema.js");
    const { runWithRequestContext } =
      await import("../server/request-context.js");
    const { ownableColumns, table, text } = await import("./schema.js");
    const resourceTable = table("transaction_scope_access_docs", {
      id: text("id").primaryKey(),
      title: text("title").notNull(),
      ...ownableColumns(),
    });
    registerShareableResource({
      type: "transaction-scope-access-doc",
      resourceTable,
      sharesTable: createSharesTable("transaction_scope_access_shares"),
      displayName: "Document",
      getDb: () => {
        throw new Error("Access check used the global database");
      },
    });

    const result = await database.transaction(async (tx: any) => {
      const parentScope = getScopedDbExec();
      expect(parentScope).toBeDefined();
      const queryResult = await getDbExec().execute({
        sql: "SELECT ?::int AS id",
        args: [42],
      });
      const access = await runWithRequestContext(
        { userEmail: "owner@example.com", orgId: "org-1" },
        () => assertAccess("transaction-scope-access-doc", "doc-1", "owner"),
      );
      await getDbExec().execute({
        sql: "SELECT ?::int AS id",
        args: [43],
        timeoutMs: 250,
      });
      expect(statementTimeout).toBe("90ms");
      await getDbExec().execute("SELECT 1");
      expect(statementTimeout).toBe("90ms");
      timeoutOperations.length = 0;
      await Promise.all([
        getDbExec().execute({ sql: "SELECT 101", timeoutMs: 25 }),
        tx.transaction(() =>
          getDbExec().execute({ sql: "SELECT 102", timeoutMs: 50 }),
        ),
        getDbExec().execute("SELECT 103"),
      ]);
      await getDbExec().transaction(() =>
        getDbExec().execute({ sql: "SELECT 104", timeoutMs: 40 }),
      );
      expect(timeoutOperations).toEqual([
        "read:90ms",
        "set:23ms",
        "query:SELECT 101@23ms",
        "restore:90ms",
        "query:SELECT 103@90ms",
        "read:90ms",
        "set:45ms",
        "query:SELECT 102@45ms",
        "restore:90ms",
        "read:90ms",
        "set:36ms",
        "query:SELECT 104@36ms",
        "restore:90ms",
      ]);
      expect(statementTimeout).toBe("90ms");
      await expect(
        tx.transaction(async () => {
          expect(getScopedDbExec()).not.toBe(parentScope);
          await getDbExec().execute("SELECT 1");
          throw new Error("rollback savepoint");
        }),
      ).rejects.toThrow("rollback savepoint");
      expect(getScopedDbExec()).toBe(parentScope);
      return { queryResult, access };
    });

    expect(result.queryResult).toEqual({ rows: [{ id: 42 }], rowsAffected: 1 });
    expect(result.access.role).toBe("owner");
    expect(statementTimeout).toBe("0");
    delayCancellationResponse = true;
    let timedOutTransactionSettled = false;
    const timedOutTransaction = database
      .transaction(() =>
        getDbExec().execute({
          sql: "SELECT pg_sleep(?)",
          args: [1],
          timeoutMs: 25,
        }),
      )
      .finally(() => {
        timedOutTransactionSettled = true;
      });
    const explicitTimeoutAssertion = expect(
      timedOutTransaction,
    ).rejects.toThrow("DB query timed out after 25ms (connection terminated)");
    await new Promise((resolve) => setTimeout(resolve, 35));
    expect(timedOutTransactionSettled).toBe(false);
    await explicitTimeoutAssertion;
    delayCancellationResponse = false;
    expect(timedOutTransactionSettled).toBe(true);
    expect(statementTimeout).toBe("0");
    expect(rolledBackTransactions).toBe(2);
    expect(
      execute.mock.calls.some(([query]) =>
        query.toQuery().sql.startsWith("SET LOCAL statement_timeout = "),
      ),
    ).toBe(true);

    vi.stubEnv("DB_OP_TIMEOUT_MS", "25");
    let defaultTimedOutTransactionSettled = false;
    const defaultTimedOutTransaction = database
      .transaction(() => getDbExec().execute("SELECT pg_sleep(?)"))
      .finally(() => {
        defaultTimedOutTransactionSettled = true;
      });
    const defaultTimeoutAssertion = expect(
      defaultTimedOutTransaction,
    ).rejects.toThrow("canceling statement due to statement timeout");
    await new Promise((resolve) => setTimeout(resolve, 35));
    expect(defaultTimedOutTransactionSettled).toBe(true);
    await defaultTimeoutAssertion;
    expect(rolledBackTransactions).toBe(3);
    expect(releasedTransactions).toBeGreaterThanOrEqual(4);
    expect(statementTimeout).toBe("0");
  });
});

const TIMEOUT_MS = 20;

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
        return new Promise<never>(() => {});
      }
      return makeClient();
    }),

    query: vi.fn(async (sql: string, args?: any[]) => {
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
          return {
            query: vi.fn(async () => {
              const err: any = new Error("ECONNRESET");
              err.code = "ECONNRESET";
              throw err;
            }),
            release: vi.fn(),
          };
        }
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

    expect(pool.connect).toHaveBeenCalledTimes(2);
    expect(result.rows).toEqual([{ id: 42 }]);
  });

  it("retries Drizzle query-config SELECTs on connection errors", async () => {
    const { buildResilientNeonPool } = await import("./create-get-db.js");

    let callCount = 0;
    const pool = {
      connect: vi.fn(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            query: vi.fn(async () => {
              const err: any = new Error("ECONNRESET");
              err.code = "ECONNRESET";
              throw err;
            }),
            release: vi.fn(),
          };
        }
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
    const result = await resilient.query(
      {
        text: "SELECT id FROM users WHERE id = $1",
        rowMode: "array",
      } as any,
      [42],
    );

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

    expect(connectCount).toBe(1);
  });

  it("write (INSERT) IS retried when acquire times out (pre-send CONNECT_TIMEOUT)", async () => {
    const { buildResilientNeonPool } = await import("./create-get-db.js");

    let connectCount = 0;
    const pool = {
      connect: vi.fn(async () => {
        connectCount++;
        if (connectCount === 1) {
          return new Promise<never>(() => {});
        }
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

    expect(connectCount).toBe(2);
    expect(result.rowCount).toBe(1);
  });

  it("forwards non-query pool members unchanged (end, on, etc.)", async () => {
    const { buildResilientNeonPool } = await import("./create-get-db.js");

    const pool = makeMockPool();
    const resilient = buildResilientNeonPool(pool as any);

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
    expect(releasesMock).toHaveBeenCalledWith(undefined);
  });

  it("arms Neon idle transaction cleanup when Drizzle starts a transaction", async () => {
    const { buildResilientNeonPool } = await import("./create-get-db.js");

    const client = {
      query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
      release: vi.fn(),
    };
    const pool = {
      connect: vi.fn(async () => client),
      query: vi.fn(),
      end: vi.fn(),
      on: vi.fn(),
    };

    const resilient = buildResilientNeonPool(pool as any);
    const transactionClient = await resilient.connect();

    await transactionClient.query({ text: "begin", rowMode: "array" }, []);
    await transactionClient.query("SELECT 1");

    expect(client.query).toHaveBeenNthCalledWith(
      1,
      "begin; SET LOCAL idle_in_transaction_session_timeout = 30000",
    );
    expect(client.query).toHaveBeenNthCalledWith(2, "SELECT 1");
  });

  it("bounds Drizzle transaction acquires and releases late clients", async () => {
    const { buildResilientNeonPool } = await import("./create-get-db.js");

    let resolveLateAcquire!: (client: any) => void;
    const lateClient = {
      query: vi.fn(),
      release: vi.fn(),
    };
    const client = {
      query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
      release: vi.fn(),
    };
    const pool = {
      connect: vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveLateAcquire = resolve;
            }),
        )
        .mockResolvedValueOnce(client),
      query: vi.fn(),
      end: vi.fn(),
      on: vi.fn(),
    };

    const resilient = buildResilientNeonPool(pool as any);
    const transactionClient = await resilient.connect();

    expect(pool.connect).toHaveBeenCalledTimes(2);
    await transactionClient.query("SELECT 1");
    transactionClient.release();

    resolveLateAcquire(lateClient);
    await Promise.resolve();
    expect(lateClient.release).toHaveBeenCalledTimes(1);
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

describe("createGetDb — lazy proxy before init resolves", () => {
  afterEach(() => {
    vi.resetModules();
  });

  async function getLazyDbFactory(): Promise<() => any> {
    vi.doMock("./client.js", async (importOriginal) => {
      const actual = await importOriginal<typeof import("./client.js")>();
      return {
        ...actual,
        isPgliteUrl: vi.fn(() => true),
        loadPgliteDrizzle: vi.fn(() => new Promise(() => {})),
      };
    });
    const { createGetDb } = await import("./create-get-db.js");
    return createGetDb({});
  }

  it("fails loudly instead of masquerading as a resolved SQL entity when probed via getSQL/shouldOmitSQLParens", async () => {
    const getDb = await getLazyDbFactory();
    const db = getDb();

    const subqueryChain = db.select({ id: "recordingId" }).from("meetings");

    for (const prop of ["getSQL", "shouldOmitSQLParens"] as const) {
      expect(() => subqueryChain[prop]).toThrow(/unresolved|await/i);
    }
  });

  it("does not recurse forever when duck-typed the way SQL.buildQueryFromSourceParams does", async () => {
    const getDb = await getLazyDbFactory();
    const db = getDb();
    const subqueryChain = db.select({ id: "recordingId" }).from("meetings");

    function isSQLWrapper(value: any): boolean {
      return (
        value !== null &&
        value !== undefined &&
        typeof value.getSQL === "function"
      );
    }
    function drainAsSql(value: any): any {
      if (isSQLWrapper(value)) return drainAsSql(value.getSQL());
      return value;
    }

    expect(() => drainAsSql(subqueryChain)).toThrow(/unresolved|await/i);
  });
});

describe("createGetDb hosted-runtime local database guard", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    Reflect.deleteProperty(globalThis as Record<string, unknown>, "__env__");
    Reflect.deleteProperty(globalThis as Record<string, unknown>, "__cf_env");
  });

  it("rejects instead of opening PGlite on a hosted function invocation with no database URL", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AWS_LAMBDA_FUNCTION_NAME", "app-server");
    vi.stubEnv("APP_NAME", "");
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("DATABASE_URL_UNPOOLED", "");
    vi.stubEnv("NETLIFY_DATABASE_URL", "");
    vi.stubEnv("NETLIFY_DATABASE_URL_UNPOOLED", "");

    const { createGetDb } = await import("./create-get-db.js");
    const { HostedRuntimeLocalDatabaseError } = await import("./client.js");
    const getDb = createGetDb({});

    await expect(getDb().select()).rejects.toThrow(
      HostedRuntimeLocalDatabaseError,
    );
  });

  it("rejects on a Cloudflare Worker invocation with no database URL", async () => {
    vi.stubEnv("APP_NAME", "");
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("DATABASE_URL_UNPOOLED", "");
    vi.stubEnv("NETLIFY_DATABASE_URL", "");
    vi.stubEnv("NETLIFY_DATABASE_URL_UNPOOLED", "");
    vi.stubGlobal("__cf_env", {});

    const { createGetDb } = await import("./create-get-db.js");
    const { HostedRuntimeLocalDatabaseError } = await import("./client.js");
    const getDb = createGetDb({});

    await expect(getDb().select()).rejects.toThrow(
      HostedRuntimeLocalDatabaseError,
    );
  });
});
