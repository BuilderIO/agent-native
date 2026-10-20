import { defineAction } from "@agent-native/core/action";
import {
  getWorkspaceAppIdValidationError,
  normalizeWorkspaceAppId,
} from "@agent-native/core/shared";
import { z } from "zod";

import { installCuratedCommunityApp } from "../server/lib/community-apps.js";

export default defineAction({
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  description:
    "Install one reviewed, pinned community app template into the associated workspace. Select a sourceId from list-curated-community-apps; repository and revision are fixed by Dispatch and cannot be supplied by the caller.",
  schema: z.object({
    sourceId: z.string().min(1).max(100).describe("Curated source id"),
    appId: z
      .string()
      .max(64)
      .transform(normalizeWorkspaceAppId)
      .refine((appId) => !getWorkspaceAppIdValidationError(appId), {
        message:
          "Use a non-reserved app id with lowercase letters, numbers, and hyphens.",
      })
      .optional()
      .describe("Optional target app id; defaults to the template's app id"),
  }),
  run: async (input) => installCuratedCommunityApp(input),
});
