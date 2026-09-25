import { defineLab, defineLabs } from "@agent-native/core/labs/registry";

export const PLAN_EDITIONS = defineLab({
  key: "plan.editions",
  displayName: "Editions",
  description:
    "Read the engineering newspaper: what shipped across the org, written from merged PR recaps.",
  keywords: "edition editions newspaper digest issue archive recap news",
});

export const PLAN_LABS = defineLabs([PLAN_EDITIONS]);
