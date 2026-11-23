import { CONTROL_SIZES, radiusProp, sizeProp } from "../props.js";

export const colorSwatchProps = {
  size: sizeProp(CONTROL_SIZES, "md"),
  radius: radiusProp,
} as const;
