import { defineFeatureFlag } from "../feature-flags/registry.js";

/**
 * Enables the signed organization link between independent hosted app stores.
 * It is deliberately separate from browser SSO so identity can be canaried
 * before org provisioning and org context are changed.
 */
export const CROSS_APP_ORG_FEDERATION_FLAG = defineFeatureFlag({
  key: "organization.cross-app-federation",
  displayName: "Cross-app organization federation",
  description:
    "Carry one verified organization identity across independent Agent-Native app deployments.",
});

export const CROSS_APP_ORG_FEDERATION_SCOPE =
  "organization-federation" as const;
