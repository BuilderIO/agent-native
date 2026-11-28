import DiffMatchPatch, {
  DIFF_DELETE,
  DIFF_EQUAL,
  DIFF_INSERT,
} from "diff-match-patch";

export interface BuilderBodyDiffLine {
  kind: "same" | "removed" | "added";
  text: string;
  changedFrom?: number;
  changedTo?: number;
}

export interface BuilderBodyDiffHunk {
  lines: BuilderBodyDiffLine[];
  omittedLineCount: number;
}

export interface BuilderBodyDiff {
  hunks: BuilderBodyDiffHunk[];
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

function normalizeBody(
  value: string | null | undefined,
  preserveIndentation: boolean,
) {
  const body = (value ?? "").replace(/\r\n/g, "\n");
  return preserveIndentation
    ? body.replace(/^(?:[ \t]*\n)+/, "").trimEnd()
    : body.trim();
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

type LineRange = { start: number; end: number };

function changedRuns(lines: FlatLine[]) {
  const runs: LineRange[] = [];
  let current: LineRange | null = null;
  for (const [index, line] of lines.entries()) {
    if (line.kind === "same") {
      current = null;
    } else if (current) {
      current.end = index;
    } else {
      current = { start: index, end: index };
      runs.push(current);
    }
  }
  return runs;
}

function isBlankSame(line: FlatLine) {
  return line.kind === "same" && !line.text.trim();
}

function nonBlankSameLinesBetween(lines: FlatLine[], from: number, to: number) {
  return lines.slice(from, to).filter((line) => !isBlankSame(line)).length;
}

function contextEdge(
  lines: FlatLine[],
  index: number,
  step: 1 | -1,
  count: number,
) {
  const neighbors =
    step === 1 ? lines.slice(index + 1) : lines.slice(0, index).reverse();
  let edge = index;
  let seen = 0;
  for (const [offset, line] of neighbors.entries()) {
    if (seen >= count || line.kind !== "same") break;
    edge = index + step * (offset + 1);
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

function markedRun(changed: FlatLine[]): BuilderBodyDiffLine[] {
  const visible = changed.filter((line) => line.text.trim());
  const run = visible.length > 0 ? visible : changed;
  const removed = run.filter((line) => line.kind === "removed");
  const added = run.filter((line) => line.kind === "added");
  const ranges = new Map<FlatLine, { from: number; to: number }>();
  const addedLines = added.values();
  for (const before of removed) {
    const next = addedLines.next();
    if (next.done) break;
    const after = next.value;
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

export function builderBodyLineDiff(
  current: string | null | undefined,
  proposed: string | null | undefined,
  options: {
    maxHunks?: number;
    maxHunkLines?: number;
    preserveIndentation?: boolean;
  } = {},
): BuilderBodyDiff | null {
  const maxHunks = options.maxHunks ?? MAX_HUNKS;
  const maxHunkLines = options.maxHunkLines ?? MAX_HUNK_LINES;
  const preserveIndentation = options.preserveIndentation ?? false;
  const before = normalizeBody(current, preserveIndentation);
  const after = normalizeBody(proposed, preserveIndentation);
  if (before === after) return null;

  const lines = flatLines(before, after);
  const runs = changedRuns(lines);
  if (runs.length === 0) return null;

  const merged: LineRange[] = [];
  let previous: LineRange | null = null;
  for (const run of runs) {
    if (
      previous &&
      nonBlankSameLinesBetween(lines, previous.end + 1, run.start) <=
        CONTEXT_LINES * 2
    ) {
      previous.end = run.end;
    } else {
      previous = { ...run };
      merged.push(previous);
    }
  }

  const hunks: BuilderBodyDiffHunk[] = merged
    .slice(0, maxHunks)
    .map((range) => {
      const from = contextEdge(lines, range.start, -1, CONTEXT_LINES);
      const to = contextEdge(lines, range.end, 1, CONTEXT_LINES);
      const hunkLines: BuilderBodyDiffLine[] = [];
      let run: FlatLine[] = [];
      for (const line of lines.slice(from, to + 1)) {
        if (line.kind !== "same") {
          run.push(line);
          continue;
        }
        if (run.length > 0) {
          hunkLines.push(...markedRun(run));
          run = [];
        }
        if (line.text.trim()) {
          hunkLines.push({ kind: "same", ...clipLine(line.text) });
        }
      }
      if (run.length > 0) hunkLines.push(...markedRun(run));
      return {
        lines: hunkLines.slice(0, maxHunkLines),
        omittedLineCount: Math.max(0, hunkLines.length - maxHunkLines),
      };
    });

  return {
    hunks,
    omittedHunkCount: Math.max(0, merged.length - maxHunks),
    addedLineCount: lines.filter(
      (line) => line.kind === "added" && line.text.trim(),
    ).length,
    removedLineCount: lines.filter(
      (line) => line.kind === "removed" && line.text.trim(),
    ).length,
  };
}
