import { enumProp, CONTROL_SIZES, sizeProp } from "../props.js";

export const spinnerProps = {
  size: sizeProp(CONTROL_SIZES, "md"),
  loading: {
    type: "boolean",
    default: true,
    description:
      "While false, renders its children in place of the spinner, as Radix Themes does.",
  },
} as const;
