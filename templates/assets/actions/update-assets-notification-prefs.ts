/**
 * Update the current user's Assets email notification preference.
 *
 * Usage:
 *   pnpm action update-assets-notification-prefs --emailNotifications=false
 */

import { defineAction } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { mutateUserSetting } from "@agent-native/core/settings";
import { z } from "zod";

import {
  ASSETS_USER_PREFS_KEY,
  getAssetsNotificationPreferences,
  type AssetsNotificationPreferences,
} from "../shared/assets-user-prefs.js";

export default defineAction({
  description:
    "Turn the current user's Assets generation emails on or off. When on, they get an email when a generation they started finishes or fails.",
  schema: z
    .object({
      emailNotifications: z
        .boolean()
        .describe("Email me when a generation I started finishes or fails."),
    })
    .strict(),
  run: async (args): Promise<AssetsNotificationPreferences> => {
    const email = getRequestUserEmail();
    if (!email) throw new Error("Sign in required");
    const next = await mutateUserSetting(
      email,
      ASSETS_USER_PREFS_KEY,
      (current) => ({
        ...(current ?? {}),
        emailNotifications: args.emailNotifications,
      }),
    );
    return getAssetsNotificationPreferences(next);
  },
});
