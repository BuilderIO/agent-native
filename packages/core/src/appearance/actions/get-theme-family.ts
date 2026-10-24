import { z } from "zod";

import { defineAction, fail } from "../../action.js";
import { getUserSetting } from "../../settings/user-settings.js";
import {
  DEFAULT_THEME_FAMILY,
  THEME_FAMILIES,
  themeFamilySettingKey,
  type ThemeFamily,
} from "../theme-family.js";

export interface ThemeFamilyPreference {
  family: ThemeFamily;
  source: "default" | "user-setting";
  appId: string | null;
}

export default defineAction({
  description:
    "Read the current app's saved theme family, which is independent of light or dark color mode.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  agentTool: false,
  run: async (_args, ctx): Promise<ThemeFamilyPreference> => {
    const email = ctx?.userEmail;
    if (!email) fail("Not authenticated.", { statusCode: 401 });

    const stored = await getUserSetting(
      email,
      themeFamilySettingKey(ctx?.appId),
    );
    if (stored === null) {
      return {
        family: DEFAULT_THEME_FAMILY,
        source: "default",
        appId: ctx?.appId ?? null,
      };
    }

    const parsed = z
      .object({ family: z.enum(THEME_FAMILIES) })
      .safeParse(stored);
    if (!parsed.success) {
      fail("The saved theme family setting is invalid and could not be read.", {
        errorCode: "theme_family_setting_invalid",
        statusCode: 500,
      });
    }

    return {
      family: parsed.data.family,
      source: "user-setting",
      appId: ctx?.appId ?? null,
    };
  },
});
