import { defineAction, fail } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { getUserSetting } from "@agent-native/core/settings";
import { z } from "zod";

import {
  DESIGN_EDITOR_PREFERENCES_SETTING_KEY,
  isUserSettingsContainer,
  parseNativeShaderPreviewPreference,
} from "../shared/native-editor-preferences.js";

export default defineAction({
  description:
    "Get your saved Design editor shader preview policy. Returns nativeShaderPreview as a policy object or null when previews inherit each design's saved policy.",
  requiresAuth: true,
  schema: z.object({}),
  http: { method: "GET" },
  run: async () => {
    const email = getRequestUserEmail()?.trim().toLowerCase();
    if (!email)
      fail("Sign in to read Design editor preferences.", {
        errorCode: "design_editor_preferences_auth_required",
        statusCode: 401,
      });

    const stored = await getUserSetting(
      email,
      DESIGN_EDITOR_PREFERENCES_SETTING_KEY,
    );
    if (!isUserSettingsContainer(stored))
      fail("Saved Design editor preferences are invalid.", {
        errorCode: "design_editor_preferences_invalid",
        statusCode: 500,
      });

    const parsed = parseNativeShaderPreviewPreference(
      stored?.nativeShaderPreview,
    );
    if (parsed.status === "invalid")
      fail("Saved Design editor preferences are invalid.", {
        errorCode: "design_editor_preferences_invalid",
        statusCode: 500,
      });
    return { nativeShaderPreview: parsed.policy };
  },
});
