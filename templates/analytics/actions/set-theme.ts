import { defineAction } from "@agent-native/core/action";
import { putUserSetting } from "@agent-native/core/settings";
import { z } from "zod";

import { resolveRequestScope } from "../server/lib/scoped-settings";

export default defineAction({
  agentTool: false,
  description: "Save the Analytics UI theme for the current user.",
  schema: z.object({
    theme: z.unknown().optional().describe("'light' or 'dark'"),
  }),
  http: { method: "POST" },
  run: async (args) => {
    const theme = args.theme === "light" ? "light" : "dark";
    const scope = resolveRequestScope();
    await putUserSetting(scope.email, "analytics-theme", { theme });
    return { theme };
  },
});
