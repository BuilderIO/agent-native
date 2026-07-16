import { track } from "../tracking/registry.js";
import {
  evaluateFeatureFlagDecision,
  type FeatureFlagDecision,
  type FeatureFlagScope,
} from "./store.js";

/** Evaluate and explicitly record an exposure after the gated behavior occurs. */
export async function exposeFeatureFlag(
  key: string,
  scope: FeatureFlagScope = {},
  app?: string,
): Promise<FeatureFlagDecision> {
  const decision = await evaluateFeatureFlagDecision(key, scope);
  track(
    "$feature_flag_exposure",
    {
      app,
      flag_key: key,
      value: decision.value,
      reason: decision.reason,
      bucket: decision.bucket,
      rollout_epoch: decision.rolloutEpoch,
      rollout_percentage: decision.rolloutPercentage,
      user_key: decision.userKey,
    },
    { userId: decision.userKey },
  );
  return decision;
}
