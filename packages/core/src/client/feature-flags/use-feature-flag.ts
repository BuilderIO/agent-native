import { useActionQuery } from "../use-action.js";
import {
  evaluatedFeatureFlagValues,
  featureFlagValue,
  type EvaluatedFeatureFlags,
} from "./helpers.js";

export type { EvaluatedFeatureFlags } from "./helpers.js";

/**
 * Returns the current user's evaluated value for a registered feature flag.
 * Flags that have not been registered evaluate to false.
 */
export function useFeatureFlag(key: string): boolean {
  const query = useActionQuery<EvaluatedFeatureFlags>(
    "get-feature-flags" as never,
  );
  return featureFlagValue(evaluatedFeatureFlagValues(query.data), key);
}

export function useFeatureFlags(): Record<string, boolean> {
  const query = useActionQuery<EvaluatedFeatureFlags>(
    "get-feature-flags" as never,
  );
  return evaluatedFeatureFlagValues(query.data);
}
