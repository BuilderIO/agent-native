import { defineEventHandler } from "h3";
import { sql } from "drizzle-orm";
import { getDb } from "../../db";

function isLocalDb(): boolean {
  const url = process.env.DATABASE_URL || "file:./data/app.db";
  return url.startsWith("file:");
}

export default defineEventHandler(async () => {
  try {
    const db = getDb();
    await db.run(sql`SELECT 1`);
    return { ok: true, local: isLocalDb() };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown" };
  }
});
