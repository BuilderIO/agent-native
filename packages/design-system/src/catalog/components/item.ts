import { booleanProp, enumProp, variantProp } from "../props.js";

/** Not in Radix Themes: a row in a list, its size the row's padding. */
export const itemProps = {
  size: enumProp(
    ["1", "2"],
    "Padding: 1 is the compact row, 2 the standard one.",
    "2",
  ),
  variant: variantProp(["ghost", "outline", "soft"], "ghost"),
} as const;

export const itemGroupProps = {
  variant: variantProp(["ghost", "outline"], "ghost"),
} as const;

export const itemMediaProps = {
  framed: booleanProp(
    "Sets an icon in a framed tile; unframed media, an Avatar, stays as it is.",
  ),
} as const;
