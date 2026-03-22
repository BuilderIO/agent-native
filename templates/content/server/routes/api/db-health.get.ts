import { defineEventHandler } from "h3";
import { sql } from "drizzle-orm";
import { getDb } from "../../db/index.js";

function isLocalDb(): boolean {
  const url = process.env.DATABASE_URL;
  if (!url) return true;
  return url.startsWith("file:");
}

export default defineEventHandler(async () => {
  const db = getDb();
  if (!db) {
    return { ok: false, local: true, error: "No DATABASE_URL configured" };
  }

  try {
    await db.run(sql`SELECT 1`);
    return { ok: true, local: isLocalDb() };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown" };
  }
});
