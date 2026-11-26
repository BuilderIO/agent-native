import { colorProp, highContrastProp, variantProp } from "../props.js";

/** Radix Themes' checkbox cards: a Checkbox Group whose options are cards. */
export const checkboxCardsProps = {
  variant: variantProp(["surface", "soft"], "surface"),
  color: colorProp,
  highContrast: highContrastProp,
} as const;
