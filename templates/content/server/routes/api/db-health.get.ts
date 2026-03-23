import { defineEventHandler } from "h3";
import { sql } from "drizzle-orm";
import { getDb } from "../../db/index.js";

export default defineEventHandler(async () => {
  const db = getDb();
  try {
    await db.run(sql`SELECT 1`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown" };
  }
});
