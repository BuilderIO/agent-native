import { sql } from "drizzle-orm";
import { defineEventHandler, setResponseStatus } from "h3";

import { getDb } from "../../db/index.js";

function isLocalDb(): boolean {
  const url = process.env.DATABASE_URL || "file:./data/app.db";
  return url.startsWith("file:");
}

export default defineEventHandler(async (event) => {
  try {
    const db = getDb();
    await db.run(sql`SELECT 1`);
    return { ok: true, local: isLocalDb() };
  } catch (error) {
    console.error("[tasks] Database health check failed", error);
    setResponseStatus(event, 503);
    return { ok: false, error: "Database health check failed" };
  }
});
