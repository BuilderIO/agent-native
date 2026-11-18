import { defineAction, fail } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server";
import { mutateUserSetting } from "@agent-native/core/settings";

import {
  VIEW_SETTINGS_KEY,
  parseStoredViewSettings,
  storedViewSettingsSchema,
} from "../shared/view-settings.js";

export default defineAction({
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  description:
    "Change the current user's Design editor view settings. Pass only the settings to change; the rest keep their saved values.",
  schema: storedViewSettingsSchema.partial(),
  http: { method: "PUT" },
  run: async (patch) => {
    const email = getRequestUserEmail();
    if (!email) {
      fail("Sign in to change your view settings.", {
        errorCode: "unauthenticated",
        statusCode: 401,
      });
    }
    let next: ReturnType<typeof parseStoredViewSettings> | undefined;
    await mutateUserSetting(email, VIEW_SETTINGS_KEY, (current) => {
      next = { ...parseStoredViewSettings(current), ...patch };
      return next;
    });
    return next as ReturnType<typeof parseStoredViewSettings>;
  },
});
