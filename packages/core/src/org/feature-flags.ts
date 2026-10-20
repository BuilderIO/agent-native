import { defineFeatureFlag } from "../feature-flags/registry.js";

export const CROSS_APP_ORG_FEDERATION_FLAG = defineFeatureFlag({
  key: "organization.cross-app-federation",
  displayName: "Cross-app organization federation",
  description:
    "Carry one verified organization identity across independent Agent-Native app deployments.",
});

export const CROSS_APP_ORG_FEDERATION_SCOPE =
  "organization-federation" as const;
