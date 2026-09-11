import {
  defineLab,
  defineLabs,
} from "@agent-native/core/labs/registry";

export const DESIGN_TWEAKS = defineLab({
  key: "design.tweaks",
  displayName: "Design tweaks",
  description: "Try AI-powered design tweaks.",
  keywords: "tweaks ai edit improve design",
});

export const DESIGN_LABS = defineLabs([DESIGN_TWEAKS]);
