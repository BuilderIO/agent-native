/**
 * Update Content email notification preferences for the current user.
 *
 * Usage:
 *   pnpm action update-content-notification-prefs --emailNotifications=false
 */

import { defineAction, fail } from "@agent-native/core/action";
import { mutateUserSetting } from "@agent-native/core/settings";
import { z } from "zod";

import {
  CONTENT_USER_PREFS_KEY,
  getContentNotificationPreferences,
  type ContentNotificationPreferences,
} from "../shared/content-user-prefs.js";

export default defineAction({
  description:
    "Turn the current user's Content comment, reply, and mention emails on or off. Share invites are always sent.",
  schema: z
    .object({
      emailNotifications: z
        .boolean()
        .describe(
          "Send an email when someone comments on or replies in the user's documents, or mentions them.",
        ),
    })
    .strict(),
  run: async (args, ctx): Promise<ContentNotificationPreferences> => {
    if (!ctx?.userEmail) fail("Not authenticated.", { statusCode: 401 });
    // Merge so the write never drops preferences stored beside this one.
    const next = await mutateUserSetting(
      ctx.userEmail,
      CONTENT_USER_PREFS_KEY,
      (current) => ({
        ...current,
        emailNotifications: args.emailNotifications,
      }),
    );
    return getContentNotificationPreferences(next);
  },
});
