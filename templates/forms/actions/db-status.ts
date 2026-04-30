import { defineAction } from "@agent-native/core";
import { createClient } from "@libsql/client";
import { z } from "zod";

export default defineAction({
  description: "Check database connection status.",
  schema: z.object({}),
  http: false,
  run: async () => {
    const url = process.env.DATABASE_URL || "file:./data/app.db";
    const isLocal = url.startsWith("file:");

    try {
      const client = createClient({
        url,
        authToken: process.env.DATABASE_AUTH_TOKEN,
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
