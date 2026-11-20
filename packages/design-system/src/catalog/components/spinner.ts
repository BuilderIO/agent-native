import { CONTROL_SIZES } from "../../tokens/roles.js";
import { enumProp, sizeProp } from "../props.js";

export const spinnerProps = {
  size: sizeProp(CONTROL_SIZES, "3"),
  loading: {
    type: "boolean",
    default: true,
    description:
      "While false, renders its children in place of the spinner, as Radix Themes does.",
  },
} as const;
