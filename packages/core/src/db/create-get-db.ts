import { drizzle } from "drizzle-orm/libsql";
import type { LibSQLDatabase } from "drizzle-orm/libsql";

export function createGetDb<T extends Record<string, unknown>>(schema: T) {
  let _db: LibSQLDatabase<T> | undefined;
  return function getDb(): LibSQLDatabase<T> {
    if (!_db) {
      const url = process.env.DATABASE_URL || "file:./data/app.db";
      _db = drizzle({
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
