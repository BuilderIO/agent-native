import { defineAction } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server";
import { getUserSetting, putUserSetting } from "@agent-native/core/settings";
import { z } from "zod";

import {
  ANALYTICS_USER_PREFS_KEY,
  type AnalyticsUserPrefs,
} from "../shared/analytics-user-prefs.js";

export default defineAction({
  description:
    "Turn the current user's Analytics notifications on or off: emails for new JavaScript errors and the bell sound when an agent run finishes. Both are off by default. Pass only the fields to change; returns the saved preferences.",
  schema: z
    .object({
      errorEmailNotifications: z
        .boolean()
        .optional()
        .describe("Email the user when a new JavaScript error is captured"),
      bellSoundEnabled: z
        .boolean()
        .optional()
        .describe("Play the bell sound when an agent run finishes"),
    })
    .refine(
      (args) =>
        args.errorEmailNotifications !== undefined ||
        args.bellSoundEnabled !== undefined,
      { message: "Pass errorEmailNotifications, bellSoundEnabled, or both." },
    ),
  run: async (args) => {
    const email = getRequestUserEmail();
    if (!email) {
      throw Object.assign(new Error("Not authenticated"), { statusCode: 401 });
    }
    const current =
      // coercion-ok: null means the user never saved a preference; read failures throw.
      (await getUserSetting(email, ANALYTICS_USER_PREFS_KEY)) ?? {};
    const next: Record<string, unknown> & AnalyticsUserPrefs = {
      ...current,
      ...(args.errorEmailNotifications === undefined
        ? {}
        : { errorEmailNotifications: args.errorEmailNotifications }),
      ...(args.bellSoundEnabled === undefined
        ? {}
        : { bellSoundEnabled: args.bellSoundEnabled }),
    };
    await putUserSetting(email, ANALYTICS_USER_PREFS_KEY, next);
    return {
      errorEmailNotifications: next.errorEmailNotifications === true,
      bellSoundEnabled: next.bellSoundEnabled === true,
    };
  },
});
