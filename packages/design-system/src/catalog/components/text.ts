import { TEXT_STYLE_NAMES } from "../../tokens/primitives.js";
import { enumProp, TEXT_SIZES, textProps } from "../props.js";

export const textComponentProps = {
  as: enumProp(
    ["span", "div", "label", "p"],
    "The element it renders.",
    "span",
  ),
  textStyle: enumProp(
    TEXT_STYLE_NAMES,
    "A named text style: its size, line height, letter spacing, weight and family. `size` and `weight` override it; unset, it inherits.",
  ),
  size: enumProp(TEXT_SIZES, "A step of the type scale; unset, it inherits."),
  ...textProps,
} as const;
