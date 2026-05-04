import { defineAction } from "@agent-native/core";
import { getWorkspaceAppIdValidationError } from "@agent-native/core/shared";
import { z } from "zod";
import { startWorkspaceAppCreation } from "../server/lib/app-creation-store.js";

export default defineAction({
  description:
    "Start creating a new workspace app from Dispatch. In local dev this returns a code-agent prompt; in production it creates a Builder branch when a Builder project is configured.",
  schema: z.object({
    prompt: z.string().min(1).describe("The user's app creation request"),
    appId: z
      .string()
      .max(64)
      .refine((appId) => !getWorkspaceAppIdValidationError(appId), {
        message:
          "Use a non-reserved app id with lowercase letters, numbers, and hyphens.",
      })
      .optional()
      .nullable()
      .describe("Desired workspace app id/path"),
    template: z
      .string()
      .optional()
      .nullable()
      .describe("Template to start from"),
    secretIds: z
      .array(z.string())
      .max(100)
      .optional()
      .describe("Dispatch vault secret IDs to grant to the app"),
  }),
  run: async (args) => startWorkspaceAppCreation(args),
});
