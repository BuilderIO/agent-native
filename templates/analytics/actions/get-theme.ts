import { defineAction } from "@agent-native/core";
import { z } from "zod";

import {
  getScopedSettingRecord,
  resolveRequestScope,
} from "../server/lib/scoped-settings";

export default defineAction({
  agentTool: false,
  description: "Get the saved Analytics UI theme for the current scope.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async () => {
    // Theme is read during first paint; an unauthenticated or failed lookup
    // must still resolve to the default rather than break the shell.
    try {
      const scope = resolveRequestScope();
      const data = await getScopedSettingRecord(scope, "analytics-theme");
      if (data) return data;
      return { theme: "dark" };
    } catch {
      return { theme: "dark" };
    }
  },
});
