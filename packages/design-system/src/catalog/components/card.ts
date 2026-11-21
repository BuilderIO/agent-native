import { variantProp } from "../props.js";

export const cardProps = {
  variant: variantProp(["surface", "ghost"], "surface"),
} as const;
