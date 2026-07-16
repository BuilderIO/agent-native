import type { FeatureFlagDecision } from "../../feature-flags/store.js";
import { trackEvent } from "../analytics.js";

const seen = new Set<string>();

/** Explicit exposure tracking; evaluation itself never emits telemetry. */
export function trackFeatureFlagExposure(
  flagKey: string,
  decision: FeatureFlagDecision,
  app?: string,
): void {
  const key = `${decision.userKey ?? "anonymous"}:${flagKey}:${decision.rolloutEpoch ?? "legacy"}`;
  if (seen.has(key)) return;
  seen.add(key);
  trackEvent("$feature_flag_exposure", {
    ...(app ? { app } : {}),
    // The Analytics ingest derives its indexed user_key from this top-level
    // tracking identity. Keep it byte-identical to the decision metadata so
    // exposure and conversion rows can join.
    userId: decision.userKey,
    flag_key: flagKey,
    value: decision.value,
    reason: decision.reason,
    bucket: decision.bucket,
    rollout_epoch: decision.rolloutEpoch,
    rollout_percentage: decision.rolloutPercentage,
    user_key: decision.userKey,
  });
}
