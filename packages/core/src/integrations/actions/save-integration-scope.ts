import { z } from "zod";

import { defineAction, fail } from "../../action.js";
import { orgAdminAudit } from "../../audit/org-admin.js";
import { requireIntegrationScopeAccess } from "../scope-action-access.js";
import {
  saveIntegrationScope,
  type SaveIntegrationScopeInput,
} from "../scope-store.js";

export default defineAction({
  description:
    "Save a channel or direct-message conversation scope, trust policy, model and agent grants. Organization owners/admins or personal owners only; integration callers are forbidden. Omit allowedAgentIds to preserve existing grants; [] revokes all grants.",
  schema: z.object({
    platform: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .describe("Integration platform, e.g. slack."),
    tenantId: z.string().trim().min(1).max(255).describe("Provider tenant ID."),
    conversationId: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .describe("Provider channel or direct-message conversation ID."),
    conversationType: z
      .enum(["channel", "direct_message", "group_direct_message"])
      .describe(
        "Conversation type: channel, direct_message, or group_direct_message.",
      ),
    trust: z
      .enum(["trusted", "guest", "external_shared", "unknown"])
      .optional()
      .describe("Trust level; defaults to unknown."),
    orgId: z
      .string()
      .trim()
      .min(1)
      .nullable()
      .optional()
      .describe(
        "Organization ID; omit for the current organization, null for a personal scope.",
      ),
    installationId: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .nullable()
      .optional()
      .describe("Provider installation ID; defaults to null."),
    defaultModel: z
      .string()
      .max(200)
      .nullable()
      .optional()
      .describe("Model override; defaults to null."),
    policy: z
      .object({
        requireMention: z
          .boolean()
          .optional()
          .describe("Require a mention; defaults to true."),
        allowDirectMessages: z
          .boolean()
          .optional()
          .describe("Allow direct messages; defaults to false."),
        allowGuests: z
          .boolean()
          .optional()
          .describe("Allow guests; defaults to false."),
        allowExternalShared: z
          .boolean()
          .optional()
          .describe(
            "Allow externally shared conversations; defaults to false.",
          ),
        allowUnknownTrust: z
          .boolean()
          .optional()
          .describe("Allow unknown trust; defaults to false."),
      })
      .optional()
      .describe(
        "Conversation policy; omitted fields use restrictive defaults.",
      ),
    allowedAgentIds: z
      .array(
        z
          .string()
          .min(1)
          .refine((id) => id === id.trim(), "Agent IDs must be trimmed"),
      )
      .optional()
      .describe(
        "Allowed agent profile IDs. Omit to preserve existing grants; [] revokes all. New scopes default to no grants.",
      ),
  }) satisfies z.ZodType<SaveIntegrationScopeInput>,
  toolCallable: false,
  audit: orgAdminAudit({
    targetType: "integration-scope",
    targetId: (args) =>
      `${args.platform}:${args.tenantId}:${args.conversationId}`,
    summary: (args) => `Saved ${args.platform} conversation scope`,
  }),
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
  run: async (args, ctx) => {
    const access = await requireIntegrationScopeAccess(ctx, true);
    if (args.orgId && args.orgId !== access.orgId) {
      fail("Not authorized to manage an integration scope for that org", {
        statusCode: 403,
        errorCode: "forbidden",
      });
    }
    return { scope: await saveIntegrationScope(args, access) };
  },
});
