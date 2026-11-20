import {
  colorProp,
  enumProp,
  highContrastProp,
  variantProp,
} from "../props.js";

/** Radix Themes' radio cards: a Radio Group whose options are cards. */
export const radioCardsProps = {
  size: enumProp(["1", "2", "3"], "Padding and type step of each card.", "2"),
  variant: variantProp(["surface", "soft"], "surface"),
  color: colorProp,
  highContrast: highContrastProp,
} as const;
