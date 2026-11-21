import { colorProp, highContrastProp, variantProp } from "../props.js";

/** Radix Themes' radio cards: a Radio Group whose options are cards. */
export const radioCardsProps = {
  variant: variantProp(["surface", "soft"], "surface"),
  color: colorProp,
  highContrast: highContrastProp,
} as const;
