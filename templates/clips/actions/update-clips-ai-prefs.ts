/**
 * Update Clips AI preferences for the current user.
 *
 * Merges into the shared `clips-user-prefs` object so playback/transcript
 * preferences from Settings are preserved.
 *
 * Usage:
 *   pnpm action update-clips-ai-prefs --includeFullVideoInAi=true
 */

import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { getUserSetting, putUserSetting } from "@agent-native/core/settings";
import { z } from "zod";

import {
  CLIPS_USER_PREFS_KEY,
  type ClipsUserPrefs,
} from "../shared/clips-ai-prefs.js";

export default defineAction({
  description:
    "Update Clips AI tool preferences for the current user. When includeFullVideoInAi is true, default title/description generation and AI tools watch the full recording instead of relying on transcript alone. Full-video understanding requires a Gemini model (Builder Gemini or GEMINI_API_KEY).",
  schema: z.object({
    includeFullVideoInAi: z
      .boolean()
      .describe(
        "When true, Clips AI tools watch the full video (screen + audio) with a Gemini model, not just the transcript.",
      ),
  }),
  run: async (args) => {
    const email = getRequestUserEmail();
    if (!email) throw new Error("Sign in required");

    const existing = ((await getUserSetting(email, CLIPS_USER_PREFS_KEY)) ??
      {}) as ClipsUserPrefs;
    const next: ClipsUserPrefs = {
      ...existing,
      includeFullVideoInAi: args.includeFullVideoInAi,
    };
    await putUserSetting(
      email,
      CLIPS_USER_PREFS_KEY,
      next as Record<string, unknown>,
    );
    return {
      includeFullVideoInAi: next.includeFullVideoInAi === true,
    };
  },
});
