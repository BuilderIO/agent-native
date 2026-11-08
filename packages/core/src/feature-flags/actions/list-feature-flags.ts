import { z } from "zod";

import { defineAction } from "../../action.js";
import { getLabForLegacyFlag } from "../../labs/registry.js";
import { getFeatureFlagManagerAccess } from "../permissions.js";
import { listFeatureFlags } from "../registry.js";
import {
  defaultFeatureFlagRules,
  evaluateFeatureFlagRules,
  readFeatureFlagRuleLayers,
} from "../store.js";

const forbidden = {
  contractVersion: 1,
  status: "forbidden" as const,
  reason: "forbidden" as const,
  flags: [],
  canManage: false,
};

export default defineAction({
  description:
    "List this app's registered feature flags for an operator. Each flag reports the global rule, the active organization's own rule, which of the two is in effect for that organization, and whether the caller can change each one; a rule that could not be read is reported as unreadable, never as off. Organization owners/admins and this app's feature flag admin list only.",
  schema: z.object({}),
  http: { method: "GET" },
  toolCallable: false,
  run: async (_args, ctx) => {
    const definitions = listFeatureFlags();
    const access = await getFeatureFlagManagerAccess(ctx ?? {});
    if (!access.canManageOrg && !access.canManageGlobal) return forbidden;
    if (definitions.length === 0)
      return {
        contractVersion: 1,
        status: "no-definitions" as const,
        reason: "no-definitions" as const,
        flags: [],
        canManage: true,
      };
    const flags = await Promise.all(
      definitions.map(async (definition) => {
        const layers = await readFeatureFlagRuleLayers(definition.key, access);
        const inEffect =
          layers.inEffect === "org"
            ? layers.org
            : layers.inEffect === "global"
              ? layers.global
              : null;
        const rules = !inEffect
          ? defaultFeatureFlagRules()
          : inEffect.state === "set"
            ? inEffect.rules
            : null;
        const movedToLab = getLabForLegacyFlag(definition.key)?.key;
        return {
          ...definition,
          ...(movedToLab && { movedToLab, canManage: false }),
          ...(rules && {
            rules,
            enabledForCurrentUser: evaluateFeatureFlagRules(
              definition.key,
              rules,
              {
                userEmail: access.email,
                userKey: access.email,
                orgId: access.orgId,
              },
            ),
          }),
          scopes: {
            inEffect: layers.inEffect,
            global: { ...layers.global, canManage: access.canManageGlobal },
            org: layers.org && {
              ...layers.org,
              canManage: access.canManageOrg,
            },
          },
        };
      }),
    );
    return {
      contractVersion: 1,
      status: "ready" as const,
      reason: "ready" as const,
      flags,
      canManage: true,
    };
  },
});
