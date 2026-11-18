import DiffMatchPatch, {
  DIFF_DELETE,
  DIFF_EQUAL,
  DIFF_INSERT,
} from "diff-match-patch";

export interface BuilderBodyDiffLine {
  kind: "same" | "removed" | "added";
  text: string;
  /**
   * The span of `text` that differs from the line it replaced or was
   * replaced by. Absent when the whole line is new or gone.
   */
  changedFrom?: number;
  changedTo?: number;
}

export interface BuilderBodyDiffHunk {
  lines: BuilderBodyDiffLine[];
  /** Changed lines past the hunk's limit, left out of `lines`. */
  omittedLineCount: number;
}

/** The changed lines of a body, with a little context around each change. */
export interface BuilderBodyDiff {
  hunks: BuilderBodyDiffHunk[];
  /** Hunks past the limit, left out of `hunks`. */
  omittedHunkCount: number;
  addedLineCount: number;
  removedLineCount: number;
}

const CONTEXT_LINES = 2;
const MAX_HUNKS = 6;
const MAX_HUNK_LINES = 24;
const MAX_LINE_CHARS = 360;
const CLIP_CONTEXT_CHARS = 120;
const DIFF_TIMEOUT_SECONDS = 0.25;

type FlatLine = { kind: BuilderBodyDiffLine["kind"]; text: string };

function normalizeBody(value: string | null | undefined) {
  return (value ?? "").replace(/\r\n/g, "\n").trim();
}

function flatLines(before: string, after: string): FlatLine[] {
  const differ = new DiffMatchPatch();
  differ.Diff_Timeout = DIFF_TIMEOUT_SECONDS;
  const encoded = differ.diff_linesToChars_(`${before}\n`, `${after}\n`);
  const diffs = differ.diff_main(encoded.chars1, encoded.chars2, false);
  differ.diff_charsToLines_(diffs, encoded.lineArray);
  const lines: FlatLine[] = [];
  for (const [operation, text] of diffs) {
    const kind =
      operation === DIFF_EQUAL
        ? "same"
        : operation === DIFF_DELETE
          ? "removed"
          : operation === DIFF_INSERT
            ? "added"
            : null;
    if (!kind) continue;
    const parts = text.split("\n");
    if (parts[parts.length - 1] === "") parts.pop();
    for (const part of parts) lines.push({ kind, text: part });
  }
  return lines;
}

/** Index ranges of consecutive changed lines. */
function changedRuns(lines: FlatLine[]) {
  const runs: Array<{ start: number; end: number }> = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index]!.kind === "same") continue;
    const previous = runs[runs.length - 1];
    if (previous && previous.end === index - 1) previous.end = index;
    else runs.push({ start: index, end: index });
  }
  return runs;
}

function isBlankSame(line: FlatLine) {
  return line.kind === "same" && !line.text.trim();
}

function nonBlankSameLinesBetween(lines: FlatLine[], from: number, to: number) {
  let count = 0;
  for (let index = from; index < to; index += 1) {
    if (!isBlankSame(lines[index]!)) count += 1;
  }
  return count;
}

/** Steps outward from `index` until `count` non-blank unchanged lines. */
function contextEdge(
  lines: FlatLine[],
  index: number,
  step: 1 | -1,
  count: number,
) {
  let edge = index;
  let seen = 0;
  for (
    let cursor = index + step;
    cursor >= 0 && cursor < lines.length && seen < count;
    cursor += step
  ) {
    const line = lines[cursor]!;
    if (line.kind !== "same") break;
    edge = cursor;
    if (line.text.trim()) seen += 1;
  }
  return edge;
}

function commonPrefixLength(left: string, right: string) {
  const limit = Math.min(left.length, right.length);
  let index = 0;
  while (index < limit && left[index] === right[index]) index += 1;
  return index;
}

function commonSuffixLength(left: string, right: string, prefix: number) {
  const limit = Math.min(left.length, right.length) - prefix;
  let index = 0;
  while (
    index < limit &&
    left[left.length - 1 - index] === right[right.length - 1 - index]
  ) {
    index += 1;
  }
  return index;
}

/**
 * Keeps a long line readable: the changed span with some text on either
 * side, or the opening text when nothing in the line is marked.
 */
function clipLine(
  text: string,
  changed?: { from: number; to: number },
): Pick<BuilderBodyDiffLine, "text" | "changedFrom" | "changedTo"> {
  if (!changed) {
    return text.length > MAX_LINE_CHARS
      ? { text: `${text.slice(0, MAX_LINE_CHARS)}…` }
      : { text };
  }
  if (text.length <= MAX_LINE_CHARS) {
    return { text, changedFrom: changed.from, changedTo: changed.to };
  }
  const start = Math.max(0, changed.from - CLIP_CONTEXT_CHARS);
  const end = Math.min(
    text.length,
    Math.max(changed.to + CLIP_CONTEXT_CHARS, start + MAX_LINE_CHARS),
    start + MAX_LINE_CHARS * 2,
  );
  const lead = start > 0 ? "…" : "";
  const tail = end < text.length ? "…" : "";
  return {
    text: `${lead}${text.slice(start, end)}${tail}`,
    changedFrom: changed.from - start + lead.length,
    changedTo: Math.min(changed.to, end) - start + lead.length,
  };
}

/** Marks what differs within each removed line and the added line after it. */
function markedRun(changed: FlatLine[]): BuilderBodyDiffLine[] {
  // Blank lines only space out Markdown, so they show only when nothing else
  // in the run changed.
  const visible = changed.filter((line) => line.text.trim());
  const run = visible.length > 0 ? visible : changed;
  const removed = run.filter((line) => line.kind === "removed");
  const added = run.filter((line) => line.kind === "added");
  const pairs = Math.min(removed.length, added.length);
  const ranges = new Map<FlatLine, { from: number; to: number }>();
  for (let index = 0; index < pairs; index += 1) {
    const before = removed[index]!;
    const after = added[index]!;
    const prefix = commonPrefixLength(before.text, after.text);
    const suffix = commonSuffixLength(before.text, after.text, prefix);
    ranges.set(before, { from: prefix, to: before.text.length - suffix });
    ranges.set(after, { from: prefix, to: after.text.length - suffix });
  }
  return [...removed, ...added].map((line) => ({
    kind: line.kind,
    ...clipLine(line.text, ranges.get(line)),
  }));
}

/**
 * Compares two versions of a body line by line and keeps the lines that
 * changed, with up to two unchanged lines on each side. Returns null when
 * the bodies match once line endings and outer whitespace are ignored.
 */
export function builderBodyLineDiff(
  current: string | null | undefined,
  proposed: string | null | undefined,
): BuilderBodyDiff | null {
  const before = normalizeBody(current);
  const after = normalizeBody(proposed);
  if (before === after) return null;

  const lines = flatLines(before, after);
  const runs = changedRuns(lines);
  if (runs.length === 0) return null;

  const merged: Array<{ start: number; end: number }> = [];
  for (const run of runs) {
    const previous = merged[merged.length - 1];
    if (
      previous &&
      nonBlankSameLinesBetween(lines, previous.end + 1, run.start) <=
        CONTEXT_LINES * 2
    ) {
      previous.end = run.end;
    } else {
      merged.push({ ...run });
    }
  }

  const hunks: BuilderBodyDiffHunk[] = merged
    .slice(0, MAX_HUNKS)
    .map((range) => {
      const from = contextEdge(lines, range.start, -1, CONTEXT_LINES);
      const to = contextEdge(lines, range.end, 1, CONTEXT_LINES);
      const hunkLines: BuilderBodyDiffLine[] = [];
      let index = from;
      while (index <= to) {
        const line = lines[index]!;
        if (line.kind === "same") {
          if (line.text.trim()) {
            hunkLines.push({ kind: "same", ...clipLine(line.text) });
          }
          index += 1;
          continue;
        }
        const run: FlatLine[] = [];
        while (index <= to && lines[index]!.kind !== "same") {
          run.push(lines[index]!);
          index += 1;
        }
        hunkLines.push(...markedRun(run));
      }
      return {
        lines: hunkLines.slice(0, MAX_HUNK_LINES),
        omittedLineCount: Math.max(0, hunkLines.length - MAX_HUNK_LINES),
      };
    });

  return {
    hunks,
    omittedHunkCount: Math.max(0, merged.length - MAX_HUNKS),
    addedLineCount: lines.filter(
      (line) => line.kind === "added" && line.text.trim(),
    ).length,
    removedLineCount: lines.filter(
      (line) => line.kind === "removed" && line.text.trim(),
    ).length,
  };
}
