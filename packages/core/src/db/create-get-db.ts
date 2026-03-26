import { drizzle as drizzleLibsql } from "drizzle-orm/libsql";
import { drizzle as drizzleD1 } from "drizzle-orm/d1";
import type { LibSQLDatabase } from "drizzle-orm/libsql";

export function createGetDb<T extends Record<string, unknown>>(schema: T) {
  let _db: LibSQLDatabase<T> | undefined;
  return function getDb(): LibSQLDatabase<T> {
    if (!_db) {
      // Check for Cloudflare D1 binding
      const d1 = (globalThis as any).__cf_env?.DB;
      if (d1) {
        // D1 and LibSQL share compatible query interfaces via Drizzle
        _db = drizzleD1(d1, { schema }) as unknown as LibSQLDatabase<T>;
        return _db;
      }

      // Fall back to libsql (local dev, Turso)
      const url = process.env.DATABASE_URL || "file:./data/app.db";
      _db = drizzleLibsql({
        connection: {
          url,
          authToken: process.env.DATABASE_AUTH_TOKEN,
        },
        schema,
      });
    }
    return _db;
  };
}
