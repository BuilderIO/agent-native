import { z } from "zod";

import { defineAction } from "../../action.js";
import { captureError } from "../../server/capture-error.js";
import { listFeatureFlags } from "../registry.js";
import {
  defaultFeatureFlagRules,
  evaluateFeatureFlagRules,
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
    // One batched rules read for the whole registry instead of up to 2
    // settings queries per flag; a read failure here fails every flag the
    // same way a per-flag store failure already did (see evaluateFeatureFlag).
    // coercion-ok: flags must never become an availability dependency, so a
    // failed rules read still falls back to every flag off — but the read
    // failure is captured so the fallback isn't a silent outage.
    const rules = await getFeatureFlagRulesForKeys(
      definitions.map(({ key }) => key),
      scope,
    ).catch((error) => {
      captureError(error, {
        tags: { source: "feature-flags", op: "get-feature-flags" },
      });
      return new Map<string, FeatureFlagRules>();
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
          // A feature flag must never become an availability dependency.
          return [key, false];
        }
      }),
    );
    return values;
  },
});
