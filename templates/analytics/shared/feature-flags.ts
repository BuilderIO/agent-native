import { defineFeatureFlag } from "@agent-native/core/feature-flags/registry";

export const VERIFIED_FLEET_FLAG_MUTATIONS = defineFeatureFlag({
  key: "analytics.verified-fleet-flag-mutations",
  displayName: "Verified fleet flag mutations",
  description:
    "Verify cross-app feature flag changes with an independent target read-back.",
});

export const RESILIENT_FLEET_FLAG_DIRECTORY = defineFeatureFlag({
  key: "analytics.resilient-fleet-flag-directory",
  displayName: "Resilient fleet flag directory",
  description:
    "Retry transient organization directory failures before changing a feature flag.",
});

export const ANALYTICS_FEATURE_FLAGS = [
  VERIFIED_FLEET_FLAG_MUTATIONS,
  RESILIENT_FLEET_FLAG_DIRECTORY,
];
