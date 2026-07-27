import { defineAction } from "@agent-native/core";
import { getWorkspaceAppIdValidationError } from "@agent-native/core/shared";
import { z } from "zod";

import { scaffoldWorkspaceAppFromTemplate } from "../server/lib/app-creation-store.js";

function userFacingActionError(err: unknown): Error & { statusCode: number } {
  const message =
    err instanceof Error && err.message ? err.message : String(err);
  const error = new Error(
    message || "Could not scaffold workspace app.",
  ) as Error & { statusCode: number };
  error.statusCode = 400;
  return error;
}

export default defineAction({
  description:
    "Scaffold a first-party template (mail, calendar, slides, etc.) into apps/<id>/ in the current workspace. Local-dev only — runs `agent-native add-app` as a subprocess. The workspace gateway picks the new app up automatically and serves it at /<id>. For natural-language app creation, call start-workspace-app-creation instead.",
  schema: z.object({
    template: z
      .string()
      .min(1)
      .describe(
        "Template name (mail, calendar, slides, content, clips, analytics, forms, design, assets)",
      ),
    appId: z
      .string()
      .max(64)
      .optional()
      .nullable()
      .refine((appId) => !appId || !getWorkspaceAppIdValidationError(appId), {
        message:
          "Use a non-reserved app id with lowercase letters, numbers, and hyphens.",
      })
      .describe(
        "Optional override for the apps/<id>/ directory name; defaults to the template name",
      ),
  }),
  run: async (input) => {
    try {
      return await scaffoldWorkspaceAppFromTemplate({
        template: input.template,
        appId: input.appId ?? null,
      });
    } catch (err) {
      throw userFacingActionError(err);
    }
  },
});
