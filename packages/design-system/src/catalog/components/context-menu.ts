import {
  colorProp,
  popupColorProp,
  highContrastProp,
  sizeProp,
  variantProp,
} from "../props.js";

/** The popup: its rows' size and how the highlighted row is filled. */
export const contextMenuPopupProps = {
  size: sizeProp(["sm", "md"], "md", "Row height"),
  variant: variantProp(["solid", "soft"], "soft"),
  color: popupColorProp,
  highContrast: highContrastProp,
} as const;

/** A row: `color` marks a destructive or status item, as in Radix Themes. */
export const contextMenuItemProps = {
  color: colorProp,
} as const;
