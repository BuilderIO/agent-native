/**
 * Read Clips email notification preferences for the current user.
 *
 * Usage:
 *   pnpm action get-clips-notification-prefs
 */

import { defineAction } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { getUserSetting } from "@agent-native/core/settings";
import { z } from "zod";

import {
  CLIPS_USER_PREFS_KEY,
  type ClipsUserPrefs,
} from "../shared/clips-ai-prefs.js";
import {
  getClipsNotificationPreferences,
  type ClipsNotificationPreferences,
} from "../shared/clips-notification-prefs.js";

export default defineAction({
  description:
    "Get the current user's Clips email notification preferences for views, comments, reactions, and monthly recaps.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async (): Promise<ClipsNotificationPreferences> => {
    const email = getRequestUserEmail();
    if (!email) throw new Error("Sign in required");

    const prefs = (await getUserSetting(
      email,
      CLIPS_USER_PREFS_KEY,
    )) as ClipsUserPrefs | null;
    return getClipsNotificationPreferences(prefs);
  },
});
