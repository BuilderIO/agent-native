import { variantProp } from "../props.js";

export const kbdProps = {
  variant: variantProp(["surface", "soft"], "surface"),
} as const;
