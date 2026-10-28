import {
  readRepeatData,
  repeatBindingTarget,
  repeatIndexVariable,
  repeatItemVariable,
} from "@shared/repeat-data";
import {
  duplicateRepeatItem,
  moveRepeatItem,
  removeRepeatItem,
  writeRepeatValue,
  writeRepeatValueByKey,
} from "@shared/repeat-data-write";

export type RepeatItemOperation =
  | { kind: "remove" }
  | { kind: "duplicate" }
  | { kind: "move"; to: number }
  | { kind: "set-value"; binding: string; value: string };

export type RepeatItemRefusal =
  | "no-item"
  /** The collection or field cannot be written from here. */
  | "unwritable";

export type RepeatItemEditResult =
  | { status: "written"; content: string }
  | { status: "refused"; refusal: RepeatItemRefusal; reason: string }
  | { status: "not-a-repeat" };

export interface RepeatItemTarget {
  xFor: string;
  itemIndex: number;
  keyExpression?: string;
  itemKey?: string;
}

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

  let duplicateKeyField: string | undefined;
  if (args.operation.kind === "duplicate" && target.keyExpression) {
    const itemVariable = repeatItemVariable(target.xFor);
    const keyTarget = itemVariable
      ? repeatBindingTarget(target.keyExpression, itemVariable)
      : null;
    if (keyTarget?.kind === "field") {
      duplicateKeyField = keyTarget.field;
    } else if (
      repeatIndexVariable(target.xFor) !== target.keyExpression.trim()
    ) {
      return {
        status: "refused",
        refusal: "unwritable",
        reason: `"${target.keyExpression}" is not a direct item field or the repeat index, so a unique duplicate key cannot be written.`,
      };
    }
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
            ...(duplicateKeyField ? { keyField: duplicateKeyField } : {}),
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
  const collection = readRepeatData(content, target.xFor);
  if (collection.status !== "read") {
    return writeByKey(
      content,
      target,
      bindingTarget,
      operation.value,
      collection.reason,
    );
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

function writeByKey(
  content: string,
  target: RepeatItemTarget,
  bindingTarget: { kind: "item" } | { kind: "field"; field: string },
  value: string,
  collectionReason: string,
): RepeatItemEditResult {
  const itemVariable = repeatItemVariable(target.xFor);
  const keyTarget =
    target.keyExpression && itemVariable
      ? repeatBindingTarget(target.keyExpression, itemVariable)
      : null;
  if (!target.itemKey || keyTarget?.kind !== "field") {
    return {
      status: "refused",
      refusal: "unwritable",
      reason: collectionReason,
    };
  }
  if (bindingTarget.kind !== "field") {
    return {
      status: "refused",
      refusal: "unwritable",
      reason: "A whole item cannot be replaced through its key.",
    };
  }
  const write = writeRepeatValueByKey({
    html: content,
    keyField: keyTarget.field,
    keyValue: target.itemKey,
    field: bindingTarget.field,
    value,
  });
  return write.status === "written"
    ? { status: "written", content: write.html }
    : { status: "refused", refusal: "unwritable", reason: write.reason };
}
