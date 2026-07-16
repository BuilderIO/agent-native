import { useEffect } from "react";

import type { FeatureFlagDecision } from "../../feature-flags/store.js";
import { useActionQuery } from "../use-action.js";
import { trackFeatureFlagExposure } from "./exposure.js";
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

/** Tracks an exposure only after the consuming surface mounts. */
export function useFeatureFlagExposure(key: string, enabled = true): boolean {
  const query = useActionQuery<FeatureFlagDecision>(
    "get-feature-flag-decision" as never,
    { key } as never,
  );
  const value = query.data?.value ?? false;
  useEffect(() => {
    if (enabled && query.data) trackFeatureFlagExposure(key, query.data);
  }, [enabled, key, query.data, value]);
  return value;
}
