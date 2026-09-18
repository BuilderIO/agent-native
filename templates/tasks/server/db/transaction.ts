import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import * as schema from "./schema.js";

export type DbHandle = Pick<
  PgDatabase<PgQueryResultHKT, typeof schema>,
  "select" | "insert" | "update" | "delete" | "transaction"
>;
