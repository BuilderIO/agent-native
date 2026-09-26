/**
 * Read the current user's Clips recording defaults: playback speed, their own
 * visibility choice, and the visibility new recordings actually get.
 *
 * Usage:
 *   pnpm action get-clips-recording-defaults
 */

import { defineAction } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { getUserSetting } from "@agent-native/core/settings";
import { z } from "zod";

import { readActiveOrganizationDefaultVisibility } from "../server/lib/recordings.js";
import {
  CLIPS_USER_PREFS_KEY,
  type ClipsUserPrefs,
} from "../shared/clips-ai-prefs.js";
import {
  getClipsRecordingDefaults,
  type ClipsRecordingDefaults,
} from "../shared/clips-recording-defaults.js";

export default defineAction({
  description:
    "Get the current user's Clips recording defaults. defaultPlaybackSpeed is the speed recordings open at. defaultRecordingVisibility is the user's own choice, or null when they follow the organization default. effectiveRecordingVisibility is what a new recording gets, and recordingVisibilitySource says whether it comes from the user ('personal'), the organization default ('organization'), or the built-in default ('built-in').",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async (): Promise<ClipsRecordingDefaults> => {
    const email = getRequestUserEmail();
    if (!email) throw new Error("Sign in required");

    const [prefs, organizationDefault] = await Promise.all([
      getUserSetting(
        email,
        CLIPS_USER_PREFS_KEY,
      ) as Promise<ClipsUserPrefs | null>,
      readActiveOrganizationDefaultVisibility(),
    ]);
    return getClipsRecordingDefaults(prefs, organizationDefault);
  },
});
