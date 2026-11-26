import { TEXT_STYLE_NAMES } from "../../tokens/primitives.js";
import { enumProp, TEXT_SIZES, textProps } from "../props.js";

export const headingProps = {
  as: enumProp(
    ["h1", "h2", "h3", "h4", "h5", "h6"],
    "The heading level it renders.",
    "h1",
  ),
  textStyle: enumProp(
    TEXT_STYLE_NAMES,
    "A named text style: its size, line height, letter spacing, weight and family. `size` and `weight` override it.",
    "title-large",
  ),
  size: enumProp(
    TEXT_SIZES,
    "A step of the type scale, overriding the text style's.",
  ),
  ...textProps,
} as const;
