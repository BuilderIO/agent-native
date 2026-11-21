import {
  colorProp,
  popupColorProp,
  highContrastProp,
  variantProp,
} from "../props.js";

/** The popup: its rows' size and how the highlighted row is filled. */
export const menuPopupProps = {
  variant: variantProp(["solid", "soft"], "soft"),
  color: popupColorProp,
  highContrast: highContrastProp,
} as const;

/** A row: `color` marks a destructive or status item, as in Radix Themes. */
export const menuItemProps = {
  color: colorProp,
} as const;
