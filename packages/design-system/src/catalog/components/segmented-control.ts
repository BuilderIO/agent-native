import { radiusProp, CONTROL_SIZES, sizeProp, variantProp } from "../props.js";

/** Radix Themes' segmented control: one choice among a few, in one track. */
export const segmentedControlProps = {
  size: sizeProp(CONTROL_SIZES, "md"),
  variant: variantProp(["surface", "soft"], "surface"),
  radius: radiusProp,
} as const;
