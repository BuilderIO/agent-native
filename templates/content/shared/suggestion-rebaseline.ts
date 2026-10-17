import { canonicalizeNfm } from "./nfm.js";
import {
  markdownPayload,
  operationAnchor,
  supportedSuggestionStructure,
  type MarkdownRange,
  type MarkdownSuggestionOperationLike,
} from "./suggestion-apply.js";
import {
  placeInCanonicalForm,
  resolveMarkdownSuggestionRange,
} from "./suggestion-rebase.js";

// When a page's stored body is rewritten into its canonical form, every
// pending suggestion is moved onto the canonical text so it reads, renders
// and applies there directly. A rebased suggestion makes exactly the change
// accepting it on the stored body would have made, in canonical form.

const ANCHOR_CONTEXT = 32;

export type RebaselineSuggestion<T extends MarkdownSuggestionOperationLike> = {
  id: string;
  /** Suggestions saved together from one text list each other as siblings. */
  group: string;
  operation: T;
};

export type SuggestionRebaseline<T> =
  /** Already on the canonical text. */
  | { kind: "unchanged" }
  | { kind: "rebased"; operation: T }
  /** Accepting it on the stored body would refuse it. */
  | { kind: "stale" }
  /**
   * Canonicalizing would change what accepting does: the change vanishes,
   * or a structure check it passes on the stored body fails on the
   * canonical one. Convert the page only once this is resolved.
   */
  | {
      kind: "blocked";
      reason: "change_vanishes" | "structure_unsupported";
    };

function commonPrefixLength(left: string, right: string) {
  const limit = Math.min(left.length, right.length);
  let length = 0;
  while (length < limit && left[length] === right[length]) length += 1;
  return length;
}

function commonSuffixLength(left: string, right: string, floor: number) {
  const limit = Math.min(left.length, right.length) - floor;
  let length = 0;
  while (
    length < limit &&
    left[left.length - 1 - length] === right[right.length - 1 - length]
  )
    length += 1;
  return length;
}

/** Null for a suggestion saved as the whole page before and after. */
function anchorOf(operation: MarkdownSuggestionOperationLike) {
  return operation.anchor == null ? null : operationAnchor(operation);
}

type Placed = {
  range: MarkdownRange;
  before: string;
  after: string;
};

type OnStored = { range: MarkdownRange | null; after: string };

/** What accepting `operation` on the stored body does; null when it's stale there. */
function acceptedOnStored(
  operation: MarkdownSuggestionOperationLike,
  stored: string,
): OnStored | null {
  const after = markdownPayload(operation.after, "after");
  const range = resolveMarkdownSuggestionRange(stored, operation);
  if (range)
    return {
      range,
      after: `${stored.slice(0, range.from)}${after.changedText ?? ""}${stored.slice(range.to)}`,
    };
  // Accepting a suggestion with no range replaces a page that still reads as
  // its before-state.
  return anchorOf(operation) === null &&
    markdownPayload(operation.before, "before").markdown === stored
    ? { range: null, after: after.markdown }
    : null;
}

function placeOnCanonical(
  { range: storedRange, after: storedAfter }: OnStored,
  stored: string,
  canonical: string,
): Placed | { blocked: "change_vanishes" | "structure_unsupported" } {
  const canonicalAfter = canonicalizeNfm(storedAfter);
  if (canonicalAfter === canonical) return { blocked: "change_vanishes" };
  if (
    supportedSuggestionStructure(stored, storedAfter) &&
    !supportedSuggestionStructure(canonical, canonicalAfter)
  )
    return { blocked: "structure_unsupported" };
  // The range the suggestion covers on the stored body, where it has a
  // counterpart in the canonical form, widened to every byte the change
  // touches there: canonicalizing can rewrite text next to the change.
  const mapped =
    !storedRange || stored === canonical
      ? storedRange
      : placeInCanonicalForm(stored, canonical, storedRange);
  const prefix = commonPrefixLength(canonical, canonicalAfter);
  const suffix = commonSuffixLength(canonical, canonicalAfter, prefix);
  const from = Math.min(prefix, mapped?.from ?? prefix);
  const to = Math.max(canonical.length - suffix, mapped?.to ?? 0);
  return {
    range: { from, to },
    before: canonical.slice(from, to),
    after: canonicalAfter.slice(
      from,
      canonicalAfter.length - (canonical.length - to),
    ),
  };
}

// Siblings saved together keep listing each other, and each one's context
// stops at its neighbors, as when they were first saved. A suggestion seen
// without its siblings, such as one proposal member being validated, maps the
// ranges it lists instead; those are positions in its own before-state, so
// that has to be the stored body. Null when a listed sibling can't be placed.
function siblingRangesOnCanonical<T extends MarkdownSuggestionOperationLike>(
  suggestion: RebaselineSuggestion<T>,
  suggestions: RebaselineSuggestion<T>[],
  placed: Map<string, Placed>,
  stored: string,
  canonical: string,
): MarkdownRange[] | null {
  const listed = anchorOf(suggestion.operation)?.siblingRanges ?? [];
  if (!listed.length) return [];
  const group = suggestions.filter(
    (other) =>
      other.id !== suggestion.id &&
      other.group === suggestion.group &&
      anchorOf(other.operation) !== null,
  );
  if (
    group.length ||
    markdownPayload(suggestion.operation.before, "before").markdown !== stored
  )
    return group
      .filter((other) => placed.has(other.id))
      .map((other) => placed.get(other.id)!.range)
      .sort((left, right) => left.from - right.from);
  const mapped = listed.map((range) =>
    placeInCanonicalForm(stored, canonical, range),
  );
  return mapped.every((range): range is MarkdownRange => range !== null)
    ? mapped.sort((left, right) => left.from - right.from)
    : null;
}

/**
 * Moves `suggestions`, all pending on a page whose stored body is `stored`,
 * onto `canonical`, the canonical form of `stored`. Each outcome is keyed by
 * suggestion id.
 */
export function rebaselineSuggestions<
  T extends MarkdownSuggestionOperationLike,
>(
  suggestions: RebaselineSuggestion<T>[],
  stored: string,
  canonical: string,
): Map<string, SuggestionRebaseline<T>> {
  const outcomes = new Map<string, SuggestionRebaseline<T>>();
  const placed = new Map<string, Placed>();
  for (const suggestion of suggestions) {
    const before = markdownPayload(suggestion.operation.before, "before");
    anchorOf(suggestion.operation);
    const onStored = acceptedOnStored(suggestion.operation, stored);
    if (!onStored) {
      outcomes.set(suggestion.id, { kind: "stale" });
      continue;
    }
    if (before.markdown === canonical) {
      outcomes.set(suggestion.id, { kind: "unchanged" });
      continue;
    }
    const result = placeOnCanonical(onStored, stored, canonical);
    if ("blocked" in result)
      outcomes.set(suggestion.id, { kind: "blocked", reason: result.blocked });
    else placed.set(suggestion.id, result);
  }

  for (const suggestion of suggestions) {
    const own = placed.get(suggestion.id);
    if (!own) continue;
    const siblings = siblingRangesOnCanonical(
      suggestion,
      suggestions,
      placed,
      stored,
      canonical,
    );
    if (!siblings) {
      outcomes.set(suggestion.id, { kind: "stale" });
      continue;
    }
    const previousEnd = Math.max(
      0,
      ...siblings
        .filter((range) => range.to <= own.range.from)
        .map((range) => range.to),
    );
    const nextStart = Math.min(
      canonical.length,
      ...siblings
        .filter((range) => range.from >= own.range.to)
        .map((range) => range.from),
    );
    const { from, to } = own.range;
    const afterMarkdown = `${canonical.slice(0, from)}${own.after}${canonical.slice(to)}`;
    // A range would let it accept on a page a sibling has since changed.
    if (anchorOf(suggestion.operation) === null) {
      outcomes.set(suggestion.id, {
        kind: "rebased",
        operation: {
          ...suggestion.operation,
          before: { markdown: canonical },
          after: { markdown: afterMarkdown },
        },
      });
      continue;
    }
    outcomes.set(suggestion.id, {
      kind: "rebased",
      operation: {
        ...suggestion.operation,
        before: { markdown: canonical, changedText: own.before },
        after: { markdown: afterMarkdown, changedText: own.after },
        anchor: {
          from,
          to,
          prefix: canonical.slice(
            Math.max(previousEnd, from - ANCHOR_CONTEXT),
            from,
          ),
          suffix: canonical.slice(to, Math.min(nextStart, to + ANCHOR_CONTEXT)),
          ...(siblings.length ? { siblingRanges: siblings } : {}),
        },
      },
    });
  }
  return outcomes;
}
