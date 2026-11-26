import { CONTROL_SIZES, sizeProp } from "../props.js";

/** The size its buttons, toggles and inputs take. */
export const toolbarProps = {
  size: sizeProp(CONTROL_SIZES, "md"),
} as const;
