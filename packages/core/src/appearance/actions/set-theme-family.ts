import { z } from "zod";

import { defineAction, fail } from "../../action.js";
import { writeAppState } from "../../application-state/script-helpers.js";
import { putUserSetting } from "../../settings/user-settings.js";
import {
  THEME_FAMILIES,
  themeFamilyAppStateKey,
  themeFamilySettingKey,
} from "../theme-family.js";

export default defineAction({
  description:
    "Set the current app's theme family to agent-native or original. This is separate from light or dark color mode.",
  schema: z.object({
    family: z
      .enum(THEME_FAMILIES)
      .describe("Theme family: agent-native or original."),
  }),
  http: { method: "POST" },
  run: async ({ family }, ctx) => {
    const email = ctx?.userEmail;
    if (!email) fail("Not authenticated.", { statusCode: 401 });

    const settingKey = themeFamilySettingKey(ctx?.appId);
    await putUserSetting(email, settingKey, { family });

    try {
      await writeAppState(themeFamilyAppStateKey(ctx?.appId), { family });
    } catch {
      fail(
        "The theme family was saved, but the open app could not be synchronized.",
        { errorCode: "theme_family_sync_failed", statusCode: 503 },
      );
    }

    return { family, appId: ctx?.appId ?? null };
  },
});
