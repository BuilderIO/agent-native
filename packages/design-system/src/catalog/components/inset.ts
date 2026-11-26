import { enumProp } from "../props.js";

/** Lets media inside a Card run to its edges, as Radix Themes' Inset. */
export const insetProps = {
  side: enumProp(
    ["all", "x", "y", "top", "bottom", "left", "right"],
    "The edges it pulls out to.",
    "all",
  ),
  clip: enumProp(
    ["border-box", "padding-box"],
    "Clips its content to the card's border or its padding.",
    "border-box",
  ),
} as const;
