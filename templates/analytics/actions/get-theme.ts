import { defineAction } from "@agent-native/core/action";
import { getUserSetting } from "@agent-native/core/settings";
import { z } from "zod";

import { resolveRequestScope } from "../server/lib/scoped-settings";

export default defineAction({
  agentTool: false,
  description: "Get the saved Analytics UI theme for the current user.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async () => {
    try {
      const scope = resolveRequestScope();
      const data = await getUserSetting(scope.email, "analytics-theme");
      if (data) return data;
      return { theme: "dark" };
    } catch {
      return { theme: "dark" };
    }
  },
});
