export type MarkdownSuggestionOperation = {
  ordinal: number;
  kind:
    | "insert_text"
    | "delete_text"
    | "replace_text"
    | "add_text_block"
    | "set_inline_mark";
  targetId: "body";
  before: { markdown: string; changedText: string };
  after: { markdown: string; changedText: string };
  anchor: { from: number; to: number; prefix: string; suffix: string };
  schemaVersion: 1;
};

const MARKDOWN_MARK = /(?:\*\*|__|~~|`|\[|\]\([^)]*\))/g;

export function markdownSuggestionOperation(
  before: string,
  after: string,
): MarkdownSuggestionOperation | null {
  if (before === after) return null;
  let from = 0;
  while (from < before.length && before[from] === after[from]) from += 1;
  let suffixLength = 0;
  while (
    suffixLength < before.length - from &&
    suffixLength < after.length - from &&
    before[before.length - suffixLength - 1] ===
      after[after.length - suffixLength - 1]
  ) {
    suffixLength += 1;
  }
  const beforeEnd = before.length - suffixLength;
  const afterEnd = after.length - suffixLength;
  const removed = before.slice(from, beforeEnd);
  const inserted = after.slice(from, afterEnd);
  const sameUnmarkedText =
    removed.replace(MARKDOWN_MARK, "") === inserted.replace(MARKDOWN_MARK, "");
  const kind =
    sameUnmarkedText && removed !== inserted
      ? "set_inline_mark"
      : !removed
        ? inserted.includes("\n")
          ? "add_text_block"
          : "insert_text"
        : !inserted
          ? "delete_text"
          : "replace_text";
  return {
    ordinal: 0,
    kind,
    targetId: "body",
    before: { markdown: before, changedText: removed },
    after: { markdown: after, changedText: inserted },
    anchor: {
      from,
      to: beforeEnd,
      prefix: before.slice(Math.max(0, from - 32), from),
      suffix: before.slice(beforeEnd, beforeEnd + 32),
    },
    schemaVersion: 1,
  };
}
