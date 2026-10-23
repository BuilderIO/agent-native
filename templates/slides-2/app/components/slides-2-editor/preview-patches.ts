import type {
  SlidePreviewPatch,
  SlidePreviewRangeStyle,
} from "../slides-2-runtime/protocol";
import type { SourceEdit } from "./types";

const RANGE_STYLE_KEYS = new Set<SlidePreviewRangeStyle["key"]>([
  "fontFamily",
  "fontSize",
  "fontStyle",
  "fontWeight",
  "color",
]);

export function getPreviewPatches(edits: SourceEdit[]): SlidePreviewPatch[] {
  const byLocator = new Map<string, SlidePreviewPatch>();
  for (const edit of edits) {
    const key = `${edit.line}:${edit.column}`;
    const patch = byLocator.get(key) ?? {
      line: edit.line,
      column: edit.column,
      styles: {},
    };
    for (const op of edit.ops) {
      if (op.kind === "set-style") patch.styles![op.key] = op.value;
      if (op.kind === "set-text") patch.text = op.value;
      const rangeKey =
        op.kind === "set-text-range-style" &&
        RANGE_STYLE_KEYS.has(op.key as SlidePreviewRangeStyle["key"])
          ? (op.key as SlidePreviewRangeStyle["key"])
          : null;
      if (
        op.kind === "set-text-range-style" &&
        rangeKey &&
        Number.isInteger(op.start) &&
        Number.isInteger(op.end) &&
        op.start >= 0 &&
        op.end > op.start &&
        typeof op.prevText === "string"
      ) {
        patch.rangeStyles ??= [];
        patch.rangeStyles.push({
          start: op.start,
          end: op.end,
          key: rangeKey,
          value: op.value,
          expectedText: op.prevText,
        });
      }
    }
    byLocator.set(key, patch);
  }
  return [...byLocator.values()];
}
