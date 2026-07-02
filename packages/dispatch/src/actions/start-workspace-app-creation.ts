import { defineAction } from "@agent-native/core";
import { getWorkspaceAppIdValidationError } from "@agent-native/core/shared";
import { z } from "zod";

import { startWorkspaceAppCreation } from "../server/lib/app-creation-store.js";

export default defineAction({
  description:
    'Start creating a new workspace app from Dispatch when the request truly needs its own app. Callers should include a concise generated description by default; Dispatch generates one from the prompt when omitted. In local dev this returns a code-agent prompt; in production it creates a Builder branch only when a Builder branch project is configured. If the result mode is "coming-soon", the work still requires a code change but no Builder Cloud Agent can run here; tell the user to edit locally or use Builder.io to edit this code in the cloud and continue customizing the app any way they like, and do not send them to Builder org/beta settings. The result must be a separate workspace app under apps/<app-id>, not a new route or file in apps/chat. If chat is used as the source template, the finished app must be branded as the requested app and must not leave visible "Chat", "Starter", "Blank app", or "New app" UI behind. If the request needs Mail, Calendar, Analytics, Brain, Assets, or another first-party app, use the existing hosted/connected app via links or A2A; do not clone, wrap, or nest those templates inside the new app unless the user explicitly asks for a customized copy.',
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
    description: z
      .string()
      .max(500)
      .optional()
      .nullable()
      .describe(
        "Concise AI-generated description of the app based on the user's prompt. Dispatch saves this while the app is being created.",
      ),
    secretIds: z
      .array(z.string())
      .max(100)
      .optional()
      .describe("Dispatch vault secret IDs to grant to the app"),
    resourceIds: z
      .array(z.string())
      .max(100)
      .optional()
      .describe(
        "Dispatch workspace resource IDs or knowledge packs to grant to the app",
      ),
  }),
  run: async (args) => startWorkspaceAppCreation(args),
});
