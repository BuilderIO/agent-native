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

    // Check for Cloudflare D1 binding (synchronous — no dynamic import needed)
    const d1 = (globalThis as any).__cf_env?.DB;
    if (d1) {
      _db = drizzleD1(d1, { schema }) as unknown as LibSQLDatabase<T>;
      _dbReady = Promise.resolve(_db);
      return _dbReady;
    }

    const url = process.env.DATABASE_URL || "file:./data/app.db";
    const dialect = getDialect();

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
   * Get the Drizzle DB instance. Kicks off lazy init on first call.
   * If the async init hasn't completed yet, returns a Proxy that
   * transparently awaits initialization before forwarding operations.
   * This eliminates the startup race where requests arrive before
   * the dynamic import of the DB driver finishes.
   */
  function getDb(): LibSQLDatabase<T> {
    if (_db) return _db;
    startInit();
    if (_db) return _db;

    // Return a proxy that awaits _dbReady before forwarding.
    // Every Drizzle operation (select, insert, etc.) returns a thenable,
    // so callers already `await` the result — the extra await is transparent.
    return new Proxy({} as LibSQLDatabase<T>, {
      get(_target, prop) {
        return (...args: any[]) => {
          return _dbReady!.then(() => {
            const val = (_db as any)[prop];
            return typeof val === "function" ? val.apply(_db, args) : val;
          });
        };
      },
    });
  }

  return getDb;
}
