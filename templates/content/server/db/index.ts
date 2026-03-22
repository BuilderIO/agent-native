import { drizzle } from "drizzle-orm/libsql";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import * as schema from "./schema.js";

let _db: LibSQLDatabase<typeof schema> | undefined;

/**
 * Get a Drizzle database instance for cloud sync.
 * Returns null if DATABASE_URL is not set - content works file-only by default.
 */
export function getDb(): LibSQLDatabase<typeof schema> | null {
  if (!_db) {
    const url = process.env.DATABASE_URL;
    if (!url) return null; // Content works without DB - files are the default
    _db = drizzle({
      connection: {
        url,
        authToken: process.env.DATABASE_AUTH_TOKEN,
      },
      schema,
    });
  }
  return _db;
}

export { schema };
