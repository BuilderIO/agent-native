import { enumProp, variantProp } from "../props.js";

export const cardProps = {
  size: enumProp(
    ["1", "2", "3", "4", "5"],
    "Padding: 1 is 8px, 2 12px, 3 16px, 4 24px, 5 32px.",
    "2",
  ),
  variant: variantProp(["surface", "ghost"], "surface"),
} as const;
