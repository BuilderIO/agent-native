import { enumProp, variantProp } from "../props.js";

export const tableProps = {
  variant: variantProp(["surface", "ghost"], "ghost"),
  layout: enumProp(
    ["auto", "fixed"],
    "The table's column layout algorithm.",
    "auto",
  ),
} as const;

export const tableRowProps = {
  align: enumProp(
    ["start", "center", "end", "baseline"],
    "Where the row's cells sit vertically.",
    "start",
  ),
} as const;

export const tableCellProps = {
  justify: enumProp(
    ["start", "center", "end"],
    "Where the cell's content sits along the row.",
    "start",
  ),
  width: { type: "string", description: "A CSS width for the cell's column." },
  minWidth: { type: "string", description: "A CSS minimum width." },
  maxWidth: { type: "string", description: "A CSS maximum width." },
} as const;
