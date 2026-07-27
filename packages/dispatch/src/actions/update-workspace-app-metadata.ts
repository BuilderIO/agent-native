import { defineAction } from "@agent-native/core";
import { getWorkspaceAppIdValidationError } from "@agent-native/core/shared";
import { z } from "zod";

import { updateWorkspaceAppMetadata } from "../server/lib/app-creation-store.js";

export default defineAction({
  description:
    "Update the human-editable display name and description Dispatch uses for a workspace app. These details are also used as connected-agent/A2A context.",
  schema: z.object({
    appId: z
      .string()
      .max(64)
      .refine((appId) => !getWorkspaceAppIdValidationError(appId), {
        message:
          "Use a non-reserved app id with lowercase letters, numbers, and hyphens.",
      })
      .describe("Workspace app id, matching the apps/<id> folder"),
    name: z
      .string()
      .max(120)
      .optional()
      .nullable()
      .describe("Human-readable app name"),
    description: z
      .string()
      .max(500)
      .optional()
      .nullable()
      .describe("Human-readable app description"),
  }),
  run: async (args) => updateWorkspaceAppMetadata(args),
});
