import { defineAction } from "@agent-native/core";
import { getDbExec } from "@agent-native/core/db";

export default defineAction({
  description: "Check database health and connection status.",
  parameters: {},
  http: { method: "GET" },
  run: async () => {
    const isLocal = (): boolean => {
      const url = process.env.DATABASE_URL || "file:./data/app.db";
      return url.startsWith("file:");
    };

    try {
      const exec = getDbExec();
      await exec.execute("SELECT 1");
      return { ok: true, local: isLocal() };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : "Unknown",
      };
    }
  },
});
