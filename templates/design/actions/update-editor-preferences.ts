import { defineAction, fail } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { mutateUserSetting } from "@agent-native/core/settings";
import { z } from "zod";

import {
  DESIGN_EDITOR_PREFERENCES_SETTING_KEY,
  isUserSettingsContainer,
} from "../shared/native-editor-preferences.js";

const previewPolicy = z
  .object({
    quality: z.enum(["auto", "performance", "quality"]),
    frameRateTarget: z.union([z.literal(60), z.literal(120)]),
    colorMode: z.enum(["srgb", "display-p3"]).optional(),
    dynamicRange: z.enum(["sdr", "hdr"]).optional(),
  })
  .strict();

export default defineAction({
  description:
    "Save your Design editor shader preview policy, or pass null to inherit each design's saved preview policy. This affects editor previews and never changes saved designs or export settings.",
  requiresAuth: true,
  schema: z
    .object({
      nativeShaderPreview: previewPolicy
        .nullable()
        .describe(
          "Complete editor shader policy (quality auto/performance/quality; target FPS 60/120; optional output color srgb/display-p3 and dynamic range sdr/hdr), or null to inherit each design's saved policy.",
        ),
    })
    .strict(),
  run: async ({ nativeShaderPreview }) => {
    const email = getRequestUserEmail()?.trim().toLowerCase();
    if (!email)
      fail("Sign in to update Design editor preferences.", {
        errorCode: "design_editor_preferences_auth_required",
        statusCode: 401,
      });

    const saved = await mutateUserSetting(
      email,
      DESIGN_EDITOR_PREFERENCES_SETTING_KEY,
      (current) => {
        if (!isUserSettingsContainer(current))
          fail("Saved Design editor preferences are invalid.", {
            errorCode: "design_editor_preferences_invalid",
            statusCode: 500,
          });
        return { ...(current ?? {}), nativeShaderPreview };
      },
    );
    return { nativeShaderPreview: saved.nativeShaderPreview ?? null };
  },
});
