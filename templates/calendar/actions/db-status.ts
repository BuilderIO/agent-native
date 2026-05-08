import { defineAction } from "@agent-native/core";
import { getDbExec } from "@agent-native/core/db";
import { z } from "zod";

export default defineAction({
  description: "Check database connection status",
  schema: z.object({}),
  http: false,
  run: async () => {
    const url = process.env.DATABASE_URL || "file:./data/app.db";
    const isLocal = url.startsWith("file:");

    try {
      const db = getDbExec();

      await db.execute("SELECT 1");

      const result = await db.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '__%' ORDER BY name",
      );
      const tables = result.rows.map((r) => r.name as string);

      return {
        status: "connected",
        mode: isLocal ? "local" : "remote",
        url: isLocal ? url : url.replace(/\/\/.*@/, "//***@"),
        tables,
      };
    } catch (err: any) {
      return {
        status: "disconnected",
        mode: isLocal ? "local" : "remote",
        error: err.message,
      };
    }
  },
});
