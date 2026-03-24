import { drizzle } from "drizzle-orm/libsql";
import { createClient, type Client } from "@libsql/client";
import * as schema from "./schema.js";

let _client: Client | undefined;
let _db: ReturnType<typeof drizzle> | undefined;

function getClient(): Client {
  if (!_client) {
    const url = process.env.DATABASE_URL || "file:./data/app.db";
    _client = createClient({
      url,
      authToken: process.env.DATABASE_AUTH_TOKEN,
    });
  }
  return _client;
}

// Lazy-initialized database — only created on first access.
// This prevents errors during CF Workers module validation where
// env vars aren't available and file: URLs aren't supported.
export const db = new Proxy({} as ReturnType<typeof drizzle>, {
  get(_, prop) {
    if (!_db) {
      _db = drizzle(getClient(), { schema });
    }
    return (_db as any)[prop];
  },
});
export { schema };
