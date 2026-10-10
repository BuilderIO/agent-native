import { defineAction } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server";
import { mutateUserSetting } from "@agent-native/core/settings";

import {
  VIEW_SETTINGS_KEY,
  parseStoredViewSettings,
  viewSettingsSchema,
  type ViewSettings,
} from "../shared/view-settings.js";

export default defineAction({
  description:
    "Change the current user's Design editor view settings. Pass only the settings to change; the rest keep their saved values.",
  schema: viewSettingsSchema.partial(),
  http: { method: "PUT" },
  run: async (patch) => {
    const email = getRequestUserEmail();
    if (!email) {
      throw Object.assign(new Error("Not authenticated"), { statusCode: 401 });
    }
    let next: ViewSettings | undefined;
    await mutateUserSetting(email, VIEW_SETTINGS_KEY, (current) => {
      next = { ...parseStoredViewSettings(current), ...patch };
      return next;
    });
    return next as ViewSettings;
  },
});
