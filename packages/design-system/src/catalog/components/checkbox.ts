import {
  colorProp,
  enumProp,
  highContrastProp,
  variantProp,
} from "../props.js";

export const checkboxProps = {
  size: enumProp(["1", "2", "3"], "Box: 1 is 12px, 2 is 16px, 3 is 20px.", "2"),
  variant: variantProp(["surface", "soft"], "surface"),
  color: colorProp,
  highContrast: highContrastProp,
} as const;
