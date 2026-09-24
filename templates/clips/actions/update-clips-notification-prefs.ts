/**
 * Update Clips email notification preferences for the current user.
 *
 * Usage:
 *   pnpm action update-clips-notification-prefs --emailNotifications=false
 */

import { defineAction } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { mutateUserSetting } from "@agent-native/core/settings";
import { z } from "zod";

import { CLIPS_USER_PREFS_KEY } from "../shared/clips-ai-prefs.js";
import {
  applyClipsNotificationPrefsPatch,
  getClipsNotificationPreferences,
  type ClipsNotificationPreferences,
  type ClipsNotificationPrefsPatch,
} from "../shared/clips-notification-prefs.js";

const patchSchema = z
  .object({
    emailNotifications: z
      .boolean()
      .optional()
      .describe("Turn every optional Clips email notification on or off."),
    viewNotifications: z
      .boolean()
      .optional()
      .describe("Send emails about Clip views and AI agent reads."),
    commentNotifications: z
      .boolean()
      .optional()
      .describe("Send emails about Clip comments and replies."),
    reactionNotifications: z
      .boolean()
      .optional()
      .describe("Send emails about reactions on Clips."),
    recapNotifications: z
      .boolean()
      .optional()
      .describe("Send monthly Clips recap emails."),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one notification preference to update",
  });

export default defineAction({
  description:
    "Update Clips email notification preferences. The all-email switch updates every optional notification category atomically; category changes preserve the other categories.",
  schema: patchSchema,
  run: async (
    args: ClipsNotificationPrefsPatch,
  ): Promise<ClipsNotificationPreferences> => {
    const email = getRequestUserEmail();
    if (!email) throw new Error("Sign in required");

    const next = await mutateUserSetting(
      email,
      CLIPS_USER_PREFS_KEY,
      (current) => applyClipsNotificationPrefsPatch(current, args),
    );
    return getClipsNotificationPreferences(next);
  },
});
