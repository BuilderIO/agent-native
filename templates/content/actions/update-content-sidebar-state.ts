import { defineAction } from "@agent-native/core/action";
import { putUserSetting } from "@agent-native/core/settings";

import {
  CONTENT_SIDEBAR_STATE_SETTING_KEY,
  contentSidebarStateSchema,
} from "./_content-sidebar-state.js";

export default defineAction({
  description: "Persist the current user's Content sidebar expansion state.",
  schema: contentSidebarStateSchema,
  agentTool: false,
  run: async (state, ctx) => {
    if (!ctx?.userEmail) throw new Error("Not authenticated.");
    const normalized = {
      ...state,
      expandedWorkspaceIds: [...new Set(state.expandedWorkspaceIds)],
      expandedDocumentIds: [...new Set(state.expandedDocumentIds)],
    };
    await putUserSetting(
      ctx.userEmail,
      CONTENT_SIDEBAR_STATE_SETTING_KEY,
      normalized,
    );
    return { state: normalized };
  },
});
