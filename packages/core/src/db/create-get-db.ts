import { AsyncLocalStorage } from "node:async_hooks";

import { drizzle as drizzleD1 } from "drizzle-orm/d1";
import type { LibSQLDatabase } from "drizzle-orm/libsql";

import {
  getDialect,
  getCloudflareD1Binding,
  getDatabaseUrl,
  getDatabaseAuthToken,
  isLocalSqliteUrl,
  isPgliteUrl,
  isConnectionError,
  getPgliteClient,
  loadPgliteDrizzle,
  prepareLocalSqliteUrl,
  sqliteFilenameFromUrl,
  pgPoolOptions,
  neonPoolMax,
  attachNeonPoolErrorLogger,
  withDbTimeout,
  retryOnConnectionError,
  dbOpTimeoutMs,
} from "./client.js";

// Lazy driver loaders — cached promises so dynamic import only runs once.
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

/**
 * Wraps a @neondatabase/serverless Pool so every query goes through
 * the same withDbTimeout + retryOnConnectionError resilience that the
 * raw DbExec path in client.ts uses. This protects Drizzle queries
 * (which bypass DbExec) from the frozen-WebSocket failure mode documented
 * in client.ts (~lines 378–408).
 *
 * Retry-safety rule (prevents double-execution on writes):
 *   - Reads (SELECT / WITH …): retry freely on any connection-class error.
 *   - Writes: only retry when the error occurred during connection acquire
 *     (i.e. withDbTimeout "connect" timed out before the statement was ever
 *     sent). Post-send failures on writes are rethrown immediately.
 *
 * Transactions: we do NOT wrap individual queries inside a drizzle
 * transaction — drizzle-neon-serverless manages the session itself, so
 * interposing a per-query client acquire/release would break the sticky
 * connection the transaction needs. The pool-level error logger still fires
 * on idle-client drops inside transactions.
 */
export function buildResilientNeonPool(pool: {
  connect(): Promise<any>;
  query(
    sql: string,
    args?: any[],
  ): Promise<{ rows: unknown[]; rowCount?: number }>;
  end(): Promise<void>;
  on(event: string, listener: (...args: any[]) => void): unknown;
}): typeof pool {
  // Preserve all original pool methods and properties; only override `connect`
  // and `query` at the Pool level (used by drizzle's neon-serverless adapter
  // when it calls pool.query() directly, e.g. outside a transaction).
  const resilientQuery = async (
    sql: string,
    args?: any[],
  ): Promise<{ rows: unknown[]; rowCount?: number }> => {
    const isRead = isSqlRead(sql);

    const runAttempt = async (): Promise<{
      rows: unknown[];
      rowCount?: number;
    }> => {
      // Bound the pool.connect() acquire — a frozen Neon WebSocket stalls here
      // before the query ever starts, so a query-level timeout alone won't help.
      let acquireTimedOut = false;
      const client = await withDbTimeout(
        "connect",
        () =>
          pool.connect().then((c: any) => {
            // If we already gave up on this slot, immediately release it so
            // the scarce pool connection isn't leaked.
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
            client.query(sql, args ?? []) as Promise<{
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
      // Reads: retry on any connection-class error (safe — no side effects).
      return retryOnConnectionError(runAttempt);
    }

    // Writes: attempt once. If the acquire itself times out (error occurs
    // before the statement was sent), that produces a CONNECT_TIMEOUT which
    // isConnectionError() recognises → retry is safe. Any error that surfaces
    // AFTER the statement was sent must propagate immediately to avoid
    // double-execution.
    try {
      return await runAttempt();
    } catch (err) {
      // acquire-timeout fires before the statement → safe to retry once.
      if (isConnectionError(err) && (err as any)?.code === "CONNECT_TIMEOUT") {
        return runAttempt();
      }
      throw err;
    }
  };

  // Return a proxy so every pool property/method is forwarded as-is, but
  // pool.query() goes through the resilient wrapper. drizzle-neon-serverless
  // calls pool.connect() for transactions and pool.query() for simple queries.
  return new Proxy(pool, {
    get(target, prop) {
      if (prop === "query") return resilientQuery;
      const val = (target as any)[prop];
      return typeof val === "function" ? val.bind(target) : val;
    },
  });
}

/**
 * Wraps a postgres.js client so Drizzle queries on the non-Neon Postgres
 * path get the same withDbTimeout + retryOnConnectionError protection as
 * every other Postgres path (raw DbExec postgres.js, raw DbExec Neon, and
 * the Drizzle Neon pool above). Without this, one hung query on a BYO
 * Postgres deployment stalls its request forever.
 *
 * Drizzle's postgres-js session only calls `client.unsafe(query, params)` —
 * awaited directly for row-object results or via `.values()` for row-array
 * results — plus `client.begin(...)` for transactions. We interpose on
 * `unsafe` with a lazy thenable that re-issues the query per retry attempt,
 * and leave transactions unwrapped (same rule as the Neon wrapper: the
 * driver manages the sticky connection inside `begin`).
 *
 * Retry-safety mirrors buildResilientNeonPool: reads retry freely on
 * connection-class errors; writes retry only on CONNECT_TIMEOUT (postgres.js
 * raises it before the statement is ever sent), so writes can't
 * double-execute.
 */
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
          // Best-effort cancel so the timed-out statement doesn't keep
          // occupying one of the (small, serverless-capped) pool slots.
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
        // Connect timeout fires before the statement is sent → one retry is
        // safe even for writes.
        if (
          isConnectionError(err) &&
          (err as any)?.code === "CONNECT_TIMEOUT"
        ) {
          return runAttempt(mode)();
        }
        throw err;
      }
    };

    // Lazy thenable mirroring the slice of postgres.js's PendingQuery
    // surface that Drizzle uses: `await q` or `await q.values()`.
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

/**
 * Neon's pooler endpoints cold-start in 5–10s. Serverless environments
 * (Netlify Functions, Vercel Edge, CF Workers) have short cold-start
 * budgets of their own, and `postgres-js` opens a raw TCP connection on
 * port 5432 that can't negotiate around Neon's wake-up window — every
 * request after an idle period 502s. `@neondatabase/serverless` rides
 * over WebSockets (HTTP/443 upgrade) and handles Neon wake-up
 * transparently, supports transactions, and works in every serverless
 * runtime we deploy to, so we prefer it whenever the URL points at Neon.
 */
export function isNeonUrl(url: string): boolean {
  // Must match neon.tech followed by port/path/query/end — include `?` so
  // URLs like `postgres://…@ep.neon.tech?sslmode=require` (no explicit port
  // or path) still route through the serverless driver.
  return /\.neon\.tech([:/?]|$)/.test(url);
}

let _libsqlWebDrizzle: Promise<{ drizzle: any }> | undefined;
function getLibsqlWebDrizzle() {
  if (!_libsqlWebDrizzle) {
    _libsqlWebDrizzle = import("drizzle-orm/libsql/web").then((mod) => ({
      drizzle: mod.drizzle,
    }));
  }
  return _libsqlWebDrizzle;
}

let _betterSqliteDrizzle: Promise<{ drizzle: any; Database: any }> | undefined;
function getBetterSqliteDrizzle() {
  if (!_betterSqliteDrizzle) {
    _betterSqliteDrizzle = Promise.all([
      import("drizzle-orm/better-sqlite3"),
      import("better-sqlite3"),
    ]).then(([drizzleMod, sqliteMod]) => ({
      drizzle: drizzleMod.drizzle,
      Database: sqliteMod.default,
    }));
  }
  return _betterSqliteDrizzle;
}

/**
 * Patch a drizzle-orm/better-sqlite3 instance so that db.transaction(async …)
 * works. The native better-sqlite3 Transaction wrapper is sync-only — passing
 * an async callback throws "Transaction function cannot return a promise".
 *
 * This wrapper bypasses the native path by issuing raw SQL control statements
 * on the single better-sqlite3 connection, which is safe because:
 *   - better-sqlite3 is single-connection (no concurrency inside one process)
 *   - the framework serialises all async work through one Database instance
 *
 * Nesting: if a transaction is already open (sqlite.inTransaction === true),
 * SAVEPOINT / RELEASE / ROLLBACK TO is used instead of BEGIN / COMMIT /
 * ROLLBACK, matching drizzle's own BetterSQLiteTransaction.transaction().
 *
 * The patched transaction also patches the tx object it passes to the callback
 * so that nested async calls (tx.transaction(async …)) work recursively.
 */
/** @internal exported for the async-tx concurrency spec */
export function patchBetterSqliteTransactions<
  DB extends { transaction: (...args: any[]) => any; session: any },
>(db: DB, sqlite: { inTransaction: boolean; exec: (sql: string) => void }): DB {
  let savepointSeq = 0;
  // Concurrent TOP-LEVEL async transactions on the single better-sqlite3
  // connection must not interleave: a second transaction starting while the
  // first is open would see `inTransaction` and open a savepoint INSIDE the
  // first transaction, which then commits out from under it ("no such
  // savepoint"). Serialize top-level transactions through a promise chain;
  // genuine same-task nesting (tx.transaction or db.transaction inside an
  // open callback) is detected via AsyncLocalStorage and keeps the direct
  // savepoint path so it cannot deadlock on the queue.
  const txContext = new AsyncLocalStorage<boolean>();
  let txChain: Promise<unknown> = Promise.resolve();

  function makeAsyncTransaction(
    originalTransaction: (...args: any[]) => any,
  ): (...args: any[]) => Promise<unknown> {
    async function runTransactionBody(
      cb: (tx: unknown) => unknown,
    ): Promise<unknown> {
      // Extract the drizzle tx proxy synchronously — call the original with a
      // stub that captures the tx arg then immediately throws a sentinel so
      // better-sqlite3's native wrapper rolls back the stub and re-throws.
      // The sentinel is caught here and never propagates further.
      let capturedTx: unknown;
      try {
        originalTransaction((tx: unknown) => {
          capturedTx = tx;
          throw _EXTRACT_TX;
        });
      } catch (e) {
        if (e !== _EXTRACT_TX) throw e;
      }

      // Recursively patch the nested tx so tx.transaction(async …) also works.
      const tx = capturedTx as { transaction: (...a: any[]) => any };
      if (tx && typeof tx.transaction === "function") {
        tx.transaction = makeAsyncTransaction(tx.transaction.bind(tx));
      }

      const nested = sqlite.inTransaction;
      if (nested) {
        const sp = `sp_async_${++savepointSeq}`;
        sqlite.exec(`SAVEPOINT ${sp}`);
        let released = false;
        try {
          const result = await cb(tx);
          sqlite.exec(`RELEASE SAVEPOINT ${sp}`);
          released = true;
          return result;
        } catch (err) {
          if (!released) {
            try {
              sqlite.exec(`ROLLBACK TO SAVEPOINT ${sp}`);
              sqlite.exec(`RELEASE SAVEPOINT ${sp}`);
            } catch {
              /* ignore: connection may already be in an error state */
            }
          }
          throw err;
        }
      }

      // Top-level: BEGIN IMMEDIATE … COMMIT / ROLLBACK.
      sqlite.exec("BEGIN IMMEDIATE");
      let committed = false;
      try {
        const result = await cb(tx);
        sqlite.exec("COMMIT");
        committed = true;
        return result;
      } catch (err) {
        if (!committed) {
          try {
            sqlite.exec("ROLLBACK");
          } catch {
            /* swallow: connection may already be unusable */
          }
        }
        throw err;
      }
    }

    return function asyncTransaction(
      cb: (tx: unknown) => unknown,
    ): Promise<unknown> {
      if (txContext.getStore()) {
        // Same-task nesting: run directly (savepoint path inside the open
        // transaction). Queueing here would deadlock behind the outer tx.
        return runTransactionBody(cb);
      }
      const run = () => txContext.run(true, () => runTransactionBody(cb));
      const next = txChain.then(run, run);
      txChain = next.then(
        () => undefined,
        () => undefined,
      );
      return next;
    };
  }

  db.transaction = makeAsyncTransaction(db.transaction.bind(db));
  return db;
}

/** Sentinel thrown inside the tx-extraction stub — never escapes the catch. */
const _EXTRACT_TX = Symbol("extract-tx");

export function createGetDb<T extends Record<string, unknown>>(schema: T) {
  let _db: any;
  let _dbReady: Promise<any> | undefined;

  function startInit(): Promise<any> {
    if (_dbReady) return _dbReady;

    const url = getDatabaseUrl("file:./data/app.db");
    const dialect = getDialect();

    // D1 only if dialect detected it (DATABASE_URL takes priority)
    if (dialect === "d1") {
      const d1 = getCloudflareD1Binding() as
        | Parameters<typeof drizzleD1>[0]
        | undefined;
      if (d1) {
        _db = drizzleD1(d1, { schema }) as unknown as LibSQLDatabase<T>;
        _dbReady = Promise.resolve(_db);
        return _dbReady;
      }
    }

    if (isPgliteUrl(url)) {
      _dbReady = loadPgliteDrizzle().then(async ({ drizzle }) => {
        const client = await getPgliteClient(url);
        _db = drizzle({ client, schema });
      });
      return _dbReady;
    }

    if (dialect === "postgres") {
      if (isNeonUrl(url)) {
        _dbReady = getNeonServerlessDrizzle().then(({ drizzle, Pool }) => {
          const rawPool = new Pool({
            connectionString: url,
            max: neonPoolMax(),
          });
          attachNeonPoolErrorLogger(rawPool);
          // Wrap the pool with the resilience layer so Drizzle queries get the
          // same withDbTimeout + retryOnConnectionError protection as the raw
          // DbExec path in client.ts. Reads retry freely; writes only retry on
          // acquire-timeout (pre-send) errors to avoid double-execution.
          const pool = buildResilientNeonPool(rawPool);
          _db = drizzle(pool, { schema });
        });
      } else {
        _dbReady = getPgDrizzle().then(({ drizzle, postgres }) => {
          // pgPoolOptions caps the pool to a small size on serverless so
          // concurrent frozen instances don't exhaust Neon/Postgres'
          // connection limit ("Max client connections reached").
          const client = postgres(url, pgPoolOptions(url));
          _db = drizzle(buildResilientPostgresJsClient(client), { schema });
        });
      }
    } else if (isLocalSqliteUrl(url)) {
      _dbReady = Promise.all([
        prepareLocalSqliteUrl(url.startsWith("file:") ? url : `file:${url}`),
        getBetterSqliteDrizzle(),
      ]).then(([sqliteUrl, { drizzle, Database }]) => {
        const sqlite = new Database(sqliteFilenameFromUrl(sqliteUrl));
        // Wait up to 10s for a concurrent writer instead of failing fast
        // with SQLITE_BUSY — mirrors the raw DbExec SQLite path in client.ts.
        sqlite.pragma("busy_timeout = 10000");
        sqlite.pragma("journal_mode = WAL");
        const db = drizzle(sqlite, { schema });
        _db = patchBetterSqliteTransactions(db, sqlite);
      });
    } else {
      _dbReady = getLibsqlWebDrizzle().then(({ drizzle }) => {
        _db = drizzle({
          connection: { url, authToken: getDatabaseAuthToken() },
          schema,
        });
      });
    }
    return _dbReady;
  }

  /**
   * Create a lazy proxy that records property accesses and method calls,
   * then replays them on the real DB once init completes. Supports
   * Drizzle's chained API: db.select().from(table).where(...).
   *
   * When `.then()` is called (i.e. the chain is awaited), the proxy
   * awaits _dbReady and replays the recorded chain on the real _db.
   */
  function createLazyProxy(
    ready: Promise<any>,
    chain: Array<{ prop: string | symbol; args?: any[] }>,
  ): any {
    return new Proxy(function () {} as any, {
      get(_target, prop) {
        // When awaited, replay the chain on the real db
        if (prop === "then" || prop === "catch" || prop === "finally") {
          const promise = ready.then(() => {
            let result: any = _db;
            for (const step of chain) {
              const val = result[step.prop];
              result =
                typeof val === "function" ? val.apply(result, step.args) : val;
            }
            return result;
          });
          return (promise as any)[prop].bind(promise);
        }
        // Symbol.toStringTag, Symbol.iterator, etc. — return another proxy
        // Property access (e.g. db.query) — record and return another proxy
        return createLazyProxy(ready, [...chain, { prop }]);
      },
      apply(_target, _thisArg, args) {
        // Method call (e.g. .from(table)) — record args and return another proxy
        if (chain.length === 0) return createLazyProxy(ready, []);
        const last = chain[chain.length - 1];
        const newChain = chain.slice(0, -1);
        newChain.push({ prop: last.prop, args });
        return createLazyProxy(ready, newChain);
      },
    });
  }

  /**
   * Get the Drizzle DB instance. Kicks off lazy init on first call.
   * If the async init hasn't completed yet, returns a lazy Proxy that
   * records the Drizzle chain (select/from/where/etc.) and replays it
   * once the DB driver finishes loading. Since callers always `await`
   * the final result, the proxy is transparent.
   */
  function getDb(): LibSQLDatabase<T> {
    if (_db) return _db;
    startInit();
    if (_db) return _db;

    return createLazyProxy(_dbReady!, []) as LibSQLDatabase<T>;
  }

  return getDb;
}
