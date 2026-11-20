import { CONTROL_SIZES } from "../../tokens/roles.js";
import {
  colorProp,
  enumProp,
  radiusProp,
  sizeProp,
  variantProp,
} from "../props.js";

export const textAreaProps = {
  size: sizeProp(
    CONTROL_SIZES,
    "3",
    "The height of the Input it matches, which sets its padding and type",
  ),
  variant: variantProp(["surface", "soft"], "surface"),
  color: colorProp,
  radius: radiusProp,
  resize: enumProp(
    ["none", "vertical", "horizontal", "both"],
    "Which way the reader can resize it.",
    "vertical",
  ),
} as const;
