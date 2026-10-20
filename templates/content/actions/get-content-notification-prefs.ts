/**
 * Read Content email notification preferences for the current user.
 *
 * Usage:
 *   pnpm action get-content-notification-prefs
 */

import { defineAction, fail } from "@agent-native/core/action";
import { getUserSetting } from "@agent-native/core/settings";
import { z } from "zod";

import {
  CONTENT_USER_PREFS_KEY,
  getContentNotificationPreferences,
  type ContentNotificationPreferences,
} from "../shared/content-user-prefs.js";

export default defineAction({
  description:
    "Get whether the current user receives Content emails when someone comments on or replies in their documents, or mentions them.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async (_args, ctx): Promise<ContentNotificationPreferences> => {
    if (!ctx?.userEmail) fail("Not authenticated.", { statusCode: 401 });
    return getContentNotificationPreferences(
      await getUserSetting(ctx.userEmail, CONTENT_USER_PREFS_KEY),
    );
  },
});
