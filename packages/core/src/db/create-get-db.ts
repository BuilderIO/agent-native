import { drizzle as drizzleD1 } from "drizzle-orm/d1";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { getDialect } from "./client.js";

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

let _libsqlDrizzle: Promise<{ drizzle: any }> | undefined;
function getLibsqlDrizzle() {
  if (!_libsqlDrizzle) {
    _libsqlDrizzle = import("drizzle-orm/libsql").then((mod) => ({
      drizzle: mod.drizzle,
    }));
  }
  return _libsqlDrizzle;
}

export function createGetDb<T extends Record<string, unknown>>(schema: T) {
  let _db: any;
  let _dbReady: Promise<any> | undefined;

  function startInit(): Promise<any> {
    if (_dbReady) return _dbReady;

    const url = process.env.DATABASE_URL || "file:./data/app.db";
    const dialect = getDialect();

    // D1 only if dialect detected it (DATABASE_URL takes priority)
    if (dialect === "d1") {
      const d1 = (globalThis as any).__cf_env?.DB;
      if (d1) {
        _db = drizzleD1(d1, { schema }) as unknown as LibSQLDatabase<T>;
        _dbReady = Promise.resolve(_db);
        return _dbReady;
      }
    }

    if (dialect === "postgres") {
      _dbReady = getPgDrizzle().then(({ drizzle, postgres }) => {
        _db = drizzle(postgres(url), { schema });
      });
    } else {
      _dbReady = getLibsqlDrizzle().then(({ drizzle }) => {
        _db = drizzle({
          connection: { url, authToken: process.env.DATABASE_AUTH_TOKEN },
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
