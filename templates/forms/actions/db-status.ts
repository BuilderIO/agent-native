import { defineAction } from "@agent-native/core/action";
import {
  getDatabaseAuthToken,
  getRuntimeDatabaseUrl,
} from "@agent-native/core/db";
import { createClient } from "@libsql/client";
import { z } from "zod";

export default defineAction({
  description: "Check database connection status.",
  schema: z.object({}),
  http: false,
  run: async () => {
    const url = getRuntimeDatabaseUrl("file:./data/app.db");
    const isLocal = url.startsWith("file:");

    try {
      const client = createClient({
        url,
        authToken: getDatabaseAuthToken(),
      });
      const result = await client.execute("SELECT 1 as ok");
      return {
        url: isLocal ? url : url.replace(/\/\/.*@/, "//***@"),
        mode: isLocal ? "local (SQLite file)" : "remote (cloud)",
        status: result.rows.length > 0 ? "connected" : "unexpected response",
      };
    } catch (err) {
      throw new Error(
        `Database error: ${err instanceof Error ? err.message : "Unknown"}`,
      );
    }
  },
});
