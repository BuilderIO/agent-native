import { defineAction } from "@agent-native/core";
import { sql } from "drizzle-orm";
import { getDb } from "../server/db/index.js";

export default defineAction({
  description: "Check database health and connectivity",
  parameters: {},
  http: { method: "GET" },
  run: async () => {
    const isLocal = (
      process.env.DATABASE_URL || "file:./data/app.db"
    ).startsWith("file:");
    try {
      const db = getDb();
      await db.run(sql`SELECT 1`);
      return { ok: true, local: isLocal };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : "Unknown",
      };
    }
  },
});
