import { defineAction } from "@agent-native/core";
import { z } from "zod";

import {
  putScopedSettingRecord,
  resolveRequestScope,
} from "../server/lib/scoped-settings";

export default defineAction({
  agentTool: false,
  description: "Save the Analytics UI theme for the current scope.",
  schema: z.object({
    theme: z.unknown().optional().describe("'light' or 'dark'"),
  }),
  http: { method: "POST" },
  run: async (args) => {
    const theme = args.theme === "light" ? "light" : "dark";
    const scope = resolveRequestScope();
    await putScopedSettingRecord(scope, "analytics-theme", { theme });
    return { theme };
  },
});
