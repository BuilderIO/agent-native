import { canonicalizeNfm } from "./nfm.js";
import {
  suggestionFormattingChanges,
  suggestionMarkedSourceRanges,
  suggestionSourceAlignment,
  SuggestionFormattingMappingError,
  type SuggestionSourceAlignment,
} from "./suggestion-formatting.js";
import { resolveMarkdownSuggestionRange } from "./suggestion-rebase.js";

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
  anchor: {
    from: number;
    to: number;
    prefix: string;
    suffix: string;
    siblingRanges?: Array<{ from: number; to: number }>;
  };
  schemaVersion: 1;
};

const MAX_DOCUMENT_LENGTH = 64_000;
const MAX_EDIT_DISTANCE = 1_024;
const EMPTY_BLOCK = "<empty-block/>";

type DiffPart = { type: "equal" | "insert" | "delete"; text: string };

function kindForChange(removed: string, inserted: string) {
  if (removed && inserted === EMPTY_BLOCK) return "delete_text";
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

function isolateSiblingAnchorContexts(
  operations: MarkdownSuggestionOperation[],
): MarkdownSuggestionOperation[] {
  return operations.map((operation, index) => {
    const previousEnd = operations[index - 1]?.anchor.to ?? 0;
    const nextStart =
      operations[index + 1]?.anchor.from ?? operation.before.markdown.length;
    const { from, to } = operation.anchor;
    return {
      ...operation,
      anchor: {
        ...operation.anchor,
        prefix: operation.before.markdown.slice(
          Math.max(previousEnd, from - 32),
          from,
        ),
        suffix: operation.before.markdown.slice(
          to,
          Math.min(nextStart, to + 32),
        ),
        ...(operations.length > 1 && {
          siblingRanges: operations
            .filter((_, siblingIndex) => siblingIndex !== index)
            .map(({ anchor }) => ({ from: anchor.from, to: anchor.to })),
        }),
      },
    };
  });
}

function lineScopedOperationsForClearedBlocks(
  before: string,
  after: string,
): MarkdownSuggestionOperation[] | null {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  if (beforeLines.length !== afterLines.length) return null;
  if (
    !beforeLines.some(
      (line, index) => line && afterLines[index] === EMPTY_BLOCK,
    )
  )
    return null;

  const operations: MarkdownSuggestionOperation[] = [];
  let lineOffset = 0;
  for (let index = 0; index < beforeLines.length; index += 1) {
    const beforeLine = beforeLines[index]!;
    const afterLine = afterLines[index]!;
    if (beforeLine === afterLine) {
      lineOffset += beforeLine.length + 1;
      continue;
    }
    if (beforeLine && afterLine === EMPTY_BLOCK) {
      operations.push(
        operationForChange(
          before,
          lineOffset,
          lineOffset + beforeLine.length,
          EMPTY_BLOCK,
          operations.length,
        ),
      );
    } else {
      for (const operation of markdownSuggestionOperations(
        beforeLine,
        afterLine,
      )) {
        operations.push(
          operationForChange(
            before,
            lineOffset + operation.anchor.from,
            lineOffset + operation.anchor.to,
            operation.after.changedText,
            operations.length,
          ),
        );
      }
    }
    lineOffset += beforeLine.length + 1;
  }
  return operations;
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

const WORD_CHARACTER = /[\p{L}\p{M}\p{N}]/u;

// Source offsets count UTF-16 code units. Read whole code points so a letter
// outside the Basic Multilingual Plane is not taken for two non-word halves.
function characterBefore(text: string, at: number): string {
  return /.$/su.exec(text.slice(Math.max(0, at - 2), at))?.[0] ?? "";
}

function characterAt(text: string, at: number): string {
  const point = text.codePointAt(at);
  return point === undefined ? "" : String.fromCodePoint(point);
}

const isWordBefore = (text: string, at: number) =>
  WORD_CHARACTER.test(characterBefore(text, at));
const isWordAt = (text: string, at: number) =>
  WORD_CHARACTER.test(characterAt(text, at));

/**
 * A character diff keeps every letter two phrasings share, which splits one
 * rewritten phrase into letter-sized hunks. Shared letters or spacing join the
 * word edits on both sides when shorter than each edit's longer side: a pure
 * insertion or deletion has an empty side, so measuring the shorter one would
 * never join it and the phrase would stay split. A shared whole word keeps its
 * edits apart, and nothing joins across a line break, so word choices with an
 * unchanged word between them and edits in different blocks stay separately
 * reviewable. Adjacent rewritten words separated only by spacing shorter than
 * their edits become one edit on purpose: no spacing rule tells a rewritten
 * phrase from two independent word swaps, and one edit can never leave a
 * half-accepted phrase.
 */
function absorbIncidentalEqualities(parts: DiffPart[]): DiffPart[] {
  type Change = { type: "change"; removed: string; inserted: string };
  type Equal = {
    type: "equal";
    text: string;
    beforeFrom: number;
    afterFrom: number;
  };
  const before = parts
    .map((part) => (part.type === "insert" ? "" : part.text))
    .join("");
  const after = parts
    .map((part) => (part.type === "delete" ? "" : part.text))
    .join("");
  const holdsWholeWord = ({ text, beforeFrom, afterFrom }: Equal) =>
    [...text.matchAll(/[\p{L}\p{M}\p{N}]+/gu)].some(
      ({ index, 0: word }) =>
        !isWordBefore(before, beforeFrom + index) &&
        !isWordBefore(after, afterFrom + index) &&
        !isWordAt(before, beforeFrom + index + word.length) &&
        !isWordAt(after, afterFrom + index + word.length),
    );
  const segments: Array<Equal | Change> = [];
  let beforeOffset = 0;
  let afterOffset = 0;
  for (const part of parts) {
    const previous = segments[segments.length - 1];
    if (part.type === "equal")
      segments.push({
        type: "equal",
        text: part.text,
        beforeFrom: beforeOffset,
        afterFrom: afterOffset,
      });
    if (part.type !== "insert") beforeOffset += part.text.length;
    if (part.type !== "delete") afterOffset += part.text.length;
    if (part.type === "equal") continue;
    if (previous?.type === "change") {
      if (part.type === "delete") previous.removed += part.text;
      else previous.inserted += part.text;
    } else
      segments.push({
        type: "change",
        removed: part.type === "delete" ? part.text : "",
        inserted: part.type === "insert" ? part.text : "",
      });
  }
  const absorbs = (change: Change, equal: Equal) =>
    WORD_CHARACTER.test(change.removed + change.inserted) &&
    !/\n/.test(change.removed + change.inserted) &&
    equal.text.length < Math.max(change.removed.length, change.inserted.length);
  let absorbed: boolean;
  do {
    absorbed = false;
    for (let index = 1; index < segments.length - 1; index += 1) {
      const left = segments[index - 1]!;
      const equal = segments[index]!;
      const right = segments[index + 1]!;
      if (
        equal.type !== "equal" ||
        left.type !== "change" ||
        right.type !== "change" ||
        equal.text.includes("\n") ||
        holdsWholeWord(equal) ||
        !absorbs(left, equal) ||
        !absorbs(right, equal)
      )
        continue;
      left.removed += equal.text + right.removed;
      left.inserted += equal.text + right.inserted;
      segments.splice(index, 2);
      absorbed = true;
      index -= 1;
    }
  } while (absorbed);
  return segments.flatMap((segment): DiffPart[] => {
    if (segment.type === "equal")
      return [{ type: "equal", text: segment.text }];
    const changed: DiffPart[] = [];
    if (segment.removed)
      changed.push({ type: "delete", text: segment.removed });
    if (segment.inserted)
      changed.push({ type: "insert", text: segment.inserted });
    return changed;
  });
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
  const before = diffTokens(beforeSource);
  const after = diffTokens(afterSource);

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
        return foldShortEqualities(
          backtrack(trace, before, after, distance, offset),
        );
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

function diffTokens(text: string): string[] {
  return text.match(/<br\/?>|[\s\S]/gu) ?? [];
}

// A minimal Myers alignment is not a stable one: typed text that shares a few
// letters with what follows ("th" in "the" and "things") splits into separate
// insertions, and the split moves whenever an edit elsewhere shifts the
// alignment. Fold an equality between two insertions (or two deletions) that
// is no longer than either, as diff-match-patch's semantic cleanup does.
// Equalities between replacements stay, so separate word swaps remain
// separately reviewable, and a line never folds, so blocks stay separate.
type ChangeRun = {
  deleted: string;
  inserted: string;
  // Folded equality text sits on both sides without making a run a replacement.
  ownDeleted: number;
  ownInserted: number;
};

function foldShortEqualities(parts: DiffPart[]): DiffPart[] {
  const segments: Array<string | ChangeRun> = [];
  for (const part of parts) {
    const last = segments[segments.length - 1];
    if (part.type === "equal") segments.push(part.text);
    else {
      const run =
        typeof last === "object"
          ? last
          : { deleted: "", inserted: "", ownDeleted: 0, ownInserted: 0 };
      if (run !== last) segments.push(run);
      if (part.type === "delete") {
        run.deleted += part.text;
        run.ownDeleted += part.text.length;
      } else {
        run.inserted += part.text;
        run.ownInserted += part.text.length;
      }
    }
  }
  let folded = false;
  for (let index = 1; index < segments.length - 1; index += 1) {
    const equality = segments[index];
    const left = segments[index - 1];
    const right = segments[index + 1];
    if (typeof equality !== "string" || typeof left !== "object") continue;
    if (typeof right !== "object") continue;
    const oneSided =
      (left.ownDeleted === 0 && right.ownDeleted === 0) ||
      (left.ownInserted === 0 && right.ownInserted === 0);
    if (
      !oneSided ||
      equality.includes("\n") ||
      equality.length > Math.max(left.ownDeleted, left.ownInserted) ||
      equality.length > Math.max(right.ownDeleted, right.ownInserted)
    )
      continue;
    segments.splice(index - 1, 3, {
      deleted: left.deleted + equality + right.deleted,
      inserted: left.inserted + equality + right.inserted,
      ownDeleted: left.ownDeleted + right.ownDeleted,
      ownInserted: left.ownInserted + right.ownInserted,
    });
    // The merged run may make the equality before it foldable too.
    index = Math.max(0, index - 3);
    folded = true;
  }
  if (!folded) return parts;
  const result: DiffPart[] = [];
  for (const segment of segments) {
    if (typeof segment === "string") {
      result.push({ type: "equal", text: segment });
      continue;
    }
    const deleted = diffTokens(segment.deleted);
    const inserted = diffTokens(segment.inserted);
    let prefix = 0;
    while (
      prefix < deleted.length &&
      prefix < inserted.length &&
      deleted[prefix] === inserted[prefix]
    )
      prefix += 1;
    let suffix = 0;
    while (
      suffix < deleted.length - prefix &&
      suffix < inserted.length - prefix &&
      deleted[deleted.length - 1 - suffix] ===
        inserted[inserted.length - 1 - suffix]
    )
      suffix += 1;
    result.push(
      { type: "equal", text: deleted.slice(0, prefix).join("") },
      {
        type: "delete",
        text: deleted.slice(prefix, deleted.length - suffix).join(""),
      },
      {
        type: "insert",
        text: inserted.slice(prefix, inserted.length - suffix).join(""),
      },
      { type: "equal", text: deleted.slice(deleted.length - suffix).join("") },
    );
  }
  return coalesce(result);
}

type MarkedSourceRanges = Array<{ from: number; to: number }>;

function markedDiffOperations(
  before: string,
  after: string,
  parts: DiffPart[],
  previous: MarkedSourceRanges,
  next: MarkedSourceRanges,
): MarkdownSuggestionOperation[] | null {
  if (!previous.length && !next.length) return null;
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
  const clearedTextBlocks = lineScopedOperationsForClearedBlocks(before, after);
  if (clearedTextBlocks) return isolateSiblingAnchorContexts(clearedTextBlocks);
  // Null means the source has no marks; it throws when marks cannot be mapped.
  const beforeMarked = suggestionMarkedSourceRanges(before) ?? [];
  const afterMarked = suggestionMarkedSourceRanges(after) ?? [];
  const formatting = suggestionFormattingChanges(before, after);
  if (formatting) {
    return isolateSiblingAnchorContexts(
      formatting.map((range, index) => ({
        ...operationForChange(
          before,
          range.before.from,
          range.before.to,
          after.slice(range.after.from, range.after.to),
          index,
        ),
        kind: "set_inline_mark",
      })),
    );
  }
  const markedParts = suggestionDiffParts(before, after);
  if (!markedParts && (beforeMarked.length || afterMarked.length))
    throw new SuggestionFormattingMappingError();
  const marked =
    markedParts &&
    markedDiffOperations(before, after, markedParts, beforeMarked, afterMarked);
  if (!marked) {
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
    if (!markedParts) return [markdownSuggestionOperation(before, after)!];
  }
  const operations = marked ?? plainDiffOperations(before, markedParts!);
  return isolateSiblingAnchorContexts(
    wholeWordReplacements(before, operations, beforeMarked, afterMarked),
  );
}

function plainDiffOperations(
  before: string,
  parts: DiffPart[],
): MarkdownSuggestionOperation[] {
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

export function suggestionDiffParts(
  before: string,
  after: string,
): DiffPart[] | null {
  const parts = diffParts(before, after);
  return parts && absorbIncidentalEqualities(parts);
}

function wholeWordReplacements(
  before: string,
  operations: MarkdownSuggestionOperation[],
  beforeMarked: MarkedSourceRanges,
  afterMarked: MarkedSourceRanges,
): MarkdownSuggestionOperation[] {
  const groups: Array<{
    from: number;
    to: number;
    members: MarkdownSuggestionOperation[];
  }> = [];
  for (const operation of operations) {
    const { from, to } = operation.anchor;
    const removed = operation.before.changedText;
    const inserted = operation.after.changedText;
    const lexicalChange = /[\p{L}\p{M}\p{N}]/u.test(removed + inserted);
    let group = { from, to, members: [operation] };
    if (
      lexicalChange &&
      !/<br\/?\s*>/u.test(removed + inserted) &&
      (removed || !/\s/u.test(inserted)) &&
      (isWordBefore(before, from) || isWordAt(before, to))
    ) {
      while (isWordBefore(before, group.from))
        group.from -= characterBefore(before, group.from).length;
      while (isWordAt(before, group.to))
        group.to += characterAt(before, group.to).length;
    }
    // Two edits inside one word are one review decision.
    while (groups.length && group.from < groups[groups.length - 1]!.to) {
      const previous = groups.pop()!;
      group = {
        from: Math.min(previous.from, group.from),
        to: Math.max(previous.to, group.to),
        members: [...previous.members, ...group.members],
      };
    }
    groups.push(group);
  }
  const result = groups.map((group, ordinal) =>
    operationForChange(
      before,
      group.from,
      group.to,
      group.members.reduceRight(
        (text, operation) =>
          text.slice(0, operation.anchor.from - group.from) +
          operation.after.changedText +
          text.slice(operation.anchor.to - group.from),
        before.slice(group.from, group.to),
      ),
      ordinal,
    ),
  );
  let delta = 0;
  for (const operation of result) {
    const { from, to } = operation.anchor;
    const afterFrom = from + delta;
    const afterTo = afterFrom + operation.after.changedText.length;
    // Mark delimiters are not word characters today, so this catches only a
    // future mark syntax whose source starts or ends with one.
    for (const [ranges, boundaries] of [
      [beforeMarked, [from, to]],
      [afterMarked, [afterFrom, afterTo]],
    ] as const) {
      if (
        ranges.some((range) =>
          boundaries.some(
            (boundary) => boundary > range.from && boundary < range.to,
          ),
        )
      )
        return operations;
    }
    delta += operation.after.changedText.length - (to - from);
  }
  const reconstruct = (changes: MarkdownSuggestionOperation[]) =>
    [...changes]
      .reverse()
      .reduce(
        (text, change) =>
          text.slice(0, change.anchor.from) +
          change.after.changedText +
          text.slice(change.anchor.to),
        before,
      );
  if (reconstruct(result) !== reconstruct(operations))
    throw new Error(
      "Whole-word edit ranges do not reconstruct the proposed source",
    );
  return result;
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

export function markdownSuggestionOperationsForFindReplace(input: {
  before: string;
  find: string;
  replace: string;
  start: number;
}): MarkdownSuggestionOperation[] {
  const { before, find, replace, start } = input;
  const after = `${before.slice(0, start)}${replace}${before.slice(start + find.length)}`;
  if (after === before) return [];
  if (/^[\p{L}\p{M}\p{N}_]+$/u.test(find)) {
    return [operationForChange(before, start, start + find.length, replace, 0)];
  }
  const operations = markdownSuggestionOperations(before, after);
  let reconstructed = before;
  for (const operation of [...operations].reverse()) {
    reconstructed =
      reconstructed.slice(0, operation.anchor.from) +
      operation.after.changedText +
      reconstructed.slice(operation.anchor.to);
  }
  if (
    reconstructed !== after ||
    operations.some(
      (operation) =>
        operation.anchor.from < start ||
        operation.anchor.to > start + find.length,
    )
  ) {
    return [operationForChange(before, start, start + find.length, replace, 0)];
  }
  return operations;
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
    if (
      operations.length > 1 &&
      operations.every(
        (operation) =>
          operation.anchor.from >= from && operation.anchor.to <= to,
      )
    ) {
      return operations;
    }
    if (
      operations.length === 1 &&
      operations[0]!.anchor.from === from &&
      operations[0]!.anchor.to === to &&
      operations[0]!.after.markdown === after
    ) {
      return operations;
    }
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
  return isolateSiblingAnchorContexts(result);
}

export function markdownSuggestionOperationsForEditorRevision(input: {
  before: string;
  after: string;
  replacements: ReadonlyArray<{ from: number; to: number }>;
}): MarkdownSuggestionOperation[] {
  if (input.before === "" || input.before === EMPTY_BLOCK) {
    if (input.after === "" || input.after === EMPTY_BLOCK) return [];
    if (input.replacements.length > 0)
      throw new SuggestionFormattingMappingError();
    markdownSuggestionOperations(input.before, input.after);
    return [
      {
        ...operationForChange(
          input.before,
          0,
          input.before.length,
          input.after,
          0,
        ),
        kind: "add_text_block",
      },
    ];
  }
  const alignment = suggestionSourceAlignment(input.before);
  const editorBefore = alignment
    ? alignment.canonical
    : canonicalizeNfm(input.before);
  const replacements = input.replacements.map(({ from, to }) => {
    const aligned = alignment && alignedRange(alignment, from, to, "stored");
    if (aligned) return aligned;
    const changedText = input.before.slice(from, to);
    const range = resolveMarkdownSuggestionRange(editorBefore, {
      before: { markdown: input.before, changedText },
      after: { markdown: input.before, changedText },
      anchor: {
        from,
        to,
        prefix: input.before.slice(Math.max(0, from - 32), from),
        suffix: input.before.slice(to, to + 32),
      },
    });
    if (!range) throw new SuggestionFormattingMappingError();
    return range;
  });
  const operations = markdownSuggestionOperationsForReplacements({
    before: editorBefore,
    after: input.after,
    replacements,
  });
  return isolateSiblingAnchorContexts(
    (alignment &&
      alignedStoredOperations(
        input.before,
        input.after,
        operations,
        alignment,
      )) ??
      operations.map((operation, ordinal) => {
        const range = resolveMarkdownSuggestionRange(input.before, operation);
        if (!range) throw new SuggestionFormattingMappingError();
        return operationForChange(
          input.before,
          range.from,
          range.to,
          operation.after.changedText,
          ordinal,
        );
      }),
  );
}

function alignedRange(
  alignment: SuggestionSourceAlignment,
  from: number,
  to: number,
  side: "canonical" | "stored",
) {
  const alignedFrom = alignment.map(from, side);
  const alignedTo = alignment.map(to, side);
  return alignedFrom === null || alignedTo === null
    ? null
    : { from: alignedFrom, to: alignedTo };
}

function alignedStoredOperations(
  before: string,
  after: string,
  operations: MarkdownSuggestionOperation[],
  alignment: SuggestionSourceAlignment,
): MarkdownSuggestionOperation[] | null {
  const stored: MarkdownSuggestionOperation[] = [];
  for (const operation of operations) {
    const range = alignedRange(
      alignment,
      operation.anchor.from,
      operation.anchor.to,
      "canonical",
    );
    if (!range) return null;
    stored.push(
      operationForChange(
        before,
        range.from,
        range.to,
        operation.after.changedText,
        stored.length,
      ),
    );
  }
  let reconstructed = before;
  for (const operation of [...stored].reverse())
    reconstructed =
      reconstructed.slice(0, operation.anchor.from) +
      operation.after.changedText +
      reconstructed.slice(operation.anchor.to);
  // An edit spanning a gap writes the editor's syntax for it, which a stored
  // pipe table cannot hold; only a reparse shows the page still matches.
  return reconstructed === after ||
    canonicalizeNfm(reconstructed) === canonicalizeNfm(after)
    ? stored
    : null;
}

// Replays the operations onto the base's canonical form; the result must be
// the draft byte for byte, so every anchor lands where the editor shows it.
function alignedDraftAnchors(
  operations: readonly MarkdownSuggestionOperation[],
  draft: string,
): MarkdownSuggestionOperation["anchor"][] | null {
  const alignment = suggestionSourceAlignment(operations[0]!.before.markdown);
  if (!alignment) return null;
  const ranges: Array<{ from: number; to: number }> = [];
  let reconstructed = "";
  let cursor = 0;
  for (const operation of operations) {
    const range = alignedRange(
      alignment,
      operation.anchor.from,
      operation.anchor.to,
      "stored",
    );
    if (!range || range.from < cursor) return null;
    reconstructed += alignment.canonical.slice(cursor, range.from);
    ranges.push({
      from: reconstructed.length,
      to: reconstructed.length + operation.after.changedText.length,
    });
    reconstructed += operation.after.changedText;
    cursor = range.to;
  }
  if (reconstructed + alignment.canonical.slice(cursor) !== draft) return null;
  return ranges.map(({ from, to }) => ({
    from,
    to,
    prefix: draft.slice(Math.max(0, from - 32), from),
    suffix: draft.slice(to, to + 32),
  }));
}

export function draftSuggestionAnchors(
  operations: readonly MarkdownSuggestionOperation[],
  draft: string,
): MarkdownSuggestionOperation["anchor"][] {
  if (operations.length === 0) return [];
  const aligned = alignedDraftAnchors(operations, draft);
  if (aligned) return aligned;
  let proposedRaw = operations[0]!.before.markdown;
  for (const operation of [...operations].reverse()) {
    proposedRaw =
      proposedRaw.slice(0, operation.anchor.from) +
      operation.after.changedText +
      proposedRaw.slice(operation.anchor.to);
  }
  const parts = diffParts(proposedRaw, draft);
  if (!parts) throw new SuggestionFormattingMappingError();
  const boundaryMap = new Array<number>(proposedRaw.length + 1);
  let rawOffset = 0;
  let draftOffset = 0;
  boundaryMap[0] = 0;
  for (const part of parts) {
    if (part.type === "insert") {
      draftOffset += part.text.length;
      boundaryMap[rawOffset] = draftOffset;
      continue;
    }
    for (let index = 0; index < part.text.length; index += 1) {
      rawOffset += 1;
      if (part.type === "equal") draftOffset += 1;
      boundaryMap[rawOffset] = draftOffset;
    }
  }
  if (rawOffset !== proposedRaw.length || draftOffset !== draft.length)
    throw new SuggestionFormattingMappingError();

  let delta = 0;
  return operations.map((operation) => {
    const rawFrom = operation.anchor.from + delta;
    const rawTo = rawFrom + operation.after.changedText.length;
    const from = boundaryMap[rawFrom];
    const to = boundaryMap[rawTo];
    if (
      from === undefined ||
      to === undefined ||
      draft.slice(from, to) !== operation.after.changedText
    )
      throw new SuggestionFormattingMappingError();
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
