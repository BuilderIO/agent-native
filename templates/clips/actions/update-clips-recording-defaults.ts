/**
 * Update the current user's Clips recording defaults.
 *
 * Usage:
 *   pnpm action update-clips-recording-defaults --defaultPlaybackSpeed=1.5
 *   pnpm action update-clips-recording-defaults --defaultRecordingVisibility=private
 *   pnpm action update-clips-recording-defaults '{"defaultRecordingVisibility":null}'
 */

import { defineAction } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { mutateUserSetting } from "@agent-native/core/settings";
import { z } from "zod";

import { readActiveOrganizationDefaultVisibility } from "../server/lib/recordings.js";
import { CLIPS_USER_PREFS_KEY } from "../shared/clips-ai-prefs.js";
import {
  CLIPS_DEFAULT_PLAYBACK_SPEEDS,
  CLIPS_RECORDING_VISIBILITIES,
  getClipsRecordingDefaults,
  type ClipsRecordingDefaults,
} from "../shared/clips-recording-defaults.js";

const patchSchema = z
  .object({
    defaultPlaybackSpeed: z
      .enum(CLIPS_DEFAULT_PLAYBACK_SPEEDS)
      .optional()
      .describe("Speed recordings open at, as a string such as 1.5."),
    defaultRecordingVisibility: z
      .enum(CLIPS_RECORDING_VISIBILITIES)
      .nullable()
      .optional()
      .describe(
        "Visibility for recordings this user creates, overriding the organization default. null clears it so the organization default applies again.",
      ),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide defaultPlaybackSpeed or defaultRecordingVisibility",
  });

export default defineAction({
  description:
    "Update the current user's Clips recording defaults: the playback speed recordings open at and their own visibility for new recordings. Pass defaultRecordingVisibility: null to follow the organization default again. Other Clips preferences are kept. Returns the same shape as get-clips-recording-defaults.",
  schema: patchSchema,
  run: async (args): Promise<ClipsRecordingDefaults> => {
    const email = getRequestUserEmail();
    if (!email) throw new Error("Sign in required");

    const next = await mutateUserSetting(
      email,
      CLIPS_USER_PREFS_KEY,
      (current) => {
        const merged: Record<string, unknown> = { ...(current ?? {}) };
        if (args.defaultPlaybackSpeed !== undefined) {
          merged.defaultPlaybackSpeed = args.defaultPlaybackSpeed;
        }
        if (args.defaultRecordingVisibility === null) {
          delete merged.defaultRecordingVisibility;
        } else if (args.defaultRecordingVisibility !== undefined) {
          merged.defaultRecordingVisibility = args.defaultRecordingVisibility;
        }
        return merged;
      },
    );
    return getClipsRecordingDefaults(
      next,
      await readActiveOrganizationDefaultVisibility(),
    );
  },
});
