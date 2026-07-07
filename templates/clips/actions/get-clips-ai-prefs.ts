/**
 * Read Clips AI preferences for the current user (include-full-video switch).
 *
 * Usage:
 *   pnpm action get-clips-ai-prefs
 */

import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { getUserSetting } from "@agent-native/core/settings";
import { z } from "zod";

import {
  CLIPS_USER_PREFS_KEY,
  isIncludeFullVideoInAiEnabled,
  type ClipsUserPrefs,
} from "../shared/clips-ai-prefs.js";

export default defineAction({
  description:
    "Get Clips AI tool preferences for the current user, including whether AI tools should watch the full recording with Gemini instead of transcript-only.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async () => {
    const email = getRequestUserEmail();
    if (!email) {
      return { includeFullVideoInAi: false };
    }
    const prefs = ((await getUserSetting(email, CLIPS_USER_PREFS_KEY)) ??
      {}) as ClipsUserPrefs;
    return {
      includeFullVideoInAi: isIncludeFullVideoInAiEnabled(prefs),
    };
  },
});
