import { defineAction } from "@agent-native/core/action";
import { mutateUserSetting } from "@agent-native/core/settings";

import {
  CONTENT_SIDEBAR_STATE_SETTING_KEY,
  contentSidebarStateSchema,
  normalizeContentSidebarState,
} from "./_content-sidebar-state.js";

export default defineAction({
  description: "Persist the current user's Content sidebar expansion state.",
  schema: contentSidebarStateSchema.partial().required({ version: true }),
  agentTool: false,
  run: async (state, ctx) => {
    if (!ctx?.userEmail) throw new Error("Not authenticated.");
    const saved = await mutateUserSetting(
      ctx.userEmail,
      CONTENT_SIDEBAR_STATE_SETTING_KEY,
      (current) =>
        normalizeContentSidebarState({
          expandedWorkspaceIds: [],
          expandedDocumentIds: [],
          ...normalizeContentSidebarState(current),
          ...state,
        })!,
    );
    return { state: normalizeContentSidebarState(saved) };
  },
});
