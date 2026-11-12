import { z } from "zod";

import { defineAction, fail } from "../../action.js";
import { getLabForLegacyFlag } from "../../labs/registry.js";
import { getOrgDomain } from "../../org/context.js";
import { requireFeatureFlagManager } from "../permissions.js";
import { getFeatureFlagDefinition } from "../registry.js";
import {
  defaultFeatureFlagRules,
  FeatureFlagRulesError,
  mutateFeatureFlagRules,
  normalizeFeatureFlagRules,
  replaceFeatureFlagRules,
} from "../store.js";

const rulesSchema = z.object({
  mode: z.enum(["off", "on", "rules"]),
  emails: z.array(z.string().email()).max(500).optional(),
  orgIds: z.array(z.string().min(1).max(200)).max(500).optional(),
  percentage: z.number().int().min(0).max(100).optional(),
});

const scopeSchema = z
  .enum(["org", "global"])
  .optional()
  .describe(
    "`org` writes the active organization's own rule, which overrides the global rule there (owners/admins); `global` writes the rule for every organization (feature flag admin list). Defaults to `org`, or `global` without an organization.",
  );

const schema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("enable-for-current-user"),
    key: z.string(),
    scope: scopeSchema,
  }),
  z.object({
    operation: z.literal("off"),
    key: z.string(),
    scope: scopeSchema,
  }),
  z.object({
    operation: z.literal("replace-rules"),
    key: z.string(),
    scope: scopeSchema,
    rules: rulesSchema,
  }),
]);

export default defineAction({
  description:
    "Change one registered feature flag: enable it for the current user, turn it off, or replace its rules. Returns which rule was written.",
  schema,
  agentInputSchema: z.object({
    operation: z.enum(["enable-for-current-user", "off", "replace-rules"]),
    key: z.string(),
    scope: scopeSchema,
    rules: rulesSchema.optional(),
  }),
  toolCallable: false,
  audit: {
    target: (args, _result, meta) => ({
      type: "feature-flag",
      id: args.key,
      ownerEmail: meta.userEmail,
      visibility: meta.orgId ? "org" : "private",
    }),
    summary: (args, result) => {
      const written = (result as { scope?: { kind?: string } } | undefined)
        ?.scope?.kind;
      return `Feature flag ${args.key}: ${args.operation}${written ? ` (${written})` : ""}`;
    },
  },
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
  run: async (args, ctx) => {
    const manager = await requireFeatureFlagManager(ctx, args.scope);
    if (!getFeatureFlagDefinition(args.key)) {
      throw new Error(`Unknown feature flag: ${args.key}`);
    }
    const movedToLab = getLabForLegacyFlag(args.key);
    if (movedToLab) {
      throw new Error(
        `Feature flag ${args.key} is managed in Labs (${movedToLab.key}).`,
      );
    }
    const orgDomain = manager.orgId
      ? (await getOrgDomain(manager.orgId))?.trim().toLowerCase() || null
      : null;
    if (ctx?.caller === "a2a" && manager.orgId && !orgDomain) {
      throw new Error("Feature flag organization domain is unavailable.");
    }

    const changed = { updatedAt: Date.now(), updatedBy: manager.email };
    const scope = { orgId: manager.orgId };
    const enableForCurrentUser = async () => {
      try {
        return await mutateFeatureFlagRules(args.key, scope, (current) => ({
          ...normalizeFeatureFlagRules({
            ...current,
            mode: current.mode === "on" ? "on" : "rules",
            emails: [...current.emails, manager.email],
          }),
          ...changed,
        }));
      } catch (error) {
        if (!(error instanceof FeatureFlagRulesError)) throw error;
        return fail(error.message, {
          errorCode:
            error.code === "follows-global"
              ? "follows_global_rule"
              : "rule_unreadable",
          statusCode: 409,
        });
      }
    };
    const persistedRules =
      args.operation === "enable-for-current-user"
        ? await enableForCurrentUser()
        : await replaceFeatureFlagRules(args.key, scope, {
            ...(args.operation === "off"
              ? defaultFeatureFlagRules()
              : normalizeFeatureFlagRules(args.rules)),
            ...changed,
          });
    return {
      contractVersion: 2 as const,
      status: "ready" as const,
      key: args.key,
      rules: persistedRules,
      scope: { kind: manager.scope, orgId: manager.orgId, orgDomain },
    };
  },
});
