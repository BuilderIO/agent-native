import { drizzle as drizzleLibsql } from "drizzle-orm/libsql";
import { drizzle as drizzleD1 } from "drizzle-orm/d1";

export function createGetDb<T extends Record<string, unknown>>(schema: T) {
  let _db: any;
  return function getDb() {
    if (!_db) {
      // Check for Cloudflare D1 binding
      const d1 = (globalThis as any).__cf_env?.DB;
      if (d1) {
        _db = drizzleD1(d1, { schema });
        return _db;
      }

      // Fall back to libsql (local dev, Turso, Neon, etc.)
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
