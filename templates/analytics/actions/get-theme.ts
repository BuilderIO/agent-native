import { defineAction } from "@agent-native/core/action";
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
