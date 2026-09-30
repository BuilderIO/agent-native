import { sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import {
  annotateMissingTable,
  dbExecQueryBudget,
  getActivePgliteTransactionClient,
  getRuntimeDatabaseUrl,
  hasExplicitDbTimeout,
  isPgliteUrl,
  isConnectionError,
  getPgliteClient,
  loadPgliteDrizzle,
  pgliteDrizzleClient,
  pgPoolOptions,
  neonPoolOptions,
  guardNeonPool,
  withDbTimeout,
  retryOnConnectionError,
  dbOpTimeoutMs,
  sharedDbPool,
  toPostgresParams,
  withDbExec,
  onSharedDbPoolsClosed,
  onSharedDbPoolReplaced,
  postgresStatementTimeoutMs,
  assertHostedRuntimeDatabase,
} from "./client.js";
import type { DbExec, DbExecStatement } from "./client.js";

let _pgDrizzle: Promise<{ drizzle: any; postgres: any }> | undefined;
function getPgDrizzle() {
  if (!_pgDrizzle) {
    _pgDrizzle = Promise.all([
      import("drizzle-orm/postgres-js"),
      import("postgres"),
    ]).then(([drizzleMod, pgMod]) => ({
      drizzle: drizzleMod.drizzle,
      postgres: pgMod.default,
    }));
  }
  return _pgDrizzle;
}

let _neonServerlessDrizzle: Promise<{ drizzle: any; Pool: any }> | undefined;
function getNeonServerlessDrizzle() {
  if (!_neonServerlessDrizzle) {
    _neonServerlessDrizzle = Promise.all([
      import("drizzle-orm/neon-serverless"),
      import("@neondatabase/serverless"),
    ]).then(([drizzleMod, neonMod]) => ({
      drizzle: drizzleMod.drizzle,
      Pool: neonMod.Pool,
    }));
  }
  return _neonServerlessDrizzle;
}

function drizzleRawQuery(text: string, params: unknown[] = []) {
  const query = sql.raw(text);
  query.toQuery = () => ({ sql: text, params });
  return query;
}

async function withTransactionStatementTimeout<T>(
  transaction: any,
  run: () => T | Promise<T>,
): Promise<T> {
  const timeoutMs = dbOpTimeoutMs();
  const statementTimeoutMs = postgresStatementTimeoutMs(timeoutMs);
  const timeoutSql = `SELECT set_config('statement_timeout', CASE WHEN current_setting('statement_timeout')::interval <= interval '0' OR current_setting('statement_timeout')::interval > interval '${statementTimeoutMs}ms' THEN '${statementTimeoutMs}ms' ELSE current_setting('statement_timeout') END, true)`;
  await withDbTimeout(
    "query",
    () => transaction.execute(drizzleRawQuery(timeoutSql)),
    timeoutMs,
    undefined,
    { sql: timeoutSql },
  );
  return await run();
}

function drizzleTransactionExec(transaction: any): DbExec {
  const exec: DbExec = {
    async execute(statement: DbExecStatement) {
      const query =
        typeof statement === "string"
          ? { sql: statement, args: [] }
          : statement;
      const postgresSql = toPostgresParams(query.sql);
      const args = (query.args ?? []).map((arg) => arg ?? null);
      const prepared = drizzleRawQuery(postgresSql, args);

      const { timeoutMs } = dbExecQueryBudget(statement);
      const startedAt = Date.now();
      const remainingMs = () =>
        Math.max(1, timeoutMs - (Date.now() - startedAt));
      let timedOut = false;
      let inFlight: Promise<unknown> | undefined;
      let result: any;
      try {
        result = await withDbTimeout(
          "query",
          async () => {
            inFlight = (async () => {
              if (!hasExplicitDbTimeout(statement)) {
                return transaction.execute(prepared);
              }

              const currentTimeout = await transaction.execute(
                drizzleRawQuery(
                  "SELECT current_setting('statement_timeout') AS statement_timeout",
                ),
              );
              const currentRows = Array.isArray(currentTimeout)
                ? currentTimeout
                : currentTimeout?.rows;
              const previousTimeout = currentRows?.[0]?.statement_timeout;
              if (typeof previousTimeout !== "string") {
                throw new Error("Could not read the active statement timeout");
              }
              if (timedOut) return undefined;

              await transaction.execute(
                drizzleRawQuery(
                  `SET LOCAL statement_timeout = ${postgresStatementTimeoutMs(remainingMs())}`,
                ),
              );
              const restoreTimeout = () =>
                transaction.execute(
                  drizzleRawQuery(
                    "SELECT set_config('statement_timeout', $1, true)",
                    [previousTimeout],
                  ),
                );
              if (timedOut) {
                // Keep the transaction open until this reset finishes or rollback releases the local setting.
                await restoreTimeout().catch(() => {});
                return undefined;
              }

              let queryResult: any;
              let queryError: unknown;
              let queryFailed = false;
              try {
                queryResult = await transaction.execute(prepared);
              } catch (err) {
                queryFailed = true;
                queryError = err;
              }
              try {
                await restoreTimeout();
              } catch (err) {
                if (!queryFailed) throw err;
              }
              if (queryFailed) throw queryError;
              return queryResult;
            })();
            return inFlight;
          },
          timeoutMs,
          () => {
            timedOut = true;
          },
          { sql: query.sql },
        );
      } catch (err) {
        // Drizzle rolls back as soon as this callback rejects. Drain any timed-out
        // statement and its timeout reset first so it cannot use the released client.
        if (timedOut && hasExplicitDbTimeout(statement) && inFlight) {
          await inFlight.catch(() => {});
        }
        throw annotateMissingTable(err, statement);
      }

      const rows = Array.isArray(result) ? result : result?.rows;
      if (!Array.isArray(rows)) {
        throw new Error("Drizzle transaction query returned no row array");
      }
      return {
        rows,
        rowsAffected:
          result.rowCount ?? result.count ?? result.affectedRows ?? rows.length,
      };
    },
  };

  exec.atomicBatch = async (statements) => {
    const results = [];
    for (const statement of statements)
      results.push(await exec.execute(statement));
    return results;
  };

  if (typeof transaction.transaction === "function") {
    exec.transaction = (run) =>
      transaction.transaction((nested: any) => {
        const nestedExec = drizzleTransactionExec(nested);
        return withTransactionStatementTimeout(nested, () =>
          withDbExec(nestedExec, () => run(nestedExec)),
        );
      });
  }

  return exec;
}

function scopeDbExecToDrizzleTransactions<T extends object>(db: T): T {
  return new Proxy(db, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target);
      if (prop === "transaction" && typeof value === "function") {
        return (run: unknown, ...args: unknown[]) => {
          if (typeof run !== "function") {
            return value.apply(target, [run, ...args]);
          }
          return value.apply(target, [
            (transaction: any) =>
              withTransactionStatementTimeout(transaction, () =>
                withDbExec(drizzleTransactionExec(transaction), () =>
                  (run as (transaction: any) => unknown)(
                    scopeDbExecToDrizzleTransactions(transaction),
                  ),
                ),
              ),
            ...args,
          ]);
        };
      }
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/**
 * Returns true when a SQL string starts with a SELECT-class verb.
 * Used by the Neon resilience wrapper to decide retry safety:
 *   - reads (SELECT) → retryable on any connection-class error
 *   - writes (INSERT/UPDATE/DELETE/…) → only retryable on errors that
 *     provably occurred BEFORE the statement was sent (e.g. an acquire /
 *     connect timeout). Post-send write failures must propagate to the caller
 *     to avoid double-execution.
 */
export function isSqlRead(sql: string): boolean {
  return /^\s*(SELECT|WITH\s)/i.test(sql);
}

const NEON_IDLE_IN_TRANSACTION_TIMEOUT_SQL =
  "SET LOCAL idle_in_transaction_session_timeout = 30000";

function queryText(sql: unknown): string {
  if (typeof sql === "string") return sql;
  if (sql && typeof sql === "object" && "text" in sql) {
    const text = (sql as { text?: unknown }).text;
    return typeof text === "string" ? text : "";
  }
  return "";
}

function isBeginQuery(sql: unknown): boolean {
  return /^\s*BEGIN(?:\s|$)/i.test(queryText(sql));
}

function guardNeonTransactionClient<
  T extends { query: (...args: any[]) => any },
>(client: T): T {
  return new Proxy(client, {
    get(target, prop) {
      if (prop !== "query") {
        const value = (target as any)[prop];
        return typeof value === "function" ? value.bind(target) : value;
      }

      return (...args: any[]) => {
        const sql = args[0];
        if (!isBeginQuery(sql)) return target.query(...args);

        const text = queryText(sql).replace(/;\s*$/, "");
        return target.query(`${text}; ${NEON_IDLE_IN_TRANSACTION_TIMEOUT_SQL}`);
      };
    },
  });
}

export function buildResilientNeonPool<
  T extends {
    connect(): Promise<any>;
    query(...args: any[]): Promise<any>;
    end(): Promise<void>;
    on(event: string, listener: (...args: any[]) => void): unknown;
  },
>(pool: T): T {
  const resilientQuery = async (
    sql: string | { text?: unknown },
    args?: any[],
  ): Promise<{ rows: unknown[]; rowCount?: number }> => {
    const sqlText =
      typeof sql === "string"
        ? sql
        : typeof sql?.text === "string"
          ? sql.text
          : "";
    const isRead = isSqlRead(sqlText);

    const runAttempt = async (): Promise<{
      rows: unknown[];
      rowCount?: number;
    }> => {
      let acquireTimedOut = false;
      const client = await withDbTimeout(
        "connect",
        () =>
          pool.connect().then((c: any) => {
            if (acquireTimedOut) c.release();
            return c;
          }),
        dbOpTimeoutMs(),
        () => {
          acquireTimedOut = true;
        },
      );

      let released = false;
      const releaseClient = (err?: Error | boolean) => {
        if (released) return;
        released = true;
        client.release(err);
      };

      try {
        const result = await withDbTimeout(
          "query",
          () =>
            (args === undefined
              ? client.query(sql)
              : client.query(sql, args)) as Promise<{
              rows: unknown[];
              rowCount?: number;
            }>,
          dbOpTimeoutMs(),
          () => releaseClient(true),
          { sql: sqlText },
        );
        releaseClient();
        return result;
      } catch (err) {
        releaseClient(isConnectionError(err) ? true : undefined);
        throw err;
      }
    };

    if (isRead) {
      return retryOnConnectionError(runAttempt);
    }

    try {
      return await runAttempt();
    } catch (err) {
      if (isConnectionError(err) && (err as any)?.code === "CONNECT_TIMEOUT") {
        return runAttempt();
      }
      throw err;
    }
  };

  return new Proxy(pool, {
    get(target, prop) {
      if (prop === "query") return resilientQuery;
      if (prop === "connect") {
        return (...args: any[]) =>
          retryOnConnectionError(async () => {
            let acquireTimedOut = false;
            const client = await withDbTimeout<any>(
              "connect",
              () =>
                (target as any).connect(...args).then((client: any) => {
                  if (acquireTimedOut) client.release();
                  return client;
                }),
              dbOpTimeoutMs(),
              () => {
                acquireTimedOut = true;
              },
            );
            return guardNeonTransactionClient(client);
          });
      }
      const val = (target as any)[prop];
      return typeof val === "function" ? val.bind(target) : val;
    },
  }) as T;
}

export function buildResilientPostgresJsClient<
  T extends {
    unsafe(query: string, params?: any[], options?: any): any;
  },
>(client: T): T {
  const wrapUnsafe = (query: string, params?: any[], options?: any) => {
    const isRead = isSqlRead(query);

    const runAttempt = (mode: "rows" | "values") => async (): Promise<any> => {
      const pending = client.unsafe(query, params, options);
      return withDbTimeout(
        "query",
        async () => (mode === "values" ? pending.values() : pending),
        dbOpTimeoutMs(),
        () => {
          try {
            pending.cancel?.();
          } catch {
            // ignore — cancellation is advisory
          }
        },
        { sql: query },
      );
    };

    const execute = async (mode: "rows" | "values"): Promise<any> => {
      if (isRead) return retryOnConnectionError(runAttempt(mode));
      try {
        return await runAttempt(mode)();
      } catch (err) {
        if (
          isConnectionError(err) &&
          (err as any)?.code === "CONNECT_TIMEOUT"
        ) {
          return runAttempt(mode)();
        }
        throw err;
      }
    };

    return {
      then: (onFulfilled?: any, onRejected?: any) =>
        execute("rows").then(onFulfilled, onRejected),
      catch: (onRejected?: any) => execute("rows").catch(onRejected),
      finally: (onFinally?: any) => execute("rows").finally(onFinally),
      values: () => execute("values"),
    };
  };

  return new Proxy(client as any, {
    get(target, prop) {
      if (prop === "unsafe") return wrapUnsafe;
      const val = target[prop];
      return typeof val === "function" ? val.bind(target) : val;
    },
  }) as T;
}

export function isNeonUrl(url: string): boolean {
  return /\.neon\.tech([:/?]|$)/.test(url);
}

export function createGetDb<T extends Record<string, unknown>>(schema: T) {
  let _db: any;
  let _dbReady: Promise<any> | undefined;

  // The Drizzle instance is bound to a shared pool, so a `closeDbExec()` (test
  // teardown, script cleanup) must invalidate it rather than leave this store
  // issuing queries on a closed pool. Registered lazily from the pooled
  // branches only — `createGetDb` is called at module scope by every store, and
  // core's specs widely mock `db/client.js`.
  let _closeHookRegistered = false;
  function resetOnPoolClose(driver?: string, url?: string): void {
    if (_closeHookRegistered) return;
    _closeHookRegistered = true;
    onSharedDbPoolsClosed(() => {
      _db = undefined;
      _dbReady = undefined;
    });
    if (driver && url) {
      onSharedDbPoolReplaced(driver, url, () => {
        _db = undefined;
        _dbReady = undefined;
      });
    }
  }

  function startInit(): Promise<any> {
    if (_dbReady) return _dbReady;

    try {
      assertHostedRuntimeDatabase();
    } catch (err) {
      _dbReady = Promise.reject(err);
      _dbReady.catch(() => {});
      return _dbReady;
    }

    const url = getRuntimeDatabaseUrl("pglite:./data/pglite");

    if (isPgliteUrl(url)) {
      _dbReady = loadPgliteDrizzle().then(async ({ drizzle }) => {
        const client = await getPgliteClient(url);
        _db = drizzle({ client: pgliteDrizzleClient(url, client), schema });
        return _db;
      });
      return _dbReady;
    }

    if (isNeonUrl(url)) {
      _dbReady = getNeonServerlessDrizzle().then(({ drizzle, Pool }) => {
        resetOnPoolClose("neon", url);
        const rawPool = sharedDbPool(
          "neon",
          url,
          () => new Pool({ connectionString: url, ...neonPoolOptions() }),
        );
        guardNeonPool(rawPool, url);
        const pool = buildResilientNeonPool(rawPool);
        _db = scopeDbExecToDrizzleTransactions(drizzle(pool, { schema }));
        return _db;
      });
    } else {
      _dbReady = getPgDrizzle().then(({ drizzle, postgres }) => {
        resetOnPoolClose("postgres-js", url);
        const client = sharedDbPool("postgres-js", url, () =>
          postgres(url, pgPoolOptions(url)),
        );
        _db = scopeDbExecToDrizzleTransactions(
          drizzle(buildResilientPostgresJsClient(client), { schema }),
        );
        return _db;
      });
    }
    return _dbReady;
  }

  function createLazyProxy(
    ready: Promise<any>,
    chain: Array<{ prop: string | symbol; args?: any[] }>,
  ): any {
    return new Proxy(function () {} as any, {
      get(_target, prop) {
        if (prop === "then" || prop === "catch" || prop === "finally") {
          const promise = ready.then((readyDb) => {
            let result: any = readyDb;
            for (const step of chain) {
              const val = result[step.prop];
              result =
                typeof val === "function" ? val.apply(result, step.args) : val;
            }
            return result;
          });
          promise.catch(() => {});
          return (promise as any)[prop].bind(promise);
        }
        if (prop === "getSQL" || prop === "shouldOmitSQLParens") {
          throw new Error(
            "getDb(): accessed an unresolved query chain synchronously " +
              `(reading '${String(prop)}'). This chain was embedded as a raw ` +
              "value instead of being awaited first — e.g. a subquery passed " +
              "straight into another expression. Await the chain before " +
              "using its result.",
          );
        }
        return createLazyProxy(ready, [...chain, { prop }]);
      },
      apply(_target, _thisArg, args) {
        if (chain.length === 0) return createLazyProxy(ready, []);
        const last = chain[chain.length - 1];
        const newChain = chain.slice(0, -1);
        newChain.push({ prop: last.prop, args });
        return createLazyProxy(ready, newChain);
      },
    });
  }

  function getDb(): PgDatabase<PgQueryResultHKT, T> {
    const url = getRuntimeDatabaseUrl("pglite:./data/pglite");
    const activePgliteClient = isPgliteUrl(url)
      ? getActivePgliteTransactionClient(url)
      : undefined;
    if (activePgliteClient) {
      const transactionDb = loadPgliteDrizzle().then(({ drizzle }) =>
        drizzle({ client: activePgliteClient, schema }),
      );
      return createLazyProxy(transactionDb, []) as PgDatabase<
        PgQueryResultHKT,
        T
      >;
    }
    if (_db) return _db;
    void startInit();
    if (_db) return _db;

    return createLazyProxy(_dbReady!, []) as PgDatabase<PgQueryResultHKT, T>;
  }

  return getDb;
}
