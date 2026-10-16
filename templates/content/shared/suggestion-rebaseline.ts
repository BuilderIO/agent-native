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
  /** The suggestion couldn't be placed on the stored body either. */
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

type Placed = {
  range: MarkdownRange;
  before: string;
  after: string;
};

function placeOnCanonical(
  operation: MarkdownSuggestionOperationLike,
  stored: string,
  canonical: string,
): Placed | "stale" | { blocked: "change_vanishes" | "structure_unsupported" } {
  const after = markdownPayload(operation.after, "after");
  const storedRange = resolveMarkdownSuggestionRange(stored, operation);
  if (!storedRange) return "stale";
  const storedAfter = `${stored.slice(0, storedRange.from)}${after.changedText ?? ""}${stored.slice(storedRange.to)}`;
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
    stored === canonical
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
    operationAnchor(suggestion.operation);
    if (before.markdown === canonical) {
      outcomes.set(suggestion.id, { kind: "unchanged" });
      continue;
    }
    const result = placeOnCanonical(suggestion.operation, stored, canonical);
    if (result === "stale") outcomes.set(suggestion.id, { kind: "stale" });
    else if ("blocked" in result)
      outcomes.set(suggestion.id, { kind: "blocked", reason: result.blocked });
    else placed.set(suggestion.id, result);
  }

  for (const suggestion of suggestions) {
    const own = placed.get(suggestion.id);
    if (!own) continue;
    const anchor = operationAnchor(suggestion.operation);
    // Siblings saved together keep listing each other, and each one's
    // context stops at its neighbors, as when they were first saved.
    const siblings = anchor.siblingRanges?.length
      ? suggestions
          .filter(
            (other) =>
              other.id !== suggestion.id &&
              other.group === suggestion.group &&
              placed.has(other.id),
          )
          .map((other) => placed.get(other.id)!.range)
          .sort((left, right) => left.from - right.from)
      : [];
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
