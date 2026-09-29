import { z } from "zod";

import { defineAction } from "../../action.js";
import { captureError } from "../../server/capture-error.js";
import { listFeatureFlags } from "../registry.js";
import {
  defaultFeatureFlagRules,
  evaluateFeatureFlagRules,
  getFeatureFlagRules,
  getFeatureFlagRulesForKeys,
  type FeatureFlagRules,
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
      const fallback = new Map<string, FeatureFlagRules>();
      await Promise.all(
        definitions.map(async ({ key }) => {
          try {
            fallback.set(key, await getFeatureFlagRules(key, scope));
          } catch {
            // coercion-ok: this flag's own read also failed; it defaults to
            // off below via defaultFeatureFlagRules, the same false-on-error
            // outcome evaluateFeatureFlag gives any other caller.
          }
        }),
      );
      return fallback;
    });
    const values = Object.fromEntries(
      definitions.map(({ key }) => {
        try {
          return [
            key,
            evaluateFeatureFlagRules(
              key,
              rules.get(key) ?? defaultFeatureFlagRules(),
              scope,
            ),
          ];
        } catch {
          return [key, false];
        }
      }),
    );
    return values;
  },
});
