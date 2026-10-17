import { defineFeatureFlag } from "@agent-native/core/feature-flags/registry";

export const DESIGN_SYSTEM_WORKFLOWS = defineFeatureFlag({
  key: "design-system-workflows",
  displayName: "Design system workflows",
  description: "Enable creation and setup of new design systems.",
});
