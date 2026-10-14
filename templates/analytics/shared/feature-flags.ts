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

export const SIGMA_DASHBOARD_MIGRATION = defineFeatureFlag({
  key: "analytics.sigma-dashboard-migration",
  displayName: "Sigma dashboard migration",
  description:
    "Import Sigma workbooks into private Analytics dashboards with visible review warnings.",
});

export const ANALYTICS_FEATURE_FLAGS = [
  VERIFIED_FLEET_FLAG_MUTATIONS,
  RESILIENT_FLEET_FLAG_DIRECTORY,
  SIGMA_DASHBOARD_MIGRATION,
];
