import { defineAction } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server";
import { getUserSetting } from "@agent-native/core/settings";
import { z } from "zod";

import {
  VIEW_SETTINGS_KEY,
  parseStoredViewSettings,
} from "../shared/view-settings.js";

export default defineAction({
  description:
    "Read the current user's Design editor view settings: pixel grid, snap to pixel grid, rulers, multiplayer cursors, and hidden comments.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async () => {
    const email = getRequestUserEmail();
    if (!email) {
      throw Object.assign(new Error("Not authenticated"), { statusCode: 401 });
    }
    return parseStoredViewSettings(
      await getUserSetting(email, VIEW_SETTINGS_KEY),
    );
  },
});
