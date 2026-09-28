import { defineAction, fail } from "@agent-native/core/action";
import { mutateUserSetting } from "@agent-native/core/settings";

import {
  contentRecentTargetKey,
  contentRecentTargetSchema,
  readContentRecentState,
  removeContentRecentEntry,
} from "../shared/content-personal-navigation.js";
import { contentRecentSettingKey } from "./_content-recent.js";

export default defineAction({
  description:
    "Remove one destination from the current user's Recent navigation in the current context. Only forgets the visit; the Page, View, pins, and shared structure are unchanged.",
  schema: contentRecentTargetSchema,
  run: async (target, ctx) => {
    if (!ctx?.userEmail) fail("Not authenticated.", { statusCode: 401 });
    const key = contentRecentTargetKey(target);
    let removed = false;
    await mutateUserSetting(
      ctx.userEmail,
      contentRecentSettingKey(),
      (current) => {
        const state = readContentRecentState(current);
        const next = removeContentRecentEntry(state, target);
        removed = next !== state;
        return next;
      },
    );
    return { removed, key };
  },
});
