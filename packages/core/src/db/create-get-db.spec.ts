import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { eq, inArray, is, sql, Subquery, WithSubquery } from "drizzle-orm";
import {
  PgDialect,
  pgTable,
  QueryBuilder,
  text,
  union,
} from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/postgres-js";
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

  it("waits for registered schema dependencies, shares concurrent readiness, and retries failures", async () => {
    vi.stubEnv("DATABASE_URL", "pglite:memory");
    const { createGetDb } = await import("./create-get-db.js");
    const { registerDbDependency } = await import("./readiness.js");
    const { sql } = await import("drizzle-orm");
    const getDb = createGetDb({});
    let attempts = 0;
    registerDbDependency(getDb, async () => {
      attempts++;
      if (attempts === 1) throw new Error("schema unavailable");
      const { getDbExec } = await import("./client.js");
      await getDbExec().execute(
        "CREATE TABLE dependency_probe (id TEXT PRIMARY KEY)",
      );
    });
    await expect(
      getDb().execute(sql.raw("SELECT * FROM dependency_probe")),
    ).rejects.toThrow("schema unavailable");
    await Promise.all([
      getDb().execute(sql.raw("SELECT * FROM dependency_probe")),
      getDb().execute(sql.raw("SELECT * FROM dependency_probe")),
    ]);
    expect(attempts).toBe(2);
    await getDb().execute(sql.raw("SELECT * FROM dependency_probe"));
    expect(attempts).toBe(2);
  });

  it("rebuilds the PGlite Drizzle handle after database clients close", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "create-get-db-close-"));
    vi.stubEnv("DATABASE_URL", `pglite:${path.join(dir, "db")}`);

    try {
      const [{ createGetDb }, { closeDbExec }] = await Promise.all([
        import("./create-get-db.js"),
        import("./client.js"),
      ]);
      const { sql } = await import("drizzle-orm");
      const getDb = createGetDb({});

      await getDb().execute(sql.raw("SELECT 1"));
      await closeDbExec();
      await getDb().execute(sql.raw("SELECT 1"));
    } finally {
      const { closeDbExec } = await import("./client.js");
      await closeDbExec();
      await rm(dir, { recursive: true, force: true });
    }
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
        const readDelayMs = queryDelays.get("statement-timeout-read");
        if (readDelayMs)
          await new Promise((resolve) => setTimeout(resolve, readDelayMs));
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
    const { getDbExec, getEnclosingTransactionDbExec, getScopedDbExec } =
      await import("./client.js");
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
      expect(getEnclosingTransactionDbExec()).toBe(parentScope);
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
      const firstTimeout = Number(
        timeoutOperations[1]?.match(/^set:(\d+)ms$/)?.[1],
      );
      expect(firstTimeout).toBeGreaterThan(0);
      expect(firstTimeout).toBeLessThanOrEqual(25);
      expect(timeoutOperations.slice(0, 4)).toEqual([
        "read:90ms",
        `set:${firstTimeout}ms`,
        `query:SELECT 101@${firstTimeout}ms`,
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
      for (const [readDelayMs, serverTimeoutMs] of [
        [0, 72],
        [5, 68],
      ]) {
        timeoutOperations.length = 0;
        queryDelays.set("SELECT 106", 35);
        queryDelays.set("statement-timeout-read", readDelayMs);
        await tx.transaction(async () => {
          let settled: Promise<unknown> | undefined;
          // Isolate scheduling from wall-clock load while charging setup time to the query budget.
          vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
          try {
            const destroyedBeforeQueueTimeout = destroyedTransactionConnections;
            let inFlightComplete = false;
            let queuedSettled = false;
            const inFlight = getDbExec()
              .execute({ sql: "SELECT 106", timeoutMs: 80 })
              .then((value) => {
                inFlightComplete = true;
                return value;
              });
            const queued = getDbExec().execute({
              sql: "SELECT 107",
              timeoutMs: 20,
            });
            void queued.then(
              () => {
                queuedSettled = true;
              },
              () => {
                queuedSettled = true;
              },
            );
            settled = Promise.allSettled([inFlight, queued]);
            await vi.advanceTimersByTimeAsync(19);
            expect(queuedSettled).toBe(false);
            expect(inFlightComplete).toBe(false);
            expect(timeoutOperations).toEqual([
              "read:90ms",
              `set:${serverTimeoutMs}ms`,
              `query:SELECT 106@${serverTimeoutMs}ms`,
            ]);
            await vi.advanceTimersByTimeAsync(1);
            expect(queuedSettled).toBe(true);
            await expect(queued).rejects.toThrow(
              "DB query timed out after 20ms (connection terminated)",
            );
            expect(inFlightComplete).toBe(false);
            expect(destroyedTransactionConnections).toBe(
              destroyedBeforeQueueTimeout,
            );
            await vi.advanceTimersByTimeAsync(readDelayMs + 35 - 20);
            expect(inFlightComplete).toBe(true);
            await expect(inFlight).resolves.toEqual({
              rows: [{ id: 42 }],
              rowsAffected: 1,
            });
            expect(timeoutOperations).toEqual([
              "read:90ms",
              `set:${serverTimeoutMs}ms`,
              `query:SELECT 106@${serverTimeoutMs}ms`,
              "restore:90ms",
            ]);
            expect(statementTimeout).toBe("90ms");
            expect(vi.getTimerCount()).toBe(0);
          } finally {
            try {
              await vi.advanceTimersByTimeAsync(80);
            } finally {
              vi.useRealTimers();
              queryDelays.clear();
            }
            await settled;
          }
        });
      }
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
          expect(getEnclosingTransactionDbExec()).toBe(getScopedDbExec());
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

    vi.stubEnv("DB_OP_TIMEOUT_MS", "1000");
    let defaultTimedOutTransactionSettled = false;
    const defaultTimedOutTransaction = database
      .transaction(() => getDbExec().execute("SELECT pg_sleep(?)"))
      .finally(() => {
        defaultTimedOutTransactionSettled = true;
      });
    const defaultTimeoutAssertion = expect(
      defaultTimedOutTransaction,
    ).rejects.toThrow("canceling statement due to statement timeout");
    await defaultTimeoutAssertion;
    expect(defaultTimedOutTransactionSettled).toBe(true);
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

  const meetings = pgTable("meetings", {
    id: text("id"),
    recordingId: text("recording_id"),
  });
  const clips = pgTable("clips", { id: text("id") });

  it("builds a select subquery's SQL from the cold proxy, matching a connection-less builder", async () => {
    const getDb = await getLazyDbFactory();
    const db = getDb();
    const cold = db.select({ id: meetings.recordingId }).from(meetings);
    const expected = new QueryBuilder()
      .select({ id: meetings.recordingId })
      .from(meetings);

    const cases = [inArray(clips.id, cold), inArray(clips.id, expected)].map(
      (cond) => new PgDialect().sqlToQuery(cond),
    );
    expect(cases[0]).toEqual(cases[1]);
    expect(cases[0].sql).toContain('select "recording_id" from "meetings"');
  });

  it("evaluates a set callback once when a cold query is read repeatedly", async () => {
    const db = (await getLazyDbFactory())();
    const reference = drizzle.mock();
    const build = (source: typeof reference) => {
      let calls = 0;
      const query = source
        .select({ id: meetings.id })
        .from(meetings)
        .union(() =>
          source
            .select({ id: meetings.id })
            .from(meetings)
            .where(eq(meetings.id, String(++calls))),
        );
      const outer = new QueryBuilder()
        .select()
        .from(meetings)
        .where(inArray(meetings.id, query));
      return { first: outer.toSQL(), second: outer.toSQL(), calls };
    };
    const expected = build(reference);
    const actual = build(db);
    expect(actual).toEqual(expected);
    expect(expected.calls).toBe(1);
  });

  it("shares callback results when a cold query crosses database factories", async () => {
    const first = (await getLazyDbFactory())();
    const { createGetDb } = await import("./create-get-db.js");
    const second = createGetDb({})();
    let calls = 0;
    const query = first
      .select({ id: meetings.id })
      .from(meetings)
      .union(() =>
        first
          .select({ id: meetings.id })
          .from(meetings)
          .where(eq(meetings.id, String(++calls))),
      );
    const sqlFrom = (source: typeof second) =>
      source
        .select({ id: meetings.id })
        .from(meetings)
        .union(query)
        .as("combined");
    const outer = (subquery: ReturnType<typeof sqlFrom>) =>
      new QueryBuilder().select().from(subquery).toSQL();
    expect(outer(sqlFrom(first))).toEqual(outer(sqlFrom(second)));
    expect(calls).toBe(1);
  });

  it("preserves select callback results across metadata reads and derived chains", async () => {
    const db = (await getLazyDbFactory())();
    const reference = drizzle.mock();
    const build = (source: typeof reference) => {
      let calls = 0;
      const query = source
        .select({ id: meetings.id })
        .from(meetings)
        .where((fields) => eq(fields.id, String(++calls)));
      const first = new QueryBuilder()
        .select()
        .from(meetings)
        .where(inArray(meetings.id, query))
        .toSQL();
      const second = new QueryBuilder()
        .select()
        .from(query.as("filtered"))
        .toSQL();
      return { first, second, calls };
    };
    const expected = build(reference);
    expect(build(db)).toEqual(expected);
    expect(expected.calls).toBe(1);
  });

  it("uses the same callback result for offline SQL and deferred execution", async () => {
    vi.doUnmock("./client.js");
    vi.stubEnv("DATABASE_URL", "pglite:memory");
    const { createGetDb } = await import("./create-get-db.js");
    const { closeDbExec } = await import("./client.js");
    try {
      const db = createGetDb({})();
      let calls = 1;
      const cold = db
        .select({ id: meetings.id })
        .from(meetings)
        .where(eq(meetings.id, "1"))
        .union(() =>
          db
            .select({ id: meetings.id })
            .from(meetings)
            .where(eq(meetings.id, String(++calls))),
        );
      const offline = new QueryBuilder()
        .select()
        .from(meetings)
        .where(inArray(meetings.id, cold))
        .toSQL();
      await db.execute(sql`create table meetings (id text, recording_id text)`);
      await db.insert(meetings).values([{ id: "1" }, { id: "2" }, { id: "3" }]);
      const rows = await cold;
      expect({
        params: offline.params,
        ids: rows.map((row) => row.id).sort(),
        calls,
      }).toEqual({
        params: ["1", "2"],
        ids: ["1", "2"],
        calls: 2,
      });
      expect((await cold).map((row) => row.id).sort()).toEqual(["1", "2"]);
      expect(calls).toBe(2);
    } finally {
      await closeDbExec();
      vi.unstubAllEnvs();
    }
  });

  it("materializes aliased selects with fields and SQL aliases like Drizzle", async () => {
    const db = (await getLazyDbFactory())();
    const reference = drizzle.mock();
    const makeSubquery = (source: typeof reference) =>
      source
        .select({
          id: meetings.recordingId,
          label: sql<string>`upper(${meetings.id})`.as("upper_id"),
        })
        .from(meetings)
        .as("recent");
    const cold = makeSubquery(db);
    const expected = makeSubquery(reference);
    expect(is(cold, Subquery)).toBe(true);
    const outer = (subquery: typeof expected) =>
      new QueryBuilder()
        .select()
        .from(subquery)
        .where(eq(subquery.id, "recording"));
    expect(outer(cold).toSQL()).toEqual(outer(expected).toSQL());
    expect(new PgDialect().sqlToQuery(sql`${cold.label}`)).toEqual(
      new PgDialect().sqlToQuery(sql`${expected.label}`),
    );
  });

  it.each([
    "union",
    "unionAll",
    "intersect",
    "intersectAll",
    "except",
    "exceptAll",
  ] as const)("materializes cold %s operands like Drizzle", async (method) => {
    const db = (await getLazyDbFactory())();
    const reference = drizzle.mock();
    const makeSubquery = (source: typeof reference) => {
      const left = source.select({ id: meetings.id }).from(meetings);
      const right = source.select({ id: meetings.recordingId }).from(meetings);
      return left[method](right).as("combined");
    };
    const outer = (subquery: ReturnType<typeof makeSubquery>) =>
      new QueryBuilder().select().from(subquery).toSQL();
    expect(outer(makeSubquery(db))).toEqual(outer(makeSubquery(reference)));
  });

  it("resolves nested and callback cold set operands without hiding Drizzle errors", async () => {
    const db = (await getLazyDbFactory())();
    const reference = drizzle.mock();
    const makeSubquery = (source: typeof reference) => {
      const select = () => source.select({ id: meetings.id }).from(meetings);
      return select()
        .union(() => select().except(select()))
        .as("combined");
    };
    const outer = (subquery: ReturnType<typeof makeSubquery>) =>
      new QueryBuilder().select().from(subquery).toSQL();
    expect(outer(makeSubquery(db))).toEqual(outer(makeSubquery(reference)));
    const invalid = () =>
      db
        .select({ id: meetings.id })
        .from(meetings)
        .union(db.select({ other: meetings.id }).from(meetings))
        .as("bad");
    expect(invalid).toThrow(/selected fields are not the same/);
    const callbackError = new Error("set callback failed");
    expect(() =>
      db
        .select()
        .from(meetings)
        .union(() => {
          throw callbackError;
        })
        .as("bad"),
    ).toThrow(callbackError);
  });

  it.each([
    "union",
    "unionAll",
    "intersect",
    "intersectAll",
    "except",
    "exceptAll",
  ] as const)(
    "validates field order inside cold %s helper callbacks like Drizzle",
    async (method) => {
      const db = (await getLazyDbFactory())();
      const reference = drizzle.mock();
      const makeSubquery = (source: typeof reference, mismatch: boolean) => {
        const select = () =>
          source
            .select({ a: meetings.id, b: meetings.recordingId })
            .from(meetings);
        const other = () =>
          mismatch
            ? source
                .select({ b: meetings.recordingId, a: meetings.id })
                .from(meetings)
            : select();
        return select()
          .union((helpers) => helpers[method](select(), select(), other()))
          .as("combined");
      };
      const outer = (subquery: ReturnType<typeof makeSubquery>) =>
        new QueryBuilder().select().from(subquery).toSQL();
      expect(outer(makeSubquery(db, false))).toEqual(
        outer(makeSubquery(reference, false)),
      );
      expect(() => makeSubquery(reference, true)).toThrow(
        /selected fields are not the same/,
      );
      expect(() => makeSubquery(db, true)).toThrow(
        /selected fields are not the same/,
      );
    },
  );

  it("validates field order when a direct Drizzle set helper receives cold operands", async () => {
    const db = (await getLazyDbFactory())();
    const reference = drizzle.mock();
    const combine = (source: typeof reference) =>
      union(
        source
          .select({ a: meetings.id, b: meetings.recordingId })
          .from(meetings),
        source
          .select({ b: meetings.recordingId, a: meetings.id })
          .from(meetings),
      );
    expect(() => combine(reference)).toThrow(
      /selected fields are not the same/,
    );
    expect(() => combine(db)).toThrow(/selected fields are not the same/);
  });

  it("materializes a CTE from a cold select and builds a cold outer query", async () => {
    const db = (await getLazyDbFactory())();
    const reference = drizzle.mock();
    const makeCte = (source: typeof reference) =>
      source.$with("recent").as(
        source
          .select({
            id: meetings.recordingId,
            label: sql<string>`upper(${meetings.id})`.as("upper_id"),
          })
          .from(meetings),
      );
    const cold = makeCte(db);
    const expected = makeCte(reference);
    expect(is(cold, WithSubquery)).toBe(true);
    const coldOuter = db.with(cold).select().from(cold).as("outer_query");
    const expectedOuter = reference
      .with(expected)
      .select()
      .from(expected)
      .as("outer_query");
    const selectOuter = (subquery: typeof expectedOuter) =>
      new QueryBuilder()
        .select({ id: subquery.id, label: subquery.label })
        .from(subquery)
        .where(eq(subquery.id, "recording"))
        .toSQL();
    expect(selectOuter(coldOuter)).toEqual(selectOuter(expectedOuter));
  });

  it.each(["selectDistinct", "selectDistinctOn"] as const)(
    "preserves CTEs in cold %s aliases",
    async (method) => {
      const db = (await getLazyDbFactory())();
      const reference = drizzle.mock();
      const makeOuter = (source: typeof reference) => {
        const cte = source
          .$with("recent")
          .as((qb) => qb.select({ id: meetings.id }).from(meetings));
        const withCte = source.with(cte);
        return (
          method === "selectDistinct"
            ? withCte.selectDistinct()
            : withCte.selectDistinctOn([cte.id])
        )
          .from(cte)
          .as("outer_query");
      };
      const outerSql = (subquery: ReturnType<typeof makeOuter>) =>
        new QueryBuilder().select().from(subquery).toSQL();
      expect(outerSql(makeOuter(db))).toEqual(outerSql(makeOuter(reference)));
    },
  );

  it.each(["callback", "sql"] as const)(
    "materializes %s CTEs like Drizzle",
    async (kind) => {
      const db = (await getLazyDbFactory())();
      const reference = drizzle.mock();
      const makeCallbackCte = (source: typeof reference) =>
        source
          .$with("callback_cte")
          .as((qb) => qb.select({ id: meetings.id }).from(meetings));
      const makeSqlCte = (source: typeof reference) =>
        source
          .$with("sql_cte", { id: meetings.id })
          .as(sql`select ${meetings.id} from ${meetings}`);
      const makeCte = kind === "callback" ? makeCallbackCte : makeSqlCte;
      const cold = makeCte(db);
      const expected = makeCte(reference);
      expect(is(cold, WithSubquery)).toBe(true);
      const outer = (source: typeof reference, cte: typeof expected) =>
        source.with(cte).select().from(cte).as("outer_query");
      const selectOuter = (subquery: ReturnType<typeof outer>) =>
        new QueryBuilder().select().from(subquery).toSQL();
      expect(selectOuter(outer(db, cold))).toEqual(
        selectOuter(outer(reference, expected)),
      );
    },
  );

  it("preserves Drizzle errors for unaliased SQL fields", async () => {
    const db = (await getLazyDbFactory())();
    const reference = drizzle.mock();
    const makeSubquery = (source: typeof reference) =>
      source
        .select({ id: sql<string>`upper(${meetings.id})` })
        .from(meetings)
        .as("bad");
    const cold = makeSubquery(db);
    const expected = makeSubquery(reference);
    expect(() => cold.id).toThrowError(
      (() => {
        try {
          void expected.id;
        } catch (error) {
          return error as Error;
        }
        throw new Error("Expected Drizzle to reject the field");
      })(),
    );
  });

  it("evaluates CTE callbacks once when the resulting CTE is reused", async () => {
    const db = (await getLazyDbFactory())();
    const reference = drizzle.mock();
    const build = (source: typeof reference) => {
      let calls = 0;
      const cte = source.$with("filtered").as((qb) => {
        calls++;
        return qb.select({ id: meetings.id }).from(meetings);
      });
      const query = source.with(cte).select().from(cte).as("result");
      const outer = new QueryBuilder().select().from(query);
      return { first: outer.toSQL(), second: outer.toSQL(), calls };
    };
    const expected = build(reference);
    expect(build(db)).toEqual(expected);
    expect(expected.calls).toBe(1);
  });

  it("propagates errors from CTE callbacks", async () => {
    const db = (await getLazyDbFactory())();
    const error = new Error("CTE callback failed");
    expect(() =>
      db.$with("bad").as(() => {
        throw error;
      }),
    ).toThrow(error);
  });

  it("defers generic queries and executes cold outer queries on the initialized database", async () => {
    const reference = drizzle.mock();
    let initialize!: (value: { drizzle: () => typeof reference }) => void;
    vi.doMock("./client.js", async (importOriginal) => {
      const actual = await importOriginal<typeof import("./client.js")>();
      return {
        ...actual,
        isPgliteUrl: vi.fn(() => true),
        loadPgliteDrizzle: vi.fn(
          () =>
            new Promise((resolve) => {
              initialize = resolve;
            }),
        ),
        getPgliteClient: vi.fn(async () => ({})),
        pgliteDrizzleClient: vi.fn((_url: string, client: unknown) => client),
      };
    });
    const { createGetDb } = await import("./create-get-db.js");
    const db = createGetDb({})();
    const select = vi.spyOn(reference, "select");
    const insert = vi.spyOn(reference, "insert");
    const cte = db
      .$with("recent")
      .as((qb) => qb.select({ id: meetings.id }).from(meetings));
    const outer = db.with(cte).select().from(cte);
    const write = db.insert(meetings).values({ id: "1" });
    expect(() =>
      db
        .select({ id: meetings.id })
        .from(meetings)
        .union(write as never)
        .as("invalid"),
    ).toThrow(/await the database handle/i);
    expect(() =>
      db
        .select({ id: meetings.id })
        .from(meetings)
        .union(({ union }) =>
          union(db.select({ id: meetings.id }).from(meetings), write as never),
        )
        .as("invalid"),
    ).toThrow(/await the database handle/i);
    expect(select).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
    await Promise.resolve();
    initialize({ drizzle: () => reference });
    const expectedCte = reference
      .$with("recent")
      .as((qb) => qb.select({ id: meetings.id }).from(meetings));
    const expectedSelect = reference
      .with(expectedCte)
      .select()
      .from(expectedCte)
      .toSQL();
    const expectedInsert = reference
      .insert(meetings)
      .values({ id: "1" })
      .toSQL();
    expect(await outer.toSQL()).toEqual(expectedSelect);
    expect(await write.toSQL()).toEqual(expectedInsert);
  });

  it("executes a cold CTE outer query with Drizzle-equivalent results", async () => {
    vi.doUnmock("./client.js");
    vi.stubEnv("DATABASE_URL", "pglite:memory");
    const { createGetDb } = await import("./create-get-db.js");
    const { closeDbExec } = await import("./client.js");
    try {
      const getDb = createGetDb({});
      const db = getDb();
      const cte = db.$with("recent").as(
        db
          .select({
            id: meetings.id,
            label: sql<string>`upper(${meetings.recordingId})`.as("label"),
          })
          .from(meetings),
      );
      const coldOuter = db.with(cte).select().from(cte).where(eq(cte.id, "1"));
      const coldUnion = db
        .select({ id: meetings.id })
        .from(meetings)
        .where(eq(meetings.id, "1"))
        .union(
          db
            .select({ id: meetings.id })
            .from(meetings)
            .where(eq(meetings.id, "2")),
        );
      const callback = vi.fn(() =>
        db
          .select({ id: meetings.id })
          .from(meetings)
          .where(eq(meetings.id, "2")),
      );
      const coldCallbackUnion = db
        .select({ id: meetings.id })
        .from(meetings)
        .where(eq(meetings.id, "1"))
        .union(callback);
      expect(callback).not.toHaveBeenCalled();
      const coldInvalid = db
        .select({ a: meetings.id, b: meetings.recordingId })
        .from(meetings)
        .union(({ union }) =>
          union(
            db
              .select({ a: meetings.id, b: meetings.recordingId })
              .from(meetings),
            db
              .select({ b: meetings.recordingId, a: meetings.id })
              .from(meetings),
          ),
        );
      await db.execute(sql`create table meetings (id text, recording_id text)`);
      await db.insert(meetings).values([
        { id: "1", recordingId: "abc" },
        { id: "2", recordingId: "xyz" },
      ]);
      const ready = getDb();
      expect(() =>
        ready
          .select({ a: meetings.id, b: meetings.recordingId })
          .from(meetings)
          .union(({ union }) =>
            union(
              ready
                .select({ a: meetings.id, b: meetings.recordingId })
                .from(meetings),
              ready
                .select({ b: meetings.recordingId, a: meetings.id })
                .from(meetings),
            ),
          ),
      ).toThrow(/selected fields are not the same/);
      await expect(Promise.resolve(coldInvalid)).rejects.toThrow(
        /selected fields are not the same/,
      );
      const expectedCte = ready.$with("recent").as(
        ready
          .select({
            id: meetings.id,
            label: sql<string>`upper(${meetings.recordingId})`.as("label"),
          })
          .from(meetings),
      );
      const expected = await ready
        .with(expectedCte)
        .select()
        .from(expectedCte)
        .where(eq(expectedCte.id, "1"));
      expect(await coldOuter).toEqual(expected);
      expect(expected).toEqual([{ id: "1", label: "ABC" }]);
      const expectedUnion = await ready
        .select({ id: meetings.id })
        .from(meetings)
        .where(eq(meetings.id, "1"))
        .union(
          ready
            .select({ id: meetings.id })
            .from(meetings)
            .where(eq(meetings.id, "2")),
        );
      const expectedIds = expectedUnion.map((row) => row.id).sort();
      expect((await coldUnion).map((row) => row.id).sort()).toEqual(
        expectedIds,
      );
      expect((await coldCallbackUnion).map((row) => row.id).sort()).toEqual(
        expectedIds,
      );
      expect(callback).toHaveBeenCalledTimes(1);
      expect(expectedIds).toEqual(["1", "2"]);
    } finally {
      await closeDbExec();
      vi.unstubAllEnvs();
    }
  });

  it("still fails loudly for chains that cannot be built offline", async () => {
    const getDb = await getLazyDbFactory();
    const db = getDb();
    const insertChain = db.insert(meetings).values({ id: "1" });

    for (const prop of [
      "getSQL",
      "getSelectedFields",
      "shouldOmitSQLParens",
    ] as const) {
      expect(() => insertChain[prop]).toThrow(/unresolved|await/i);
    }
    expect(() => db.$with("inserted").as(insertChain)).toThrow(
      /unresolved|await/i,
    );
    expect(() => db.$with("inserted").as(insertChain)).toThrow(
      /await (?:the )?database handle/i,
    );
  });
});

describe("createGetDb — initialization reset races", () => {
  afterEach(async () => {
    const { closeDbExec } = await import("./client.js");
    await closeDbExec();
    vi.doUnmock("./client.js");
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    return { promise, resolve, reject };
  }

  async function setupPendingPgliteInitializations() {
    vi.resetModules();
    vi.unstubAllEnvs();
    const pending = [deferred<any>(), deferred<any>()];
    let nextInitialization = 0;
    const loadPgliteDrizzle = vi.fn(
      () => pending[nextInitialization++].promise,
    );
    const getPgliteClient = vi.fn(async () => ({}));
    vi.doMock("./client.js", async (importOriginal) => {
      const actual = await importOriginal<typeof import("./client.js")>();
      return {
        ...actual,
        assertHostedRuntimeDatabase: vi.fn(),
        getRuntimeDatabaseUrl: vi.fn(() => "pglite:./data/pglite"),
        isPgliteUrl: vi.fn(() => true),
        loadPgliteDrizzle,
        getPgliteClient,
        pgliteDrizzleClient: vi.fn((_url: string, client: unknown) => client),
      };
    });
    vi.stubEnv("DATABASE_URL", "pglite:./data/pglite");

    const { createGetDb } = await import("./create-get-db.js");
    const client = await import("./client.js");
    return { createGetDb, client, getPgliteClient, loadPgliteDrizzle, pending };
  }

  it("ignores a PGlite initialization that resolves after close and resume", async () => {
    const { createGetDb, client, getPgliteClient, loadPgliteDrizzle, pending } =
      await setupPendingPgliteInitializations();
    const getDb = createGetDb({});
    const staleInitialization = expect(getDb()).rejects.toThrow(/invalidated/i);
    await Promise.resolve();
    expect(loadPgliteDrizzle).toHaveBeenCalledTimes(1);

    client.beginPgliteClientShutdown();
    await client.closeDbExec();
    client.resumePgliteClientAccess();

    const resumedDb = getDb();
    await Promise.resolve();
    expect(loadPgliteDrizzle).toHaveBeenCalledTimes(2);

    const resumedDrizzle = vi.fn(({ client: pgliteClient }) => ({
      name: "resumed",
      client: pgliteClient,
    }));
    pending[1].resolve({ drizzle: resumedDrizzle });
    const currentDb = await resumedDb;

    pending[0].resolve({
      drizzle: vi.fn(({ client: pgliteClient }) => ({
        name: "stale",
        client: pgliteClient,
      })),
    });
    await staleInitialization;

    expect(getPgliteClient).toHaveBeenCalledTimes(1);
    expect(currentDb.name).toBe("resumed");
    expect(await getDb()).toBe(currentDb);
  });

  it("does not let a stale rejection clear a resumed initialization", async () => {
    const { createGetDb, client, getPgliteClient, loadPgliteDrizzle, pending } =
      await setupPendingPgliteInitializations();
    const getDb = createGetDb({});
    const staleError = new Error("stale PGlite initialization failed");
    const staleResult = Promise.resolve(getDb()).then(
      (value) => ({ value }),
      (error) => ({ error }),
    );
    await Promise.resolve();
    expect(loadPgliteDrizzle).toHaveBeenCalledTimes(1);

    client.beginPgliteClientShutdown();
    await client.closeDbExec();
    client.resumePgliteClientAccess();

    const resumedDb = getDb();
    await Promise.resolve();
    expect(loadPgliteDrizzle).toHaveBeenCalledTimes(2);

    pending[0].reject(staleError);
    await expect(staleResult).resolves.toEqual({ error: staleError });
    expect(getPgliteClient).not.toHaveBeenCalled();

    const resumedDrizzle = vi.fn(({ client: pgliteClient }) => ({
      name: "resumed",
      client: pgliteClient,
    }));
    pending[1].resolve({ drizzle: resumedDrizzle });
    const currentDb = await resumedDb;

    expect(loadPgliteDrizzle).toHaveBeenCalledTimes(2);
    expect(getPgliteClient).toHaveBeenCalledTimes(1);
    expect(currentDb.name).toBe("resumed");
    expect(await getDb()).toBe(currentDb);
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
