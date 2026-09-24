import { useActionQuery } from "../use-action.js";
import { useSession } from "../use-session.js";
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
  // get-feature-flags requires a real session. Gating on it avoids firing a
  // request that 401s for every signed-out visitor (anonymous/capability-only
  // surfaces like signed-out visual-edit) — the flag still defaults to false
  // with no data, matching what that 401 produced before this gate existed.
  const { status } = useSession();
  const query = useActionQuery<EvaluatedFeatureFlags>(
    "get-feature-flags" as never,
    undefined,
    { enabled: status === "authenticated" },
  );
  return featureFlagValue(evaluatedFeatureFlagValues(query.data), key);
}

export function useFeatureFlags(): Record<string, boolean> {
  const { status } = useSession();
  const query = useActionQuery<EvaluatedFeatureFlags>(
    "get-feature-flags" as never,
    undefined,
    { enabled: status === "authenticated" },
  );
  return evaluatedFeatureFlagValues(query.data);
}
