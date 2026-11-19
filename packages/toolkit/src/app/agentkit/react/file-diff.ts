export interface DiffLine {
  kind: "context" | "added" | "removed";
  text: string;
  oldLineNo?: number;
  newLineNo?: number;
}

export function computeLineDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");

  const MAX_LINES = 2000;
  const a = oldLines.slice(0, MAX_LINES);
  const b = newLines.slice(0, MAX_LINES);

  const m = a.length;
  const n = b.length;

  // LCS of suffixes: cell(i, j) covers a[i..] against b[j..].
  const width = n + 1;
  const lengths = new Uint32Array((m + 1) * width);
  const cell = (row: number, column: number) =>
    lengths.at(row * width + column) ?? 0;
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      lengths[i * width + j] =
        a.at(i) === b.at(j)
          ? cell(i + 1, j + 1) + 1
          : Math.max(cell(i + 1, j), cell(i, j + 1));
    }
  }

  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;
  let oldLineNo = 1;
  let newLineNo = 1;

  for (;;) {
    const left = a.at(i);
    const right = b.at(j);
    if (left === undefined && right === undefined) break;
    if (left !== undefined && left === right) {
      result.push({
        kind: "context",
        text: left,
        oldLineNo: oldLineNo++,
        newLineNo: newLineNo++,
      });
      i++;
      j++;
    } else if (
      left !== undefined &&
      (right === undefined || cell(i + 1, j) >= cell(i, j + 1))
    ) {
      // Ties remove first, so removals precede the additions replacing them.
      result.push({ kind: "removed", text: left, oldLineNo: oldLineNo++ });
      i++;
    } else if (right !== undefined) {
      result.push({ kind: "added", text: right, newLineNo: newLineNo++ });
      j++;
    }
  }

  for (const text of oldLines.slice(MAX_LINES)) {
    result.push({ kind: "removed", text, oldLineNo: oldLineNo++ });
  }
  for (const text of newLines.slice(MAX_LINES)) {
    result.push({ kind: "added", text, newLineNo: newLineNo++ });
  }

  return result;
}

export function diffStats(lines: DiffLine[]): {
  added: number;
  removed: number;
} {
  let added = 0;
  let removed = 0;
  for (const line of lines) {
    if (line.kind === "added") added++;
    else if (line.kind === "removed") removed++;
  }
  return { added, removed };
}

const CACHED_DIFFS = 32;
const cachedDiffs = new Map<string, DiffLine[]>();

/**
 * `computeLineDiff`, cached by text: a row's stats and its body share one
 * quadratic pass, and a re-render reuses it.
 */
export function cachedLineDiff(oldText: string, newText: string): DiffLine[] {
  const key = `${oldText.length}:${oldText}\u0000${newText}`;
  const cached = cachedDiffs.get(key);
  if (cached) {
    cachedDiffs.delete(key);
    cachedDiffs.set(key, cached);
    return cached;
  }
  const diff = computeLineDiff(oldText, newText);
  cachedDiffs.set(key, diff);
  if (cachedDiffs.size > CACHED_DIFFS) {
    const oldest = cachedDiffs.keys().next();
    if (!oldest.done) cachedDiffs.delete(oldest.value);
  }
  return diff;
}
