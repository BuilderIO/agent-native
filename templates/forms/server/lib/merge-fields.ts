
import type { FormField } from "../../shared/types.js";

export type FieldOp =
  | { op: "upsert"; field: FormField }
  | { op: "remove"; id: string }
  | { op: "reorder"; ids: string[] };

export function applyFieldOps(
  current: FormField[],
  ops: FieldOp[],
): FormField[] {
  let fields = current.slice();

  for (const op of ops) {
    if (op.op === "upsert") {
      const idx = fields.findIndex((f) => f.id === op.field.id);
      if (idx === -1) {
        fields = [...fields, op.field];
      } else {
        fields = [...fields.slice(0, idx), op.field, ...fields.slice(idx + 1)];
      }
    } else if (op.op === "remove") {
      fields = fields.filter((f) => f.id !== op.id);
    } else if (op.op === "reorder") {
      const idSet = new Set(op.ids);
      const unlisted = fields.filter((f) => !idSet.has(f.id));
      const listed = op.ids
        .map((id) => fields.find((f) => f.id === id))
        .filter((f): f is FormField => f !== undefined);
      fields = [...listed, ...unlisted];
    }
  }

  return fields;
}
