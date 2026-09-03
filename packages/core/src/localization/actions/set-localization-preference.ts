import { z } from "zod";

import { defineAction } from "../../action.js";
import {
  getUserSetting,
  putUserSetting,
} from "../../settings/user-settings.js";
import {
  LOCALIZATION_SETTING_KEY,
  SUPPORTED_LOCALES,
  normalizeLocalePreference,
  normalizeLocalizationPreference,
  normalizeTimezonePreference,
  type ResolvedLocalizationPreference,
} from "../shared.js";

export default defineAction({
  description:
    "Set the current user's interface language and scheduling timezone. Locale is 'system' or a supported BCP-47 locale; timezone is 'system' or an IANA zone such as America/New_York.",
  schema: z.object({
    locale: z
      .string()
      .describe("Language preference: 'system' or a supported BCP-47 locale.")
      .optional(),
    timezone: z
      .string()
      .describe("Scheduling timezone: 'system' or an IANA zone name.")
      .optional(),
  }),
  run: async (args, ctx): Promise<ResolvedLocalizationPreference> => {
    if (!ctx?.userEmail) throw new Error("Not authenticated.");

    // Each field is optional, so merge onto what is stored instead of
    // writing a partial record that silently resets the other one.
    const current = normalizeLocalizationPreference(
      await getUserSetting(ctx.userEmail, LOCALIZATION_SETTING_KEY),
    );

    let locale = current.locale;
    if (args.locale !== undefined) {
      const parsed = normalizeLocalePreference(args.locale);
      if (!parsed) {
        throw new Error(
          `Unsupported locale. Use system, ${SUPPORTED_LOCALES.join(", ")}.`,
        );
      }
      locale = parsed;
    }

    let timezone = current.timezone;
    if (args.timezone !== undefined) {
      const parsed = normalizeTimezonePreference(args.timezone);
      // Normalizing an unusable zone to "system" would quietly schedule the
      // user in the host zone, which is the failure this field exists to fix.
      if (parsed === "system" && args.timezone.trim() !== "system") {
        throw new Error(
          `Unknown timezone "${args.timezone}". Use system or an IANA zone such as America/New_York.`,
        );
      }
      timezone = parsed;
    }

    const value: ResolvedLocalizationPreference & Record<string, unknown> = {
      locale,
      timezone,
    };
    await putUserSetting(ctx.userEmail, LOCALIZATION_SETTING_KEY, value);
    return value;
  },
});
