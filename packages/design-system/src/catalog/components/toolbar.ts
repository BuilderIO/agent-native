import { sizeProp } from "../props.js";

/** The size its buttons, toggles and inputs take. */
export const toolbarProps = {
  size: sizeProp(["2", "3", "4"], "3"),
} as const;
