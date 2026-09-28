import { agentNativeApiDisabledReason } from "../api-surface.js";
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

/**
 * `"loading"` is the answer not having arrived yet. `"unavailable"` is the
 * flags being unreadable for this viewer (signed out, no action surface, or a
 * failed read); callers fail closed on it like `useFeatureFlag`, but can tell
 * it apart from a registered flag that evaluated off.
 */
export type FeatureFlagState =
  | { status: "loading"; enabled: false }
  | { status: "ready"; enabled: boolean }
  | { status: "unavailable"; enabled: false };

/**
 * Like `useFeatureFlag`, but reports whether the answer has arrived so a
 * surface can hold a skeleton instead of flashing its flag-off UI first.
 */
export function useFeatureFlagState(key: string): FeatureFlagState {
  const { status } = useSession();
  const apiDisabled = Boolean(agentNativeApiDisabledReason());
  const query = useActionQuery<EvaluatedFeatureFlags>(
    "get-feature-flags" as never,
    undefined,
    { enabled: status === "authenticated" },
  );
  if (apiDisabled) return { status: "unavailable", enabled: false };
  if (status === "loading") return { status: "loading", enabled: false };
  if (status !== "authenticated") {
    return { status: "unavailable", enabled: false };
  }
  if (query.data !== undefined) {
    return {
      status: "ready",
      enabled: featureFlagValue(evaluatedFeatureFlagValues(query.data), key),
    };
  }
  if (query.isError) return { status: "unavailable", enabled: false };
  return { status: "loading", enabled: false };
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
