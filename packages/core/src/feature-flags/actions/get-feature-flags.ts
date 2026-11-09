import { z } from "zod";

import { defineAction } from "../../action.js";
import { getLabForLegacyFlag } from "../../labs/registry.js";
import { getUserLabStates } from "../../labs/store.js";
import { captureError } from "../../server/capture-error.js";
import { listFeatureFlags } from "../registry.js";
import {
  evaluateStoredFeatureFlagRule,
  featureFlagRuleInEffect,
  getFeatureFlagRulesForKeys,
  readFeatureFlagRuleLayers,
  type FeatureFlagStoredRule,
} from "../store.js";

export default defineAction({
  description:
    "Return the boolean values of every feature flag registered by this app for the current caller. Unknown or unconfigured flags always evaluate to false.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async (_args, ctx) => {
    const scope = { userEmail: ctx?.userEmail, orgId: ctx?.orgId };
    const definitions = listFeatureFlags();
    const rules = await getFeatureFlagRulesForKeys(
      definitions.map(({ key }) => key),
      scope,
    ).catch(async (error) => {
      captureError(error, {
        tags: { source: "feature-flags", op: "get-feature-flags" },
      });
      const fallback = new Map<string, FeatureFlagStoredRule>();
      await Promise.all(
        definitions.map(async ({ key }) => {
          try {
            fallback.set(
              key,
              featureFlagRuleInEffect(
                await readFeatureFlagRuleLayers(key, scope),
              ),
            );
          } catch {
            // coercion-ok: this flag's own read also failed; it evaluates
            // off below, the same false-on-error outcome evaluateFeatureFlag
            // gives any other caller.
          }
        }),
      );
      return fallback;
    });
    const values = Object.fromEntries(
      definitions.map(({ key }) => {
        const stored = rules.get(key);
        try {
          return [
            key,
            !!stored && evaluateStoredFeatureFlagRule(key, stored, scope),
          ];
        } catch {
          return [key, false];
        }
      }),
    );
    const migratedKeys = definitions
      .map(({ key }) => key)
      .filter((key) => getLabForLegacyFlag(key));
    if (migratedKeys.length === 0 || !scope.userEmail) return values;
    const labStates = await getUserLabStates(scope.userEmail, scope);
    for (const key of migratedKeys) {
      const lab = getLabForLegacyFlag(key);
      if (!lab) continue;
      const state = labStates[lab.key];
      if (!state) throw new Error(`Missing migrated lab state: ${lab.key}`);
      if ("error" in state) {
        captureError(
          new Error(
            state.error === "invalid-choice"
              ? `Invalid saved lab choice: ${lab.key}`
              : `Could not resolve saved lab state: ${lab.key}`,
          ),
          {
            tags: {
              source: "feature-flags",
              op: "get-feature-flags",
              lab: lab.key,
              legacyFlag: key,
            },
          },
        );
        values[key] = false;
        continue;
      }
      values[key] =
        state.source === "choice"
          ? state.enabled
          : (state.legacyValues?.[key] ?? false);
    }
    return values;
  },
});
