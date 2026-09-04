import { defineAction } from "@agent-native/core/action";
import { getDbExec } from "@agent-native/core/db";
import { z } from "zod";

export default defineAction({
  description: "Check database health and connection status.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async () => {
    try {
      const exec = getDbExec();
      await exec.execute("SELECT 1");
      return { ok: true };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : "Unknown",
      };
    }
  },
});
