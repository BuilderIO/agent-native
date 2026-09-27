import { useActionQuery } from "../use-action.js";
import { useSession } from "../use-session.js";
import {
  evaluatedFeatureFlagValues,
  featureFlagValue,
  type EvaluatedFeatureFlags,
} from "./helpers.js";

export type { EvaluatedFeatureFlags } from "./helpers.js";

export function useFeatureFlag(key: string): boolean {
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
