import { defineAction } from "@agent-native/core/action";
import { getUserSetting } from "@agent-native/core/settings";
import { z } from "zod";

import {
  CONTENT_SIDEBAR_STATE_SETTING_KEY,
  normalizeContentSidebarState,
} from "./_content-sidebar-state.js";

export default defineAction({
  description: "Read the current user's Content sidebar expansion state.",
  schema: z.object({}),
  http: { method: "GET" },
  agentTool: false,
  run: async (_args, ctx) => {
    if (!ctx?.userEmail) throw new Error("Not authenticated.");
    const stored = await getUserSetting(
      ctx.userEmail,
      CONTENT_SIDEBAR_STATE_SETTING_KEY,
    );
    return { state: normalizeContentSidebarState(stored) };
  },
});
