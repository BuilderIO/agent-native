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
const MAX_DOCUMENT_LENGTH = 64_000;
const MAX_EDIT_DISTANCE = 1_024;

type DiffPart = { type: "equal" | "insert" | "delete"; text: string };

function kindForChange(removed: string, inserted: string) {
  const sameUnmarkedText =
    removed.replace(MARKDOWN_MARK, "") === inserted.replace(MARKDOWN_MARK, "");
  return sameUnmarkedText && removed !== inserted
    ? "set_inline_mark"
    : !removed
      ? inserted.includes("\n")
        ? "add_text_block"
        : "insert_text"
      : !inserted
        ? "delete_text"
        : "replace_text";
}

function operationForChange(
  before: string,
  from: number,
  to: number,
  inserted: string,
  ordinal: number,
): MarkdownSuggestionOperation {
  const removed = before.slice(from, to);
  return {
    ordinal,
    kind: kindForChange(removed, inserted),
    targetId: "body",
    before: { markdown: before, changedText: removed },
    after: {
      markdown: `${before.slice(0, from)}${inserted}${before.slice(to)}`,
      changedText: inserted,
    },
    anchor: {
      from,
      to,
      prefix: before.slice(Math.max(0, from - 32), from),
      suffix: before.slice(to, to + 32),
    },
    schemaVersion: 1,
  };
}

function coalesce(parts: DiffPart[]): DiffPart[] {
  const result: DiffPart[] = [];
  for (const part of parts) {
    if (!part.text) continue;
    const previous = result[result.length - 1];
    if (previous?.type === part.type) previous.text += part.text;
    else result.push({ ...part });
  }
  return result;
}

/**
 * Returns a bounded Myers diff. The edit-distance cap keeps pathological
 * documents from consuming unbounded memory; callers retain one whole-document
 * replacement when the granular representation cannot be produced safely.
 */
function diffParts(before: string, after: string): DiffPart[] | null {
  if (before.length + after.length > MAX_DOCUMENT_LENGTH) return null;

  const maxDistance = Math.min(before.length + after.length, MAX_EDIT_DISTANCE);
  const offset = maxDistance + 1;
  let frontier = new Int32Array(maxDistance * 2 + 3);
  frontier.fill(-1);
  frontier[offset + 1] = 0;
  const trace: Int32Array[] = [];

  for (let distance = 0; distance <= maxDistance; distance += 1) {
    trace.push(frontier.slice());
    for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
      const stepDown =
        diagonal === -distance ||
        (diagonal !== distance &&
          frontier[offset + diagonal - 1] < frontier[offset + diagonal + 1]);
      let x = stepDown
        ? frontier[offset + diagonal + 1]
        : frontier[offset + diagonal - 1] + 1;
      let y = x - diagonal;
      while (x < before.length && y < after.length && before[x] === after[y]) {
        x += 1;
        y += 1;
      }
      frontier[offset + diagonal] = x;
      if (x >= before.length && y >= after.length) {
        return backtrack(trace, before, after, distance, offset);
      }
    }
  }
  return null;
}

function backtrack(
  trace: Int32Array[],
  before: string,
  after: string,
  distance: number,
  offset: number,
): DiffPart[] {
  const reverseParts: DiffPart[] = [];
  let x = before.length;
  let y = after.length;

  for (
    let currentDistance = distance;
    currentDistance > 0;
    currentDistance -= 1
  ) {
    const frontier = trace[currentDistance]!;
    const diagonal = x - y;
    const stepDown =
      diagonal === -currentDistance ||
      (diagonal !== currentDistance &&
        frontier[offset + diagonal - 1] < frontier[offset + diagonal + 1]);
    const previousDiagonal = stepDown ? diagonal + 1 : diagonal - 1;
    const previousX = frontier[offset + previousDiagonal]!;
    const previousY = previousX - previousDiagonal;

    while (x > previousX && y > previousY) {
      reverseParts.push({ type: "equal", text: before[x - 1]! });
      x -= 1;
      y -= 1;
    }
    if (stepDown) {
      reverseParts.push({ type: "insert", text: after[previousY]! });
      y = previousY;
    } else {
      reverseParts.push({ type: "delete", text: before[previousX]! });
      x = previousX;
    }
  }

  while (x > 0 && y > 0) {
    reverseParts.push({ type: "equal", text: before[x - 1]! });
    x -= 1;
    y -= 1;
  }
  while (x > 0) {
    reverseParts.push({ type: "delete", text: before[x - 1]! });
    x -= 1;
  }
  while (y > 0) {
    reverseParts.push({ type: "insert", text: after[y - 1]! });
    y -= 1;
  }

  return coalesce(reverseParts.reverse());
}

/**
 * Produces independent, contextual-rebase-compatible operations for each
 * disjoint markdown hunk. Every operation starts from the same canonical
 * snapshot, so accepting or rejecting one does not require another first.
 */
export function markdownSuggestionOperations(
  before: string,
  after: string,
): MarkdownSuggestionOperation[] {
  if (before === after) return [];
  if (before.replace(MARKDOWN_MARK, "") === after.replace(MARKDOWN_MARK, "")) {
    return [operationForChange(before, 0, before.length, after, 0)];
  }
  const parts = diffParts(before, after);
  if (!parts) return [markdownSuggestionOperation(before, after)!];

  const operations: MarkdownSuggestionOperation[] = [];
  let beforeOffset = 0;
  for (let index = 0; index < parts.length; ) {
    const part = parts[index]!;
    if (part.type === "equal") {
      beforeOffset += part.text.length;
      index += 1;
      continue;
    }

    const from = beforeOffset;
    let removed = "";
    let inserted = "";
    while (index < parts.length && parts[index]!.type !== "equal") {
      const changed = parts[index]!;
      if (changed.type === "delete") removed += changed.text;
      else inserted += changed.text;
      index += 1;
    }
    const to = from + removed.length;
    operations.push(
      operationForChange(before, from, to, inserted, operations.length),
    );
    beforeOffset = to;
  }
  return operations;
}

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
  return operationForChange(
    before,
    from,
    beforeEnd,
    after.slice(from, afterEnd),
    0,
  );
}
