import { z } from "zod";

import { defineAction } from "../../action.js";
import { putUserSetting } from "../../settings/user-settings.js";
import {
  LOCALIZATION_SETTING_KEY,
  SUPPORTED_LOCALES,
  normalizeLocalePreference,
  type LocalizationPreference,
} from "../shared.js";

export default defineAction({
  description:
    "Set the current user's interface language preference to 'system' or a supported BCP-47 locale.",
  schema: z.object({
    locale: z
      .string()
      .describe("Language preference: 'system' or a supported BCP-47 locale."),
  }),
  run: async (args, ctx): Promise<LocalizationPreference> => {
    if (!ctx?.userEmail) throw new Error("Not authenticated.");
    const locale = normalizeLocalePreference(args.locale);
    if (!locale) {
      throw new Error(
        `Unsupported locale. Use system, ${SUPPORTED_LOCALES.join(", ")}.`,
      );
    }
    const value: LocalizationPreference & Record<string, unknown> = { locale };
    await putUserSetting(ctx.userEmail, LOCALIZATION_SETTING_KEY, value);
    return value;
  },
});
