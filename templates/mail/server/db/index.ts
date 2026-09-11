import { createGetDb } from "@agent-native/core/db";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import * as schema from "./schema.js";

type MailDatabase = PgDatabase<PgQueryResultHKT, typeof schema>;

export const getDb = createGetDb(schema) as () => MailDatabase;

// Backwards compat — many files import `db` directly
export const db = new Proxy({} as any, {
  get(_, prop) {
    return (getDb() as any)[prop];
  },
});
export { schema };
