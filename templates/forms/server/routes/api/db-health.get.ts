import { defineEventHandler } from "h3";
import { sql } from "drizzle-orm";
import { getDb } from "../../db/index.js";

export default defineEventHandler(async () => {
  try {
    const db = getDb();
    await db.run(sql`SELECT 1`);
    const url = process.env.DATABASE_URL || "file:./data/app.db";
    return { ok: true, local: url.startsWith("file:") };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown" };
  }
});
