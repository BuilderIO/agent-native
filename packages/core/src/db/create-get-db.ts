import { drizzle as drizzleD1 } from "drizzle-orm/d1";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { getDialect, getDatabaseUrl, getDatabaseAuthToken } from "./client.js";

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
 * Neon's pooler endpoints cold-start in 5–10s. Serverless environments
 * (Netlify Functions, Vercel Edge, CF Workers) have short cold-start
 * budgets of their own, and `postgres-js` opens a raw TCP connection on
 * port 5432 that can't negotiate around Neon's wake-up window — every
 * request after an idle period 502s. `@neondatabase/serverless` rides
 * over WebSockets (HTTP/443 upgrade) and handles Neon wake-up
 * transparently, supports transactions, and works in every serverless
 * runtime we deploy to, so we prefer it whenever the URL points at Neon.
 */
function isNeonUrl(url: string): boolean {
  // Must match neon.tech followed by port/path/query/end — include `?` so
  // URLs like `postgres://…@ep.neon.tech?sslmode=require` (no explicit port
  // or path) still route through the serverless driver.
  return /\.neon\.tech([:/?]|$)/.test(url);
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

    const url = getDatabaseUrl("file:./data/app.db");
    const dialect = getDialect();

    // D1 only if dialect detected it (DATABASE_URL takes priority)
    if (dialect === "d1") {
      const d1 = globalThis.__cf_env?.DB;
      if (d1) {
        _db = drizzleD1(d1, { schema }) as unknown as LibSQLDatabase<T>;
        _dbReady = Promise.resolve(_db);
        return _dbReady;
      }
    }

    if (dialect === "postgres") {
      if (isNeonUrl(url)) {
        _dbReady = getNeonServerlessDrizzle().then(({ drizzle, Pool }) => {
          const pool = new Pool({ connectionString: url });
          _db = drizzle(pool, { schema });
        });
      } else {
        _dbReady = getPgDrizzle().then(({ drizzle, postgres }) => {
          const client = postgres(url, {
            onnotice: () => {},
            idle_timeout: 240,
            max_lifetime: 60 * 30,
            connect_timeout: 10,
            ...(url.includes("supabase") ? { prepare: false } : {}),
          });
          _db = drizzle(client, { schema });
        });
      }
    } else {
      _dbReady = getLibsqlDrizzle().then(({ drizzle }) => {
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
