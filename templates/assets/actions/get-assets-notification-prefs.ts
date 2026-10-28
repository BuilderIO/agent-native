/**
 * Read the current user's Assets email notification preference.
 *
 * Usage:
 *   pnpm action get-assets-notification-prefs
 */

import { defineAction } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { getUserSetting } from "@agent-native/core/settings";
import { z } from "zod";

import {
  ASSETS_USER_PREFS_KEY,
  getAssetsNotificationPreferences,
  type AssetsNotificationPreferences,
} from "../shared/assets-user-prefs.js";

export default defineAction({
  description:
    "Get whether the current user gets an email when a generation they started finishes or fails (Settings › Notifications).",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async (): Promise<AssetsNotificationPreferences> => {
    const email = getRequestUserEmail();
    if (!email) throw new Error("Sign in required");
    return getAssetsNotificationPreferences(
      await getUserSetting(email, ASSETS_USER_PREFS_KEY),
    );
  },
});
