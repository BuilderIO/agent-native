import { defineAction } from "@agent-native/core/action";
import {
  getWorkspaceAppIdValidationError,
  parseAgentProfileMetadata,
} from "@agent-native/core/shared";
import { z } from "zod";

import { updateWorkspaceAppMetadata } from "../server/lib/app-creation-store.js";

export default defineAction({
  description:
    "Update a workspace app's display name, description, and when-to-use profile. Only organization owners and admins can edit these shared details.",
  schema: z
    .object({
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
        .max(1000)
        .optional()
        .nullable()
        .describe("Human-readable app description, up to 1,000 characters"),
      whenToUse: z
        .array(z.string())
        .max(6)
        .optional()
        .nullable()
        .describe("Example requests that indicate when this app is useful"),
    })
    .superRefine(({ description, whenToUse }, context) => {
      if (description == null && whenToUse == null) return;
      const profile = parseAgentProfileMetadata({ description, whenToUse });
      if (!profile) {
        context.addIssue({
          code: "custom",
          message:
            "Use a description up to 1,000 characters and up to 6 non-empty examples, each no longer than 140 characters.",
        });
      }
    }),
  run: async (args) => updateWorkspaceAppMetadata(args),
});
