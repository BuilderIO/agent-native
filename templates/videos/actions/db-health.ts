import { defineAction } from "@agent-native/core";
import { getDbExec } from "@agent-native/core/db";
import { z } from "zod";

export default defineAction({
  description: "Check database health and connectivity",
  schema: z.object({}),
  http: { method: "GET" },
  run: async () => {
    const isLocal = (
      process.env.DATABASE_URL || "file:./data/app.db"
    ).startsWith("file:");
    try {
      const exec = getDbExec();
      await exec.execute("SELECT 1");
      return { ok: true, local: isLocal };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : "Unknown",
      };
    }
  },
});
