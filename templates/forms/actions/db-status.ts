import { defineAction } from "@agent-native/core/action";
import {
  getDbExec,
  getRuntimeDatabaseUrl,
  isLocalDatabase,
} from "@agent-native/core/db";
import { z } from "zod";

export default defineAction({
  description: "Check database connection status.",
  schema: z.object({}),
  http: false,
  run: async () => {
    const url = getRuntimeDatabaseUrl("pglite:./data/pglite");
    const isLocal = isLocalDatabase();

    try {
      const result = await getDbExec().execute("SELECT 1 as ok");
      return {
        url: isLocal ? url : url.replace(/\/\/.*@/, "//***@"),
        mode: isLocal ? "local (PGlite)" : "remote (cloud)",
        status: result.rows.length > 0 ? "connected" : "unexpected response",
      };
    } catch (err) {
      throw new Error(
        `Database error: ${err instanceof Error ? err.message : "Unknown"}`,
      );
    }
  },
});
