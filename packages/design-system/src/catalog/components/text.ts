import { enumProp, TEXT_SIZES, textProps } from "../props.js";

export const textComponentProps = {
  as: enumProp(
    ["span", "div", "label", "p"],
    "The element it renders.",
    "span",
  ),
  size: enumProp(TEXT_SIZES, "A step of the type scale; unset, it inherits."),
  ...textProps,
} as const;
