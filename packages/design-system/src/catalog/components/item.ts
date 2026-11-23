import { booleanProp, variantProp } from "../props.js";

/** Not in Radix Themes: a row in a list, its size the row's padding. */
export const itemProps = {
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
