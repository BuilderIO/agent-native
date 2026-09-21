import { defineAction } from "@agent-native/core/action";
import { getUserSetting, mutateUserSetting } from "@agent-native/core/settings";
import { z } from "zod";

import {
  CONTENT_SIDEBAR_STATE_SETTING_KEY,
  contentSidebarStateSettingKey,
  contentSidebarStateSchema,
  normalizeContentSidebarState,
} from "./_content-sidebar-state.js";

export default defineAction({
  description: "Persist the current user's Content sidebar expansion state.",
  schema: contentSidebarStateSchema
    .partial()
    .required({ version: true })
    .extend({ spaceId: z.string().min(1).max(256).optional() }),
  agentTool: false,
  run: async ({ spaceId, ...state }, ctx) => {
    if (!ctx?.userEmail) throw new Error("Not authenticated.");
    const scopedKey = contentSidebarStateSettingKey(spaceId);
    const legacy =
      scopedKey === CONTENT_SIDEBAR_STATE_SETTING_KEY
        ? null
        : await getUserSetting(
            ctx.userEmail,
            CONTENT_SIDEBAR_STATE_SETTING_KEY,
          );
    const saved = await mutateUserSetting(
      ctx.userEmail,
      scopedKey,
      (current) =>
        normalizeContentSidebarState({
          ...normalizeContentSidebarState(current ?? legacy, spaceId),
          ...state,
        })!,
    );
    return { state: normalizeContentSidebarState(saved, spaceId) };
  },
});
