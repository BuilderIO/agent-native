import { defineLab, defineLabs } from "@agent-native/core/labs/registry";

export const FULL_APP_BUILDING_LAB = defineLab({
  key: "full-app-building",
  defaultEnabled: false,
  legacyFlagKeys: ["full-app-building"],
  displayName: "Full app building",
  description: "Try building working apps from your designs with Builder.",
  keywords: "apps builder fusion build",
});

export const DESIGN_MOTION_LAB = defineLab({
  key: "design-motion",
  defaultEnabled: false,
  displayName: "Motion",
  description: "Create and edit motion tracks on your designs.",
  keywords: "motion animation timeline keyframes",
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
  DESIGN_MOTION_LAB,
  ANNOTATE_LAB,
]);
