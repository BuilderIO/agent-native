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

  return function getDb(): LibSQLDatabase<T> {
    if (_db) return _db;

    // Check for Cloudflare D1 binding (synchronous — no dynamic import needed)
    const d1 = (globalThis as any).__cf_env?.DB;
    if (d1) {
      _db = drizzleD1(d1, { schema }) as unknown as LibSQLDatabase<T>;
      return _db;
    }

    const url = process.env.DATABASE_URL || "file:./data/app.db";
    const dialect = getDialect();

    // Kick off async init (only once)
    if (!_dbReady) {
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
    }

    // If init already completed synchronously (cached promise), return db
    if (_db) return _db;

    // First call before init completes — throw helpful error.
    // In practice, store ensureTable() calls in Nitro plugins run
    // before request handlers, giving the async init time to complete.
    throw new Error(
      "Database not ready yet. This resolves automatically after the first async operation. " +
        "If you see this in a request handler, ensure server plugins initialize stores first.",
    );
  };
}
