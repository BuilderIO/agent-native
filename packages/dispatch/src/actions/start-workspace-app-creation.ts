import { defineAction } from "@agent-native/core/action";
import {
  getWorkspaceAppIdValidationError,
  normalizeWorkspaceAppId,
} from "@agent-native/core/shared";
import { z } from "zod";

import { startWorkspaceAppCreation } from "../server/lib/app-creation-store.js";

const attachmentSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("upload"),
    contentType: z.enum([
      "image/webp",
      "image/png",
      "image/jpeg",
      "image/gif",
      "application/pdf",
      "application/json",
      "text/plain",
    ]),
    name: z.string().min(1),
    dataUrl: z.string(),
    text: z.string().optional(),
    id: z.string().min(1),
  }),
  z.object({
    type: z.literal("url"),
    value: z.string().url(),
  }),
]);

export type StartWorkspaceAppCreationAttachment = z.infer<
  typeof attachmentSchema
>;

export default defineAction({
  description:
    "Start creating a new workspace app under apps/<app-id> from a natural-language prompt and optional template, description, vault secret IDs, workspace resource IDs, and attachments. In local dev this returns a code-agent prompt; in production it starts a Builder Cloud Agent branch on the organization's connected Agent-Native workspace project (or provisions one for organization owners/admins when configured).",
  schema: z.object({
    prompt: z.string().min(1).describe("The user's app creation request"),
    appId: z
      .string()
      .max(64)
      .transform(normalizeWorkspaceAppId)
      .refine((appId) => !getWorkspaceAppIdValidationError(appId), {
        message:
          "Use a non-reserved app id with lowercase letters, numbers, and hyphens.",
      })
      .optional()
      .nullable()
      .describe(
        "Desired workspace app id/path or human-friendly name. Names are converted to lowercase, hyphenated ids.",
      ),
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
    attachments: z
      .array(attachmentSchema)
      .optional()
      .describe(
        "Optional Builder message attachments. Uploads use supported image, PDF, text, or JSON content; attachments are model context, not workspace files.",
      ),
  }),
  run: async (args) => startWorkspaceAppCreation(args),
});
