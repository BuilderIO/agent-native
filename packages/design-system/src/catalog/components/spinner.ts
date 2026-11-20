import { enumProp } from "../props.js";

export const spinnerProps = {
  size: enumProp(
    ["1", "2", "3"],
    "Diameter: 1 is 12px, 2 is 16px, 3 is 20px.",
    "2",
  ),
  loading: {
    type: "boolean",
    default: true,
    description:
      "While false, renders its children in place of the spinner, as Radix Themes does.",
  },
} as const;
