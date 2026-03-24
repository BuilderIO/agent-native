import { drizzle as drizzleLibsql } from "drizzle-orm/libsql";
import { drizzle as drizzleD1 } from "drizzle-orm/d1";
import { createClient } from "@libsql/client";
import * as schema from "./schema.js";

let _db: any;

function initDb() {
  // Check for Cloudflare D1 binding (set by worker entry via globalThis.__cf_env)
  const d1 = (globalThis as any).__cf_env?.DB;
  if (d1) {
    return drizzleD1(d1, { schema });
  }

  // Fall back to libsql (local dev or non-CF deployments)
  const url = process.env.DATABASE_URL || "file:./data/app.db";
  const client = createClient({
    url,
    authToken: process.env.DATABASE_AUTH_TOKEN,
  });
  return drizzleLibsql(client, { schema });
}

// Lazy-initialized database — only created on first access.
// This prevents errors during CF Workers module validation where
// env vars aren't available and file: URLs aren't supported.
export const db = new Proxy({} as any, {
  get(_, prop) {
    if (!_db) {
      _db = initDb();
    }
    return _db[prop];
  },
});
export { schema };
