import { defineLab, defineLabs } from "@agent-native/core/labs/registry";

export const FULL_APP_BUILDING_LAB = defineLab({
  key: "full-app-building",
  defaultEnabled: false,
  legacyFlagKeys: ["full-app-building"],
  displayName: "Full app building",
  description: "Try building working apps from your designs with Builder.",
  keywords: "apps builder fusion build",
});

export const DESIGN_LABS = defineLabs([FULL_APP_BUILDING_LAB]);
