import { RETIRED_ENABLED_FLAG_KEYS } from "../../feature-flags/registry.js";
import { agentNativeApiDisabledReason } from "../api-surface.js";
import { useActionQuery } from "../use-action.js";
import { useSession } from "../use-session.js";
import {
  evaluatedFeatureFlagValues,
  featureFlagValue,
  type EvaluatedFeatureFlags,
} from "./helpers.js";

export type { EvaluatedFeatureFlags } from "./helpers.js";

const retryUnavailableFlags = (query: { state: { status: string } }) =>
  query.state.status === "error" ? 60_000 : false;

export function useFeatureFlag(key: string): boolean {
  const { status } = useSession();
  const query = useActionQuery<EvaluatedFeatureFlags>(
    "get-feature-flags" as never,
    undefined,
    {
      enabled: status === "authenticated",
      batchInitial: true,
      refetchInterval: retryUnavailableFlags,
    },
  );
  if (RETIRED_ENABLED_FLAG_KEYS.has(key)) return true;
  if (query.isError) return false;
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
export function useFeatureFlagState(
  key: string,
  options?: { freshOnMount?: boolean },
): FeatureFlagState {
  const { status, session } = useSession();
  const apiDisabled = Boolean(agentNativeApiDisabledReason());
  const scope = JSON.stringify([
    session?.authUserId ?? session?.userId ?? session?.email ?? null,
    session?.orgId ?? null,
    key,
  ]);
  const query = useActionQuery<EvaluatedFeatureFlags>(
    "get-feature-flags" as never,
    undefined,
    {
      enabled: status === "authenticated",
      batchInitial: true,
      refetchInterval: retryUnavailableFlags,
      ...(options?.freshOnMount
        ? {
            staleTime: 0,
            refetchOnMount: "always" as const,
            queryKeyScope: ["fresh-on-mount", scope],
          }
        : {}),
    },
  );
  if (RETIRED_ENABLED_FLAG_KEYS.has(key)) {
    return { status: "ready", enabled: true };
  }
  if (apiDisabled) return { status: "unavailable", enabled: false };
  if (status === "loading") return { status: "loading", enabled: false };
  if (status !== "authenticated") {
    return { status: "unavailable", enabled: false };
  }
  if (query.isError) return { status: "unavailable", enabled: false };
  if (options?.freshOnMount && !query.isFetchedAfterMount)
    return { status: "loading", enabled: false };
  if (query.data !== undefined) {
    return {
      status: "ready",
      enabled: featureFlagValue(evaluatedFeatureFlagValues(query.data), key),
    };
  }
  return { status: "loading", enabled: false };
}

export function useFeatureFlags(): Record<string, boolean> {
  const { status } = useSession();
  const query = useActionQuery<EvaluatedFeatureFlags>(
    "get-feature-flags" as never,
    undefined,
    {
      enabled: status === "authenticated",
      batchInitial: true,
      refetchInterval: retryUnavailableFlags,
    },
  );
  return query.isError ? {} : evaluatedFeatureFlagValues(query.data);
}
