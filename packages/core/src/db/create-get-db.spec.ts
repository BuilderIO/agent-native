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
    let hangTransactionTimeoutSetup = false;
    let hangTransactionStatement = false;
    let destroyedTransactionConnections = 0;
    const timeoutOperations: string[] = [];
    const queryDelays = new Map<string, number>();
    const transactionNestingIndexes: number[] = [];
    const preparedQueryExecutions: Array<{
      sql: string;
      sessionId: number;
      token?: unknown;
    }> = [];
    let nextSessionId = 0;
    let rootTransactionsStarted = 0;
    const rawQuery = (query: string) => ({
      getSQL: () => ({ toQuery: () => ({ sql: query, params: [] }) }),
    });
    const execute = vi.fn(async (query: any, session?: any) => {
      const compiled = query.toQuery();
      if (
        compiled.sql.startsWith("SELECT set_config('statement_timeout', CASE")
      ) {
        if (hangTransactionTimeoutSetup) return await hangQuery(session);
        const setupDelayMs = queryDelays.get("transaction-timeout-setup");
        if (setupDelayMs) {
          timeoutOperations.push("transaction-timeout-config:start");
          await new Promise((resolve) => setTimeout(resolve, setupDelayMs));
        }
        statementTimeout =
          compiled.sql.match(/THEN '(\d+ms)'/)?.[1] ?? statementTimeout;
        if (setupDelayMs)
          timeoutOperations.push("transaction-timeout-config:complete");
        return { rows: [{ set_config: statementTimeout }], rowCount: 1 };
      }
      if (hangTransactionStatement && compiled.sql === "SELECT 109")
        return await hangQuery(session);
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
        timeoutOperations.push("rollback");
        rolledBackTransactions++;
        return { rows: [], rowCount: 0 };
      }
      if (
        compiled.sql === "SELECT 101" ||
        compiled.sql === "SELECT 102" ||
        compiled.sql === "SELECT 103" ||
        compiled.sql === "SELECT 104" ||
        compiled.sql === "SELECT 105" ||
        compiled.sql === "SELECT 106" ||
        compiled.sql === "SELECT 107" ||
        compiled.sql === "SELECT 108" ||
        compiled.sql === "SELECT 110"
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
      const delayMs = queryDelays.get(compiled.sql);
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
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
    const hangQuery = (session: any) =>
      new Promise((_, reject) => {
        const abort = () => {
          session.pendingQueries.delete(abort);
          reject(new Error("connection terminated"));
        };
        session.pendingQueries.add(abort);
      });
    const makeSession = () => {
      const sessionId = ++nextSessionId;
      const session: any = { id: sessionId, pendingQueries: new Set() };
      session.client = {
        release: vi.fn(),
        connection: {
          stream: {
            destroy() {
              destroyedTransactionConnections++;
              for (const abort of [...session.pendingQueries]) abort();
            },
          },
        },
      };
      Object.assign(session, {
        id: sessionId,
        prepareQuery(query: any) {
          const compiled =
            query.toQuery?.() ?? query.getSQL?.().toQuery?.() ?? query;
          let token: unknown;
          return {
            setToken(nextToken: unknown) {
              token = nextToken;
              return this;
            },
            execute() {
              preparedQueryExecutions.push({
                sql: compiled.sql,
                sessionId,
                ...(token === undefined ? {} : { token }),
              });
              return execute({ toQuery: () => compiled }, session);
            },
          };
        },
        execute(query: any) {
          return this.prepareQuery(query.getSQL?.() ?? query).execute();
        },
        query(query: string, params: unknown[]) {
          return execute({ toQuery: () => ({ sql: query, params }) }, session);
        },
        queryObjects(query: string, params: unknown[]) {
          return execute({ toQuery: () => ({ sql: query, params }) }, session);
        },
      });
      return session;
    };
    const makeRelationalQueries = (
      session: any,
      relations: Record<string, string>,
    ) =>
      Object.fromEntries(
        Object.entries(relations).map(([tableName, query]) => [
          tableName,
          {
            findMany() {
              return {
                session,
                execute() {
                  return this.session.execute(rawQuery(query));
                },
              };
            },
            findFirst() {
              return {
                session,
                execute() {
                  return this.session.execute(rawQuery(query));
                },
              };
            },
          },
        ]),
      );
    const runTransaction = async (
      run: (transaction: any) => unknown,
      session?: any,
      nestingIndex = 0,
    ) => {
      const previousTimeout = statementTimeout;
      try {
        return await run(makeTransaction(session, nestingIndex));
      } catch (error) {
        await execute({ toQuery: () => ({ sql: "ROLLBACK", params: [] }) });
        throw error;
      } finally {
        statementTimeout = previousTimeout;
        releasedTransactions++;
      }
    };
    const makeTransaction = (session = makeSession(), nestingIndex = 0) => ({
      session,
      query: makeRelationalQueries(session, { docs: "SELECT 110" }),
      execute(query: any) {
        return this.session.execute(query);
      },
      transaction: (run: (transaction: any) => unknown) =>
        runTransaction(
          (nested) => {
            transactionNestingIndexes.push(nestingIndex + 1);
            return run(nested);
          },
          makeSession(),
          nestingIndex + 1,
        ),
    });
    const makeDatabase = (session: any, relations: Record<string, string>) => ({
      session,
      query: makeRelationalQueries(session, relations),
      select() {
        const selectSession = this.session;
        const query = rawQuery(
          relations.otherTable
            ? 'SELECT 114 FROM "other_schema"."other_table"'
            : "SELECT 114",
        );
        return {
          from() {
            return {
              execute: () => selectSession.prepareQuery(query).execute(),
              prepare: () => selectSession.prepareQuery(query),
            };
          },
        };
      },
      execute(query: any) {
        return this.session.execute(query);
      },
      transaction(run: (transaction: any) => unknown) {
        rootTransactionsStarted++;
        return runTransaction(run);
      },
    });
    const db = makeDatabase(makeSession(), { docs: "SELECT 111" });
    const otherDb = makeDatabase(makeSession(), {
      otherTable: "SELECT 112",
    });
    vi.doMock("drizzle-orm/neon-serverless", () => ({
      drizzle: (_pool: unknown, options: any) =>
        options.schema.otherStore ? otherDb : db,
    }));
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
    const otherDatabase = await createGetDb({ otherStore: true })();
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
      const outerSessionId = tx.session.id;
      const capturedOuterQuery = tx.session
        .prepareQuery({
          toQuery: () => ({ sql: "SELECT 106", params: [] }),
        })
        .setToken("captured-token");
      const capturedOuterRelationalQuery = tx.query.docs.findMany();
      await Promise.all([
        getDbExec().execute({ sql: "SELECT 101", timeoutMs: 25 }),
        tx.transaction(async (nestedTx: any) =>
          Promise.all([
            getDbExec().execute({ sql: "SELECT 102", timeoutMs: 50 }),
            nestedTx.execute(rawQuery("SELECT 105")),
            capturedOuterQuery.execute(),
            nestedTx.query.docs.findMany().execute(),
            capturedOuterRelationalQuery.execute(),
          ]),
        ),
        tx.execute(rawQuery("SELECT 108")),
        getDbExec().execute("SELECT 103"),
      ]);
      const capturedExecution = preparedQueryExecutions.find(
        ({ sql }) => sql === "SELECT 106",
      );
      expect(capturedExecution?.sessionId).not.toBe(outerSessionId);
      expect(capturedExecution?.token).toBe("captured-token");
      const relationalExecutions = preparedQueryExecutions.filter(
        ({ sql }) => sql === "SELECT 110",
      );
      expect(relationalExecutions).toHaveLength(2);
      expect(
        relationalExecutions.every(
          ({ sessionId }) => sessionId !== outerSessionId,
        ),
      ).toBe(true);
      transactionNestingIndexes.length = 0;
      await tx.transaction(async () => {
        await tx.transaction(async () => undefined);
        const transactionsBeforeRejectedRootCall = rootTransactionsStarted;
        await expect(
          Promise.resolve().then(() =>
            database.transaction(async () => undefined),
          ),
        ).rejects.toThrow(
          "Cannot start a root transaction while another transaction is active; use the transaction handle to create a savepoint",
        );
        expect(rootTransactionsStarted).toBe(
          transactionsBeforeRejectedRootCall,
        );
      });
      expect(transactionNestingIndexes).toEqual([1, 2]);
      let escapedRelationalQuery: any;
      await tx.transaction(async (nestedTx: any) => {
        escapedRelationalQuery = nestedTx.query.docs.findMany();
      });
      await expect(
        Promise.resolve().then(() => escapedRelationalQuery.execute()),
      ).rejects.toThrow(
        "Cannot use a database handle after its transaction has completed",
      );
      await getDbExec().transaction(() =>
        getDbExec().execute({ sql: "SELECT 104", timeoutMs: 40 }),
      );
      const nestedTimeout = Number(
        timeoutOperations[5]?.match(/^set:(\d+)ms$/)?.[1],
      );
      const finalTimeout = Number(
        timeoutOperations.at(-3)?.match(/^set:(\d+)ms$/)?.[1],
      );
      expect(nestedTimeout).toBeGreaterThan(0);
      expect(nestedTimeout).toBeLessThan(50);
      expect(finalTimeout).toBeGreaterThan(0);
      expect(finalTimeout).toBeLessThan(40);
      expect(timeoutOperations.slice(0, 4)).toEqual([
        "read:90ms",
        expect.stringMatching(/^set:2[0-3]ms$/),
        expect.stringMatching(/^query:SELECT 101@2[0-3]ms$/),
        "restore:90ms",
      ]);
      expect(timeoutOperations.slice(4)).toEqual([
        "read:90ms",
        `set:${nestedTimeout}ms`,
        `query:SELECT 102@${nestedTimeout}ms`,
        "restore:90ms",
        "query:SELECT 105@90ms",
        "query:SELECT 106@90ms",
        "query:SELECT 110@90ms",
        "query:SELECT 110@90ms",
        "query:SELECT 108@90ms",
        "query:SELECT 103@90ms",
        "read:90ms",
        `set:${finalTimeout}ms`,
        `query:SELECT 104@${finalTimeout}ms`,
        "restore:90ms",
      ]);
      expect(timeoutOperations[6]).toBe(
        `query:SELECT 102@${timeoutOperations[5]?.slice("set:".length)}`,
      );
      expect(timeoutOperations[16]).toBe(
        `query:SELECT 104@${timeoutOperations[15]?.slice("set:".length)}`,
      );
      const parentContextQuery = new Promise<void>((resolve, reject) => {
        setTimeout(() => {
          void tx.execute(rawQuery("SELECT 113")).then(resolve, reject);
        }, 0);
      });
      void parentContextQuery.catch(() => {});
      await expect(
        tx.transaction(async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          await parentContextQuery;
        }),
      ).rejects.toThrow(
        "Cannot use a transaction handle while its nested transaction is active",
      );
      expect(
        preparedQueryExecutions.some(({ sql }) => sql === "SELECT 113"),
      ).toBe(false);
      expect(statementTimeout).toBe("90ms");
      timeoutOperations.length = 0;
      queryDelays.set("SELECT 106", 35);
      await tx.transaction(async () => {
        const inFlight = getDbExec().execute({
          sql: "SELECT 106",
          timeoutMs: 80,
        });
        await expect(
          getDbExec().execute({ sql: "SELECT 107", timeoutMs: 20 }),
        ).rejects.toThrow(
          "DB query timed out after 20ms (connection terminated)",
        );
        await inFlight;
      });
      queryDelays.clear();
      expect(
        timeoutOperations.some((operation) =>
          /^query:SELECT 106@7[0-2]ms$/.test(operation),
        ),
      ).toBe(true);
      expect(
        timeoutOperations.some((operation) => operation.includes("SELECT 107")),
      ).toBe(false);
      timeoutOperations.length = 0;
      queryDelays.set("transaction-timeout-setup", 45);
      vi.stubEnv("DB_OP_TIMEOUT_MS", "25");
      await expect(tx.transaction(async () => undefined)).rejects.toThrow(
        "DB query timed out after 25ms (connection terminated)",
      );
      const connectionsDestroyedBeforeHangingSetup =
        destroyedTransactionConnections;
      const hangingSetupStartedAt = Date.now();
      hangTransactionTimeoutSetup = true;
      await expect(tx.transaction(async () => undefined)).rejects.toThrow(
        "DB query timed out after 25ms (connection terminated)",
      );
      hangTransactionTimeoutSetup = false;
      expect(Date.now() - hangingSetupStartedAt).toBeLessThan(500);
      expect(destroyedTransactionConnections).toBeGreaterThan(
        connectionsDestroyedBeforeHangingSetup,
      );
      const connectionsDestroyedBeforeHangingStatement =
        destroyedTransactionConnections;
      const hangingStatementStartedAt = Date.now();
      hangTransactionStatement = true;
      await expect(
        tx.transaction(() =>
          getDbExec().execute({ sql: "SELECT 109", timeoutMs: 25 }),
        ),
      ).rejects.toThrow(
        "DB query timed out after 25ms (connection terminated)",
      );
      hangTransactionStatement = false;
      expect(Date.now() - hangingStatementStartedAt).toBeLessThan(500);
      expect(destroyedTransactionConnections).toBeGreaterThan(
        connectionsDestroyedBeforeHangingStatement,
      );
      vi.stubEnv("DB_OP_TIMEOUT_MS", "100");
      queryDelays.delete("transaction-timeout-setup");
      expect(
        timeoutOperations.indexOf("transaction-timeout-config:complete"),
      ).toBeLessThan(timeoutOperations.indexOf("rollback"));
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
    const capturedRelationalQuery = otherDatabase.query.otherTable.findMany();
    const capturedSelectQuery = otherDatabase.select().from("otherTable");
    const capturedSelectPrepared = otherDatabase
      .select()
      .from("otherTable")
      .prepare();
    const rootSessionIds = new Set([
      database.session.id,
      otherDatabase.session.id,
    ]);
    let activeTransactionSessionId = 0;
    await database.transaction(async (tx: any) => {
      activeTransactionSessionId = tx.session.id;
      await otherDatabase.execute(rawQuery("SELECT 111"));
      await otherDatabase.query.otherTable.findMany().execute();
      await capturedRelationalQuery.execute();
      await capturedSelectQuery.execute();
      await capturedSelectPrepared.execute();
    });
    const crossStoreExecutions = preparedQueryExecutions.filter(
      ({ sql }) =>
        sql === "SELECT 111" ||
        sql === "SELECT 112" ||
        sql === 'SELECT 114 FROM "other_schema"."other_table"',
    );
    expect(crossStoreExecutions.map(({ sql }) => sql)).toEqual([
      "SELECT 111",
      "SELECT 112",
      "SELECT 112",
      'SELECT 114 FROM "other_schema"."other_table"',
      'SELECT 114 FROM "other_schema"."other_table"',
    ]);
    expect(
      crossStoreExecutions.every(
        ({ sessionId }) =>
          sessionId === activeTransactionSessionId &&
          !rootSessionIds.has(sessionId),
      ),
    ).toBe(true);
    let escapedRootSelect: any;
    await database.transaction(async () => {
      escapedRootSelect = database.select().from("docs");
    });
    await expect(
      Promise.resolve().then(() => escapedRootSelect.execute()),
    ).rejects.toThrow(
      "Cannot use a database handle after its transaction has completed",
    );
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
    expect(rolledBackTransactions).toBe(6);
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
    expect(rolledBackTransactions).toBe(7);
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
