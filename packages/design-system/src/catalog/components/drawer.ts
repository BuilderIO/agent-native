import { enumProp } from "../props.js";

export const drawerProps = {
  side: enumProp(
    ["top", "right", "bottom", "left"],
    "The edge the drawer slides in from.",
    "bottom",
  ),
} as const;
