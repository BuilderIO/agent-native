import {
  duplicateRepeatItem,
  moveRepeatItem,
  removeRepeatItem,
} from "@shared/repeat-data-write";

export type RepeatItemOperation =
  | { kind: "remove" }
  | { kind: "duplicate" }
  | { kind: "move"; to: number };

export type RepeatItemEditResult =
  | { status: "written"; content: string }
  | { status: "refused"; reason: string }
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
      reason: `Could not tell which item of "${target.xFor}" this row renders.`,
    };
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
    : { status: "refused", reason: write.reason };
}
