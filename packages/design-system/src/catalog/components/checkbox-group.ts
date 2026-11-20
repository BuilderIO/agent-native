import { CONTROL_SIZES } from "../../tokens/roles.js";
import {
  colorProp,
  highContrastProp,
  variantProp,
  sizeProp,
} from "../props.js";

export const checkboxGroupProps = {
  size: sizeProp(CONTROL_SIZES, "3"),
  variant: variantProp(["surface", "soft"], "surface"),
  color: colorProp,
  highContrast: highContrastProp,
} as const;
