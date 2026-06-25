import { z } from "zod";

import { defineAction } from "../../action.js";
import { getUserSetting } from "../../settings/user-settings.js";
import {
  LOCALIZATION_SETTING_KEY,
  normalizeLocalizationPreference,
  type LocalizationPreference,
} from "../shared.js";

export default defineAction({
  description:
    "Get the current user's interface language preference. Returns { locale }, where locale is 'system' or a supported BCP-47 locale.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async (_args, ctx): Promise<LocalizationPreference> => {
    if (!ctx?.userEmail) throw new Error("Not authenticated.");
    const stored = await getUserSetting(
      ctx.userEmail,
      LOCALIZATION_SETTING_KEY,
    );
    return normalizeLocalizationPreference(stored);
  },
});
