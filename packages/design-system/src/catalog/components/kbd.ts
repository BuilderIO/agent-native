import { enumProp, TEXT_SIZES, variantProp } from "../props.js";

export const kbdProps = {
  size: enumProp(
    TEXT_SIZES,
    "A step of the type scale; unset, it follows the surrounding text.",
  ),
  variant: variantProp(["surface", "soft"], "surface"),
} as const;
