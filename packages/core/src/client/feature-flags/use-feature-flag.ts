import { agentNativeApiDisabledReason } from "../api-surface.js";
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
