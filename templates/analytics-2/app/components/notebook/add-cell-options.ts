import type { CellKind } from "@/lib/model/cell-types";

import { RENDERABLE_INPUT_TYPES } from "./InputCellControl";
import type { AddCellOptions } from "./types";

/**
 * The add-cell request needs a parameter type for an input cell: the action refuses
 * `kind: "input"` without one ("Choose the input's parameter type"), and the plain
 * "Inputs" button in the toolbar has no type to offer yet. Sending the first
 * renderable type keeps that button working and lets the person change the type on
 * the cell instead of clicking a control that only errors (sprint-analytics-2 A02).
 */
export function addCellOptions(
  kind: CellKind,
  options: AddCellOptions | undefined,
): AddCellOptions | undefined {
  if (kind !== "input") return options;
  if (options?.inputType !== undefined) return options;
  const fallback = RENDERABLE_INPUT_TYPES[0];
  if (fallback === undefined) return options;
  return { ...(options ?? {}), inputType: fallback };
}
