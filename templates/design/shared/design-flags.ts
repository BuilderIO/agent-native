import { defineFeatureFlag } from "@agent-native/core/feature-flags/registry";

export const DESIGN_REVIEW_PANEL = defineFeatureFlag({
  key: "design-review-panel",
  displayName: "Design review panel",
  description: "Show accessibility and visual-diff review tools in Design.",
});
