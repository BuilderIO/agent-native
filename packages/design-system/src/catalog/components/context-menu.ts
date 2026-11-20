import {
  colorProp,
  popupColorProp,
  highContrastProp,
  sizeProp,
  variantProp,
} from "../props.js";

/** The popup: its rows' size and how the highlighted row is filled. */
export const contextMenuContentProps = {
  size: sizeProp(["2", "3"], "3", "Row height"),
  variant: variantProp(["solid", "soft"], "soft"),
  color: popupColorProp,
  highContrast: highContrastProp,
} as const;

/** A row: `color` marks a destructive or status item, as in Radix Themes. */
export const contextMenuItemProps = {
  color: colorProp,
} as const;
