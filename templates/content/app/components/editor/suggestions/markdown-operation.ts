import {
  suggestionFormattingChanges,
  suggestionMarkedSourceRanges,
  SuggestionFormattingMappingError,
} from "@shared/suggestion-formatting";

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

const MAX_DOCUMENT_LENGTH = 64_000;
const MAX_EDIT_DISTANCE = 1_024;

type DiffPart = { type: "equal" | "insert" | "delete"; text: string };

function kindForChange(removed: string, inserted: string) {
  const formatting =
    removed && inserted ? suggestionFormattingChanges(removed, inserted) : null;
  return formatting && formatting.length > 0
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

function changeBoundaryRank(text: string, position: number): number {
  if (
    position === 0 ||
    position === text.length ||
    text[position - 1] === "\n" ||
    text[position] === "\n"
  ) {
    return 2;
  }
  return /\s/.test(text[position - 1]!) !== /\s/.test(text[position]!) ? 1 : 0;
}

function contiguousChange(
  before: string,
  after: string,
  bounds = { from: 0, to: before.length },
): { from: number; to: number; inserted: string } | null {
  if (before.length === after.length) return null;
  const shorter = before.length < after.length ? before : after;
  const longer = before.length < after.length ? after : before;
  const changeLength = longer.length - shorter.length;
  let prefixLength = 0;
  while (
    prefixLength < shorter.length &&
    shorter[prefixLength] === longer[prefixLength]
  ) {
    prefixLength += 1;
  }
  let suffixLength = 0;
  while (
    suffixLength < shorter.length &&
    shorter[shorter.length - suffixLength - 1] ===
      longer[longer.length - suffixLength - 1]
  ) {
    suffixLength += 1;
  }

  const firstCandidate = Math.max(shorter.length - suffixLength, bounds.from);
  const lastCandidate = Math.min(
    prefixLength,
    bounds.to - (before.length > after.length ? changeLength : 0),
  );
  if (firstCandidate > lastCandidate) return null;

  // Repeated text can make several positions reconstruct the same edit. Prefer
  // paragraph, then word boundaries; otherwise retain the conventional latest
  // common-prefix position.
  let position = lastCandidate;
  let rank = changeBoundaryRank(shorter, position);
  for (
    let candidate = firstCandidate;
    candidate < lastCandidate;
    candidate += 1
  ) {
    const candidateRank = changeBoundaryRank(shorter, candidate);
    if (candidateRank > rank) {
      position = candidate;
      rank = candidateRank;
    }
  }

  if (after.length > before.length) {
    return {
      from: position,
      to: position,
      inserted: after.slice(position, position + changeLength),
    };
  }
  return {
    from: position,
    to: position + changeLength,
    inserted: "",
  };
}

/**
 * Returns a bounded Myers diff. The edit-distance cap keeps pathological
 * documents from consuming unbounded memory; callers retain one whole-document
 * replacement when the granular representation cannot be produced safely.
 */
function diffParts(
  beforeSource: string,
  afterSource: string,
): DiffPart[] | null {
  if (beforeSource.length + afterSource.length > MAX_DOCUMENT_LENGTH)
    return null;

  // A hard-break token is one structural edit. Matching its letters against
  // nearby prose can otherwise create independently invalid `<b` / `r>` hunks.
  const before = beforeSource.match(/<br\/?>|[\s\S]/g) ?? [];
  const after = afterSource.match(/<br\/?>|[\s\S]/g) ?? [];

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
  before: readonly string[],
  after: readonly string[],
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

function markedDiffOperations(
  before: string,
  after: string,
  parts: DiffPart[],
): MarkdownSuggestionOperation[] | null {
  const previous = suggestionMarkedSourceRanges(before);
  const next = suggestionMarkedSourceRanges(after);
  if (!previous || !next || (!previous.length && !next.length)) return null;
  const steps: Array<{
    before: number;
    after: number;
    type: DiffPart["type"];
  }> = [];
  const beforeSteps: number[] = [];
  const afterSteps: number[] = [];
  let beforeOffset = 0;
  let afterOffset = 0;
  for (const part of parts) {
    for (let index = 0; index < part.text.length; index += 1) {
      if (part.type !== "insert") beforeSteps[beforeOffset] = steps.length;
      if (part.type !== "delete") afterSteps[afterOffset] = steps.length;
      steps.push({ before: beforeOffset, after: afterOffset, type: part.type });
      if (part.type !== "insert") beforeOffset += 1;
      if (part.type !== "delete") afterOffset += 1;
    }
  }
  const envelopes = [
    ...previous.map((range) => ({
      ...range,
      side: "before" as const,
      excluded: "insert",
    })),
    ...next.map((range) => ({
      ...range,
      side: "after" as const,
      excluded: "delete",
    })),
  ].map((range) => {
    const positions = range.side === "before" ? beforeSteps : afterSteps;
    const from = positions[range.from];
    const last = positions[range.to - 1];
    if (from === undefined || last === undefined || last < from)
      throw new Error("Marked source envelope is outside the edit path");
    return { from, to: last + 1 };
  });
  const changes: Array<{ from: number; to: number }> = [];
  for (let index = 0; index < steps.length; index += 1) {
    if (steps[index]!.type === "equal") continue;
    const previousChange = changes[changes.length - 1];
    if (previousChange?.to === index) previousChange.to += 1;
    else changes.push({ from: index, to: index + 1 });
  }
  // A marked run owns its delimiters, so no independently accepted hunk may split it.
  let expanded: boolean;
  do {
    expanded = false;
    for (const change of changes) {
      for (const envelope of envelopes) {
        if (envelope.from >= change.to || envelope.to <= change.from) continue;
        if (envelope.from < change.from || envelope.to > change.to)
          expanded = true;
        change.from = Math.min(change.from, envelope.from);
        change.to = Math.max(change.to, envelope.to);
      }
    }
    changes.sort((left, right) => left.from - right.from);
    for (let index = changes.length - 1; index > 0; index -= 1) {
      const previousChange = changes[index - 1]!;
      const change = changes[index]!;
      if (previousChange.to >= change.from) {
        previousChange.to = Math.max(previousChange.to, change.to);
        changes.splice(index, 1);
        expanded = true;
      }
    }
  } while (expanded);
  const operations = changes.map((change, index) => {
    const start = steps[change.from]!;
    const finish = steps[change.to] ?? {
      before: before.length,
      after: after.length,
    };
    return operationForChange(
      before,
      start.before,
      finish.before,
      after.slice(start.after, finish.after),
      index,
    );
  });
  let reconstructed = before;
  for (const operation of [...operations].reverse())
    reconstructed =
      reconstructed.slice(0, operation.anchor.from) +
      operation.after.changedText +
      reconstructed.slice(operation.anchor.to);
  if (reconstructed !== after)
    throw new Error(
      "Marked edit ranges do not reconstruct the proposed source",
    );
  return operations;
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
  const beforeMarked = suggestionMarkedSourceRanges(before);
  const afterMarked = suggestionMarkedSourceRanges(after);
  const formatting = suggestionFormattingChanges(before, after);
  if (formatting) {
    return formatting.map((range, index) => ({
      ...operationForChange(
        before,
        range.before.from,
        range.before.to,
        after.slice(range.after.from, range.after.to),
        index,
      ),
      kind: "set_inline_mark",
    }));
  }
  const markedParts = diffParts(before, after);
  if (!markedParts && (beforeMarked?.length || afterMarked?.length))
    throw new SuggestionFormattingMappingError();
  if (markedParts) {
    const marked = markedDiffOperations(before, after, markedParts);
    if (marked) return marked;
  }
  if (before.length + after.length <= MAX_DOCUMENT_LENGTH) {
    const contiguous = contiguousChange(before, after);
    if (contiguous) {
      return [
        operationForChange(
          before,
          contiguous.from,
          contiguous.to,
          contiguous.inserted,
          0,
        ),
      ];
    }
  }
  const parts = markedParts;
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
  return operations.map((operation, index) => {
    if (operation.before.changedText && operation.after.changedText)
      return operation;
    const normalized = contiguousChange(before, operation.after.markdown, {
      from: operations[index - 1]?.anchor.to ?? 0,
      to: operations[index + 1]?.anchor.from ?? before.length,
    });
    return normalized
      ? operationForChange(
          before,
          normalized.from,
          normalized.to,
          normalized.inserted,
          index,
        )
      : operation;
  });
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

export function markdownSuggestionOperationsForReplacements(input: {
  before: string;
  after: string;
  replacements: ReadonlyArray<{ from: number; to: number }>;
}): MarkdownSuggestionOperation[] {
  const { before, after, replacements } = input;
  for (const { from, to } of replacements) {
    if (
      !Number.isInteger(from) ||
      !Number.isInteger(to) ||
      from < 0 ||
      to <= from ||
      to > before.length
    ) {
      throw new Error("Invalid suggestion replacement range");
    }
  }
  const operations = markdownSuggestionOperations(before, after);
  if (operations.length === 0 || replacements.length === 0) return operations;
  if (replacements.length === 1) {
    const [{ from, to }] = replacements;
    const prefix = before.slice(0, from);
    const suffix = before.slice(to);
    if (
      after.startsWith(prefix) &&
      after.endsWith(suffix) &&
      after.length >= prefix.length + suffix.length
    ) {
      const inserted = after.slice(from, after.length - suffix.length);
      const exact = operationForChange(before, from, to, inserted, 0);
      if (exact.after.markdown === after) return [exact];
    }
  }
  const ranges = [
    ...replacements,
    ...operations.map((operation) => operation.anchor),
  ].sort((left, right) => left.from - right.from || left.to - right.to);
  const groups: Array<{ from: number; to: number }> = [];
  for (const range of ranges) {
    const previous = groups[groups.length - 1];
    if (previous && range.from <= previous.to) {
      previous.to = Math.max(previous.to, range.to);
    } else {
      groups.push({ from: range.from, to: range.to });
    }
  }
  const result: MarkdownSuggestionOperation[] = [];
  let operationIndex = 0;
  for (const group of groups) {
    let offset = group.from;
    let inserted = "";
    let changed = false;
    while (
      operationIndex < operations.length &&
      operations[operationIndex]!.anchor.from <= group.to
    ) {
      const operation = operations[operationIndex++]!;
      inserted +=
        before.slice(offset, operation.anchor.from) +
        operation.after.changedText;
      offset = operation.anchor.to;
      changed = true;
    }
    if (!changed) continue;
    inserted += before.slice(offset, group.to);
    result.push(
      operationForChange(before, group.from, group.to, inserted, result.length),
    );
  }
  return result;
}

export function draftSuggestionAnchors(
  operations: readonly MarkdownSuggestionOperation[],
  draft: string,
): MarkdownSuggestionOperation["anchor"][] {
  let delta = 0;
  return operations.map((operation) => {
    const from = operation.anchor.from + delta;
    const to = from + operation.after.changedText.length;
    delta +=
      operation.after.changedText.length - operation.before.changedText.length;
    return {
      from,
      to,
      prefix: draft.slice(Math.max(0, from - 32), from),
      suffix: draft.slice(to, to + 32),
    };
  });
}
