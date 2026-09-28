/**
 * Update Slides email notification preferences for the current user.
 *
 * Usage:
 *   pnpm action update-slides-notification-prefs --emailNotifications=false
 */

import { defineAction } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { mutateUserSetting } from "@agent-native/core/settings";
import { z } from "zod";

import {
  getSlidesNotificationPreferences,
  SLIDES_USER_PREFS_KEY,
  type SlidesNotificationPreferences,
} from "../shared/slides-user-prefs.js";

export default defineAction({
  description:
    "Turn the current user's Slides comment and reply emails on or off. Share invites are always sent.",
  schema: z
    .object({
      emailNotifications: z
        .boolean()
        .describe(
          "Send an email when someone comments on or replies in the user's decks.",
        ),
    })
    .strict(),
  run: async (args): Promise<SlidesNotificationPreferences> => {
    const email = getRequestUserEmail();
    if (!email) throw new Error("Sign in required");
    // Merge so the write never drops preferences stored beside this one.
    const next = await mutateUserSetting(
      email,
      SLIDES_USER_PREFS_KEY,
      (current) => ({
        ...current,
        emailNotifications: args.emailNotifications,
      }),
    );
    return getSlidesNotificationPreferences(next);
  },
});
