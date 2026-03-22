import { drizzle } from "drizzle-orm/libsql";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import * as schema from "./schema.js";

let _db: LibSQLDatabase<typeof schema> | undefined;

export function getDb() {
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
}

export { schema };
