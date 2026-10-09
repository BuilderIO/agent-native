import { defineLab, defineLabs } from "@agent-native/core/labs/registry";

export const FULL_APP_BUILDING_LAB = defineLab({
  key: "full-app-building",
  defaultEnabled: false,
  legacyFlagKeys: ["full-app-building"],
  displayName: "Full app building",
  description: "Try building working apps from your designs with Builder.",
  keywords: "apps builder fusion build",
});

export const DESIGN_REVIEW_TOOLS_LAB = defineLab({
  key: "design-review-panel",
  defaultEnabled: false,
  legacyFlagKeys: ["design-review-panel"],
  displayName: "Design review tools",
  description:
    "Check your designs for accessibility issues and compare visual changes.",
  keywords: "review accessibility visual changes compare",
});

export const ANNOTATE_LAB = defineLab({
  key: "design.annotate",
  defaultEnabled: false,
  displayName: "Annotate",
  description: "Draw on your designs and send the drawing to the agent.",
  keywords: "annotate draw sketch markup brush",
});

export const DESIGN_LABS = defineLabs([
  FULL_APP_BUILDING_LAB,
  DESIGN_REVIEW_TOOLS_LAB,
  ANNOTATE_LAB,
]);
