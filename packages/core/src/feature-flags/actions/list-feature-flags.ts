import { z } from "zod";

import { defineAction } from "../../action.js";
import { getLabForLegacyFlag } from "../../labs/registry.js";
import { getFeatureFlagManagerAccess } from "../permissions.js";
import { listFeatureFlags } from "../registry.js";
import {
  defaultFeatureFlagRules,
  evaluateStoredFeatureFlagRule,
  featureFlagRuleInEffect,
  FeatureFlagRulesError,
  readFeatureFlagRuleLayersForKeys,
  type FeatureFlagStoredRule,
} from "../store.js";

const forbidden = {
  contractVersion: 1,
  status: "forbidden" as const,
  reason: "forbidden" as const,
  flags: [],
  canManage: false,
};

/**
 * A rule the caller can't change shows who it reaches, not who is on it: its
 * email and organization lists can name people in other organizations.
 */
function asSeenBy(stored: FeatureFlagStoredRule, canManage: boolean) {
  if (canManage || stored.state === "unset") return { ...stored, canManage };
  if (stored.state === "unreadable")
    return { state: "unreadable" as const, canManage };
  const { mode, emails, orgIds, percentage, updatedAt } = stored.rules;
  return {
    state: "withheld" as const,
    summary: {
      mode,
      emailCount: emails.length,
      orgIdCount: orgIds.length,
      percentage,
      updatedAt,
    },
    canManage,
  };
}

export default defineAction({
  description:
    "List this app's registered feature flags for an operator. Each flag reports the global rule, the active organization's own rule, which of the two is in effect for that organization, and whether the caller can change each one; a rule that could not be read is reported as unreadable, never as off, and evaluates off. A rule the caller can't change is reported as withheld, with its mode, percentage, and how many emails and organizations it targets, but not which. Organization owners/admins and this app's feature flag admin list only.",
  schema: z.object({}),
  http: { method: "GET" },
  toolCallable: false,
  run: async (_args, ctx) => {
    const definitions = listFeatureFlags();
    const access = await getFeatureFlagManagerAccess(ctx);
    if (!access.canManageOrg && !access.canManageGlobal) return forbidden;
    if (definitions.length === 0)
      return {
        contractVersion: 1,
        status: "no-definitions" as const,
        reason: "no-definitions" as const,
        flags: [],
        canManage: true,
      };
    const layersByKey = await readFeatureFlagRuleLayersForKeys(
      definitions.map(({ key }) => key),
      access,
    );
    const flags = definitions.map((definition) => {
      const layers = layersByKey.get(definition.key);
      if (!layers)
        throw new FeatureFlagRulesError(
          "unregistered",
          definition.key,
          "unregistered while it was being listed",
        );
      const inEffect = featureFlagRuleInEffect(layers);
      const canManageInEffect =
        layers.inEffect === "org"
          ? access.canManageOrg
          : access.canManageGlobal;
      const rules =
        inEffect.state === "unset"
          ? defaultFeatureFlagRules()
          : inEffect.state === "set" && canManageInEffect
            ? inEffect.rules
            : null;
      const movedToLab = getLabForLegacyFlag(definition.key)?.key;
      return {
        ...definition,
        ...(movedToLab && { movedToLab, canManage: false }),
        ...(rules && { rules }),
        enabledForCurrentUser: evaluateStoredFeatureFlagRule(
          definition.key,
          inEffect,
          {
            userEmail: access.email,
            userKey: access.email,
            orgId: access.orgId,
          },
        ),
        scopes: {
          inEffect: layers.inEffect,
          global: asSeenBy(layers.global, access.canManageGlobal),
          org: layers.org && {
            ...asSeenBy(layers.org, access.canManageOrg),
            orgId: layers.org.orgId,
          },
        },
      };
    });
    return {
      contractVersion: 1,
      status: "ready" as const,
      reason: "ready" as const,
      flags,
      canManage: true,
    };
  },
});
