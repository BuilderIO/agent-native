import { defineAction } from "@agent-native/core";
import { getWorkspaceAppIdValidationError } from "@agent-native/core/shared";
import { z } from "zod";

import {
  scaffoldWorkspaceAppFromTemplate,
  startWorkspaceAppCreation,
} from "../server/lib/app-creation-store.js";
import { getCuratedWorkspaceTemplate } from "../server/lib/curated-workspace-templates.js";
import { recordAudit } from "../server/lib/dispatch-store.js";

function isLocalAppCreationRuntime(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  if (
    process.env.NETLIFY ||
    process.env.VERCEL ||
    process.env.CF_PAGES ||
    process.env.DEPLOY_URL ||
    process.env.URL ||
    process.env.RENDER ||
    process.env.FLY_APP_NAME
  ) {
    return false;
  }
  return true;
}

function buildRemixPrompt(input: {
  templateName: string;
  templateId: string;
  setupNote: string;
  description?: string | null;
}): string {
  return [
    "Create a private workspace remix of a curated first-party template.",
    `Source template: ${input.templateName} (${input.templateId}).`,
    "Recreate the source template's product shape and capabilities as an independent workspace app.",
    "Never copy source-app data, records, user content, secrets, credentials, tokens, API keys, or private configuration.",
    "Use empty or synthetic seed data only, keep the remix private to the current workspace, and do not create a public demo.",
    `Setup note: ${input.setupNote}`,
    input.description?.trim()
      ? `Requested customization: ${input.description.trim()}`
      : "Keep the first version close to the curated source template while preserving independent ownership.",
  ].join(" ");
}

export default defineAction({
  description:
    "Create a private, independent remix of one of Dispatch's curated first-party workspace templates. Valid templates are mail, calendar, analytics, slides, content, clips, brain, assets, forms, and design. The remix must not copy source-app data, secrets, credentials, or private configuration; local workspaces scaffold the template, while hosted workspaces start a Builder app-creation branch.",
  schema: z.object({
    templateId: z
      .string()
      .min(1)
      .describe(
        "Curated source template id: mail, calendar, analytics, slides, content, clips, brain, assets, forms, or design.",
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
        "Optional target workspace app id. Defaults to <template>-remix so the source app remains independent.",
      ),
    description: z
      .string()
      .max(500)
      .optional()
      .nullable()
      .describe("Optional customization or purpose for the private remix."),
  }),
  run: async (input) => {
    const sourceTemplate = getCuratedWorkspaceTemplate(input.templateId);
    const appId = input.appId?.trim() || `${sourceTemplate.template}-remix`;

    const result = isLocalAppCreationRuntime()
      ? await scaffoldWorkspaceAppFromTemplate({
          template: sourceTemplate.template,
          appId,
        })
      : await startWorkspaceAppCreation({
          prompt: buildRemixPrompt({
            templateName: sourceTemplate.name,
            templateId: sourceTemplate.template,
            setupNote: sourceTemplate.setupNote,
            description: input.description,
          }),
          appId,
          description: input.description,
          template: sourceTemplate.template,
        });

    await recordAudit({
      action: "workspace-app.remix-requested",
      targetType: "workspace-app",
      targetId: appId,
      summary: `Requested private remix of ${sourceTemplate.name}`,
      metadata: {
        sourceTemplate: sourceTemplate.template,
        mode:
          result && typeof result === "object" && "mode" in result
            ? result.mode
            : "local",
        descriptionConfigured: !!input.description?.trim(),
      },
    });

    return { ...result, sourceTemplate };
  },
});
