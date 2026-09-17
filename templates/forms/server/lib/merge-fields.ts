/**
 * Server-side read-modify-write merge for form fields.
 *
 * Each op is applied against the CURRENT database row, not the client's
 * snapshot, so concurrent edits to DIFFERENT fields both survive:
 *
 *   upsert   – insert if the field id is new, otherwise replace in-place
 *   remove   – delete a field by id (no-op if missing)
 *   reorder  – reorder the whole array by providing an ordered list of ids
 *              (fields not listed are appended in their current order)
 *
 * Callers must run the returned array through assertValidFields before
 * persisting.
 */

import type { FormField } from "../../shared/types.js";

export type FieldOp =
  | { op: "upsert"; field: FormField }
  | { op: "remove"; id: string }
  | { op: "reorder"; ids: string[] };

/**
 * Apply a sequence of field operations against the current field array.
 * Returns the new array; does NOT mutate the input.
 */
export function applyFieldOps(
  current: FormField[],
  ops: FieldOp[],
): FormField[] {
  let fields = current.slice();

  for (const op of ops) {
    if (op.op === "upsert") {
      const idx = fields.findIndex((f) => f.id === op.field.id);
      if (idx === -1) {
        // New field — append.
        fields = [...fields, op.field];
      } else {
        // Existing field — replace in-place to preserve position.
        fields = [...fields.slice(0, idx), op.field, ...fields.slice(idx + 1)];
      }
    } else if (op.op === "remove") {
      fields = fields.filter((f) => f.id !== op.id);
    } else if (op.op === "reorder") {
      const idSet = new Set(op.ids);
      // Preserve fields not mentioned in the ids list.
      const unlisted = fields.filter((f) => !idSet.has(f.id));
      const listed = op.ids
        .map((id) => fields.find((f) => f.id === id))
        .filter((f): f is FormField => f !== undefined);
      fields = [...listed, ...unlisted];
    }
  }

  return fields;
}
