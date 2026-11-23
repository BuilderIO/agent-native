import {
  cellContentsSchema,
  withoutPendingCellEdit,
  type CellContents,
} from "@/lib/model/contracts";

const ENVELOPE = "agent-native-analytics-cell";

export function encodeCellForClipboard(contents: CellContents): string {
  const {
    id: _id,
    order: _order,
    parentSectionId: _parent,
    ...rest
  } = withoutPendingCellEdit(contents);
  return JSON.stringify({ [ENVELOPE]: 1, contents: rest });
}

/** Returns the copied cell's contents, or null when the text is not a copied cell. */
export function decodeCellFromClipboard(
  text: string,
): Omit<CellContents, "id" | "order"> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // coercion-ok: text that is not JSON is simply not a copied cell, and null says so
    return null;
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    (parsed as Record<string, unknown>)[ENVELOPE] !== 1
  ) {
    return null;
  }
  const raw = (parsed as { contents?: unknown }).contents;
  if (typeof raw !== "object" || raw === null) return null;
  const result = cellContentsSchema.safeParse({ id: "x", order: "x", ...raw });
  if (!result.success) return null;
  const {
    id: _id,
    order: _order,
    parentSectionId: _parent,
    ...rest
  } = result.data;
  return rest;
}
