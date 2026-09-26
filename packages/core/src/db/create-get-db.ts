import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import {
  getActivePgliteTransactionClient,
  getRuntimeDatabaseUrl,
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
  onSharedDbPoolsClosed,
  onSharedDbPoolReplaced,
  assertHostedRuntimeDatabase,
} from "./client.js";

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

  // branches only — `createGetDb` is called at module scope by every store, and
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
        _db = drizzle(pool, { schema });
        return _db;
      });
    } else {
      _dbReady = getPgDrizzle().then(({ drizzle, postgres }) => {
        resetOnPoolClose("postgres-js", url);
        const client = sharedDbPool("postgres-js", url, () =>
          postgres(url, pgPoolOptions(url)),
        );
        _db = drizzle(buildResilientPostgresJsClient(client), { schema });
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
