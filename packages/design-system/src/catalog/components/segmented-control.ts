import { enumProp, radiusProp, sizeProp, variantProp } from "../props.js";

/** Radix Themes' segmented control: one choice among a few, in one track. */
export const segmentedControlProps = {
  size: sizeProp(["2", "3", "4"], "3"),
  variant: variantProp(["surface", "soft"], "surface"),
  radius: radiusProp,
} as const;
