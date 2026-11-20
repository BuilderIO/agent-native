import { enumProp, TEXT_SIZES, textProps } from "../props.js";

export const headingProps = {
  as: enumProp(
    ["h1", "h2", "h3", "h4", "h5", "h6"],
    "The heading level it renders.",
    "h1",
  ),
  size: enumProp(TEXT_SIZES, "A step of the type scale.", "6"),
  ...textProps,
} as const;
