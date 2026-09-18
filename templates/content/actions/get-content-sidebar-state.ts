import { defineAction } from "@agent-native/core/action";
import { getUserSetting } from "@agent-native/core/settings";
import { z } from "zod";

import {
  CONTENT_SIDEBAR_STATE_SETTING_KEY,
  normalizeContentSidebarState,
} from "./_content-sidebar-state.js";

export default defineAction({
  description: "Read the current user's Content sidebar expansion state.",
  schema: z.object({ spaceId: z.string().min(1).max(256).optional() }),
  http: { method: "GET" },
  agentTool: false,
  run: async (args, ctx) => {
    if (!ctx?.userEmail) throw new Error("Not authenticated.");
    const stored = await getUserSetting(
      ctx.userEmail,
      CONTENT_SIDEBAR_STATE_SETTING_KEY,
    );
    return { state: normalizeContentSidebarState(stored, args.spaceId) };
  },
});
