import { defineAction } from "@agent-native/core";

export default defineAction({
  description: "Check database connection status",
  parameters: {},
  http: false,
  run: async () => {
    const url = process.env.DATABASE_URL || "file:./data/app.db";
    const isLocal = url.startsWith("file:");

    try {
      const { createClient } = await import("@libsql/client");
      const client = createClient({
        url,
        authToken: process.env.DATABASE_AUTH_TOKEN,
      });

      await client.execute("SELECT 1");

      const result = await client.execute(
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
