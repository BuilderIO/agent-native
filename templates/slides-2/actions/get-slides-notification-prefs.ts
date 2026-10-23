/**
 * Read Slides email notification preferences for the current user.
 *
 * Usage:
 *   pnpm action get-slides-notification-prefs
 */

import { defineAction, fail } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { getUserSetting } from "@agent-native/core/settings";
import { z } from "zod";

import {
  getSlidesNotificationPreferences,
  SLIDES_USER_PREFS_KEY,
  type SlidesNotificationPreferences,
} from "../shared/slides-user-prefs.js";

export default defineAction({
  description:
    "Get whether the current user receives Slides emails when someone comments on or replies in their decks.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async (): Promise<SlidesNotificationPreferences> => {
    const email = getRequestUserEmail();
    if (!email) {
      fail("Sign in required", {
        errorCode: "not_authenticated",
        statusCode: 401,
      });
    }
    return getSlidesNotificationPreferences(
      await getUserSetting(email, SLIDES_USER_PREFS_KEY),
    );
  },
});
