import { getRuntimeDatabaseUrl } from "@agent-native/core/db";
import { sql } from "drizzle-orm";
import { defineEventHandler } from "h3";

import { getDb } from "../../db/index.js";

export default defineEventHandler(async () => {
  try {
    const db = getDb();
    await db.run(sql`SELECT 1`);
    const url = getRuntimeDatabaseUrl("file:./data/app.db");
    return { ok: true, local: url.startsWith("file:") };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown" };
  }
});
