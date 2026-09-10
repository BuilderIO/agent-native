import { repeatBindingTarget, repeatItemVariable } from "@shared/repeat-data";
import {
  duplicateRepeatItem,
  moveRepeatItem,
  removeRepeatItem,
  writeRepeatValue,
} from "@shared/repeat-data-write";

export type RepeatItemOperation =
  | { kind: "remove" }
  | { kind: "duplicate" }
  | { kind: "move"; to: number }
  | { kind: "set-value"; binding: string; value: string };

export type RepeatItemRefusal =
  /** The selection is the layer, which renders every row — no single item. */
  | "no-item"
  /** The collection or field cannot be written from here. */
  | "unwritable";

export type RepeatItemEditResult =
  | { status: "written"; content: string }
  | { status: "refused"; refusal: RepeatItemRefusal; reason: string }
  | { status: "not-a-repeat" };

export interface RepeatItemTarget {
  /** The owning `x-for` expression. */
  xFor: string;
  /** 0-based position in the collection; negative when undetermined. */
  itemIndex: number;
}

/**
 * Source holds one row and the DOM holds N, so reordering or removing a
 * rendered row splices the collection. `refused` must never fall back to the
 * markup path: this row IS data, and editing markup deletes one live row while
 * leaving the array saying otherwise.
 */
export function runRepeatItemEdit(args: {
  content: string;
  target: RepeatItemTarget | null | undefined;
  operation: RepeatItemOperation;
}): RepeatItemEditResult {
  const target = args.target;
  if (!target?.xFor) return { status: "not-a-repeat" };
  if (!Number.isInteger(target.itemIndex) || target.itemIndex < 0) {
    return {
      status: "refused",
      refusal: "no-item",
      reason: `Could not tell which item of "${target.xFor}" this row renders.`,
    };
  }

  if (args.operation.kind === "set-value") {
    return setValue(args.content, target, args.operation);
  }

  const write =
    args.operation.kind === "remove"
      ? removeRepeatItem({
          html: args.content,
          xFor: target.xFor,
          index: target.itemIndex,
        })
      : args.operation.kind === "duplicate"
        ? duplicateRepeatItem({
            html: args.content,
            xFor: target.xFor,
            index: target.itemIndex,
          })
        : moveRepeatItem({
            html: args.content,
            xFor: target.xFor,
            from: target.itemIndex,
            to: args.operation.to,
          });

  return write.status === "written"
    ? { status: "written", content: write.html }
    : { status: "refused", refusal: "unwritable", reason: write.reason };
}

/**
 * An `x-text` row shows a value from the collection, so its text has one home:
 * the item. Rewriting the markup changes nothing — the next render puts the
 * data back.
 */
function setValue(
  content: string,
  target: RepeatItemTarget,
  operation: { binding: string; value: string },
): RepeatItemEditResult {
  const itemVariable = repeatItemVariable(target.xFor);
  if (!itemVariable) {
    return {
      status: "refused",
      refusal: "unwritable",
      reason: `Could not read an item name out of "${target.xFor}".`,
    };
  }
  const bindingTarget = repeatBindingTarget(operation.binding, itemVariable);
  if (!bindingTarget) {
    return {
      status: "refused",
      refusal: "unwritable",
      reason: `"${operation.binding}" is computed, so it has no single value to write.`,
    };
  }
  const write = writeRepeatValue({
    html: content,
    xFor: target.xFor,
    index: target.itemIndex,
    ...(bindingTarget.kind === "field" ? { field: bindingTarget.field } : {}),
    value: operation.value,
  });
  return write.status === "written"
    ? { status: "written", content: write.html }
    : { status: "refused", refusal: "unwritable", reason: write.reason };
}
