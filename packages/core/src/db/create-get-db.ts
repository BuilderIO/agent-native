import { drizzle as drizzleLibsql } from "drizzle-orm/libsql";
import { drizzle as drizzleD1 } from "drizzle-orm/d1";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { getDialect } from "./client.js";

// Postgres driver — loaded lazily to avoid import failures in edge runtimes.
// The promise is cached so the dynamic import only runs once.
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

export function createGetDb<T extends Record<string, unknown>>(schema: T) {
  let _db: any;
  let _dbReady: Promise<any> | undefined;

  return function getDb(): LibSQLDatabase<T> {
    if (_db) return _db;

    // Check for Cloudflare D1 binding
    const d1 = (globalThis as any).__cf_env?.DB;
    if (d1) {
      _db = drizzleD1(d1, { schema }) as unknown as LibSQLDatabase<T>;
      return _db;
    }

    const url = process.env.DATABASE_URL || "file:./data/app.db";

    // Postgres — return a proxy that waits for the dynamic import
    if (getDialect() === "postgres") {
      if (!_dbReady) {
        _dbReady = getPgDrizzle().then(({ drizzle, postgres }) => {
          _db = drizzle(postgres(url), { schema });
        });
      }
      // Throw a helpful error if called before init completes
      // In practice, Nitro plugins run before request handlers,
      // so ensureTable() calls in stores will trigger init first.
      if (!_db) {
        throw new Error(
          "Database not ready — call await getDb() or ensure stores are initialized first. " +
            "This happens because the Postgres driver loads asynchronously.",
        );
      }
      return _db as LibSQLDatabase<T>;
    }

    // Fall back to libsql (local SQLite, Turso)
    _db = drizzleLibsql({
      connection: {
        url,
        authToken: process.env.DATABASE_AUTH_TOKEN,
      },
      schema,
    });
    return _db;
  };
}
