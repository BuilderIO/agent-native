import type { ResourceSuggestion } from "@agent-native/core/review";
import { canonicalizeNfm } from "@shared/nfm";
import { operationOnText } from "@shared/suggestion-apply";
import {
  joinRewrittenParagraphs,
  listNumberDifferences,
  markdownSuggestionOperations,
  type MarkdownSuggestionOperation,
} from "@shared/suggestion-diff";
import {
  SuggestionFormattingMappingError,
  suggestionSourceAlignment,
} from "@shared/suggestion-formatting";
import {
  resolveMarkdownSuggestionRange,
  resolveOutsideChange,
} from "@shared/suggestion-rebase";

type MarkdownOperation = Parameters<typeof resolveMarkdownSuggestionRange>[1];
type Range = { from: number; to: number };
type Change = Range & { beforeText: string; afterText: string };
type PendingSuggestion = Pick<
  ResourceSuggestion,
  "id" | "status" | "operations"
> & { revision?: ResourceSuggestion["revision"] };

export type SuggestionPresentationTransition = {
  before: string;
  after: string;
  changes: Change[];
};
export type SuggestionPresentationTransitions = ReadonlyMap<
  string,
  SuggestionPresentationTransition
>;

function checkedOperation(operation: MarkdownOperation) {
  const before = operation.before as {
    markdown?: unknown;
    changedText?: unknown;
  } | null;
  const after = operation.after as {
    markdown?: unknown;
    changedText?: unknown;
  } | null;
  if (
    typeof before?.markdown !== "string" ||
    typeof before.changedText !== "string" ||
    typeof after?.markdown !== "string" ||
    typeof after.changedText !== "string"
  )
    return null;
  const beforeLength = before.markdown.length;
  const siblings = (operation.anchor as { siblingRanges?: unknown } | null)
    ?.siblingRanges;
  if (
    siblings !== undefined &&
    (!Array.isArray(siblings) ||
      siblings.some(
        (range) =>
          !range ||
          typeof range !== "object" ||
          !Number.isInteger(range.from) ||
          !Number.isInteger(range.to) ||
          range.from < 0 ||
          range.to < range.from ||
          range.to > beforeLength,
      ))
  )
    return null;
  const range = resolveMarkdownSuggestionRange(before.markdown, operation);
  return range
    ? {
        before: { markdown: before.markdown, changedText: before.changedText },
        after: { markdown: after.markdown, changedText: after.changedText },
        range,
      }
    : null;
}

function intersects(left: Range, right: Range) {
  return left.from === left.to || right.from === right.to
    ? left.from <= right.to && left.to >= right.from
    : left.from < right.to && left.to > right.from;
}

// An edit that only touches another, even an insertion at another insertion's
// offset, still has one place beside it.
function overlaps(left: Range, right: Range) {
  return left.from < right.to && left.to > right.from;
}

// Acceptance holds every accepted range fixed and places a pending edit in the
// first stretch of text between them that contains it.
function placedAfter(change: Range, target: Range) {
  return change.to <= target.from && change.from < target.to;
}

function reconstruct(before: string, changes: Change[]) {
  let cursor = 0;
  let result = "";
  let previous: Change | undefined;
  for (const change of changes) {
    if (
      !change ||
      typeof change !== "object" ||
      !Number.isInteger(change.from) ||
      !Number.isInteger(change.to) ||
      change.from < cursor ||
      change.to < change.from ||
      change.to > before.length ||
      typeof change.beforeText !== "string" ||
      typeof change.afterText !== "string" ||
      before.slice(change.from, change.to) !== change.beforeText ||
      (previous && intersects(previous, change))
    )
      return null;
    result += before.slice(cursor, change.from) + change.afterText;
    cursor = change.to;
    previous = change;
  }
  return result + before.slice(cursor);
}

function verifiedTransition(transition: SuggestionPresentationTransition) {
  return (
    typeof transition.before === "string" &&
    typeof transition.after === "string" &&
    transition.before.length + transition.after.length <= 128_000 &&
    Array.isArray(transition.changes) &&
    transition.changes.length > 0 &&
    transition.before !== transition.after &&
    reconstruct(transition.before, transition.changes) === transition.after
  );
}

// Saved operations keep their identity across renders, and each one diffs a
// full Page, so a Page with many suggestions reuses the result.
const presentationOperationsBySaved = new WeakMap<
  object,
  ReturnType<typeof computeSuggestionPresentationOperations>
>();

function suggestionPresentationOperations(operation: MarkdownOperation) {
  const cached = presentationOperationsBySaved.get(operation);
  if (cached !== undefined) return cached;
  const computed = computeSuggestionPresentationOperations(operation);
  presentationOperationsBySaved.set(operation, computed);
  return computed;
}

/** A saved operation cut down to the words each of its changes touches. */
export function preciseSuggestionPresentationOperations(
  operation: MarkdownOperation,
) {
  const computed = suggestionPresentationOperations(operation);
  return computed ? computed.precise : null;
}

/**
 * The changes to draw for a saved operation: its precise changes, with each
 * paragraph they mostly rewrite drawn as one. Storing joins such a paragraph,
 * so drawing it split would show word pieces after all. Rebasing keeps the
 * precise changes: a joined change also covers the words it keeps, so another
 * edit to those words would seem to collide with it.
 */
export function drawnSuggestionPresentationOperations(
  operation: MarkdownOperation,
) {
  const computed = suggestionPresentationOperations(operation);
  return computed ? computed.drawn : null;
}

function computeSuggestionPresentationOperations(operation: MarkdownOperation) {
  const identity = operation as MarkdownOperation & {
    targetId?: unknown;
    kind?: unknown;
  };
  if (
    identity.targetId !== "body" ||
    typeof identity.kind !== "string" ||
    ![
      "insert_text",
      "delete_text",
      "replace_text",
      "add_text_block",
      "set_inline_mark",
    ].includes(identity.kind)
  )
    return null;
  const checked = checkedOperation(operation);
  if (
    !checked ||
    checked.before.markdown.length + checked.after.markdown.length > 128_000
  )
    return null;
  try {
    const siblings =
      (operation.anchor as { siblingRanges?: Range[] }).siblingRanges ?? [];
    const spans = (pieces: MarkdownSuggestionOperation[]) => {
      const changes = pieces.map((span) => ({
        from: span.anchor.from,
        to: span.anchor.to,
        beforeText: span.before.changedText,
        afterText: span.after.changedText,
      }));
      if (
        pieces.length === 0 ||
        changes.some(
          (span) =>
            span.from < checked.range.from || span.to > checked.range.to,
        ) ||
        reconstruct(checked.before.markdown, changes) !== checked.after.markdown
      )
        return null;
      return pieces.map((span) => ({
        ...span,
        anchor: {
          ...span.anchor,
          siblingRanges: [...(span.anchor.siblingRanges ?? []), ...siblings],
        },
      }));
    };
    const pieces = markdownSuggestionOperations(
      checked.before.markdown,
      checked.after.markdown,
    );
    const precise = spans(pieces);
    if (!precise) return null;
    const joined = joinRewrittenParagraphs(checked.before.markdown, pieces);
    const drawn = joined === pieces ? precise : spans(joined);
    return { precise, drawn: drawn ?? precise };
  } catch (error) {
    if (!(error instanceof SuggestionFormattingMappingError)) throw error;
    return null;
  }
}

export function createCommittedSuggestionPresentationTransition(
  committed: Array<Pick<ResourceSuggestion, "status" | "operations">>,
): SuggestionPresentationTransition | null {
  if (committed.some((suggestion) => suggestion.status !== "accepted"))
    return null;
  return createObservedSuggestionPresentationTransition(committed);
}

export function createObservedSuggestionPresentationTransition(
  requested: Array<Pick<ResourceSuggestion, "operations">>,
): SuggestionPresentationTransition | null {
  if (
    requested.length === 0 ||
    requested.some((suggestion) => suggestion.operations.length !== 1)
  )
    return null;
  let before: string | undefined;
  const changes: Change[] = [];
  for (const suggestion of requested) {
    const operation = suggestion.operations[0]!;
    const checked = checkedOperation(operation);
    if (
      !checked ||
      (before !== undefined && checked.before.markdown !== before)
    )
      return null;
    before = checked.before.markdown;
    const precise = preciseSuggestionPresentationOperations(operation);
    if (!precise) return null;
    const memberChanges = precise.map((span) => ({
      from: span.anchor.from,
      to: span.anchor.to,
      beforeText: span.before.changedText,
      afterText: span.after.changedText,
    }));
    changes.push(...memberChanges);
  }
  if (before === undefined) return null;
  changes.sort((left, right) => left.from - right.from || left.to - right.to);
  const after = reconstruct(before, changes);
  if (after === null) return null;
  const transition = { before, after, changes };
  return verifiedTransition(transition) ? transition : null;
}

// A draft's operations address the stored Page, but the editor shows them on
// the Page's canonical form, which can differ, as a pipe table does.
export function createDraftSuggestionPresentationTransition(
  drafts: Array<Pick<ResourceSuggestion, "operations">>,
  draftMarkdown: string,
): SuggestionPresentationTransition | null {
  const operations = drafts.flatMap((draft) => draft.operations);
  const base =
    operations[0] && checkedOperation(operations[0])?.before.markdown;
  const alignment = base === undefined ? null : suggestionSourceAlignment(base);
  if (!alignment) return null;
  const changes: Change[] = [];
  for (const operation of operations) {
    const checked = checkedOperation(operation);
    if (!checked || checked.before.markdown !== base) return null;
    const from = alignment.map(checked.range.from, "stored");
    const to = alignment.map(checked.range.to, "stored");
    if (from === null || to === null) return null;
    changes.push({
      from,
      to,
      beforeText: alignment.canonical.slice(from, to),
      afterText: checked.after.changedText,
    });
  }
  changes.sort((left, right) => left.from - right.from || left.to - right.to);
  const numbered = withListNumberChanges(
    alignment.canonical,
    changes,
    draftMarkdown,
  );
  if (!numbered) return null;
  const transition = {
    before: alignment.canonical,
    after: draftMarkdown,
    changes: numbered,
  };
  return verifiedTransition(transition) ? transition : null;
}

function itemAt<T>(items: readonly T[], index: number): T | undefined {
  return items[index];
}

function withListNumberChanges(
  before: string,
  changes: Change[],
  after: string,
): Change[] | null {
  const edits = joinedChanges(before, changes);
  if (!edits) return null;
  const proposed = reconstruct(before, edits);
  if (proposed === null) return null;
  if (proposed === after) return edits;
  const numbers = listNumberDifferences(proposed, after);
  if (!numbers) return null;
  const numberChanges: Change[] = [];
  const numbersInsideEdits = new Map<
    Change,
    Array<{ from: number; to: number; number: string }>
  >();
  let index = 0;
  let delta = 0;
  for (const number of numbers) {
    for (; index < edits.length; index += 1) {
      const passed = itemAt(edits, index);
      if (
        !passed ||
        passed.from + delta + passed.afterText.length > number.from
      )
        break;
      delta += passed.afterText.length - (passed.to - passed.from);
    }
    const edit = itemAt(edits, index);
    if (edit && edit.from + delta < number.to) {
      const offset = number.from - edit.from - delta;
      const end = offset + number.to - number.from;
      if (offset < 0 || end > edit.afterText.length) return null;
      const inside = numbersInsideEdits.get(edit) ?? [];
      inside.push({ from: offset, to: end, number: number.number });
      numbersInsideEdits.set(edit, inside);
      continue;
    }
    const from = number.from - delta;
    const to = number.to - delta;
    numberChanges.push({
      from,
      to,
      beforeText: before.slice(from, to),
      afterText: number.number,
    });
  }
  for (const [edit, inside] of numbersInsideEdits)
    for (const number of inside.reverse())
      edit.afterText =
        edit.afterText.slice(0, number.from) +
        number.number +
        edit.afterText.slice(number.to);
  return joinedChanges(before, [...edits, ...numberChanges]);
}

function joinedChanges(before: string, changes: Change[]): Change[] | null {
  const merged: Change[] = [];
  for (const change of [...changes].sort(
    (left, right) => left.from - right.from || left.to - right.to,
  )) {
    const previous = merged.length > 0 ? merged[merged.length - 1] : null;
    if (!previous || !intersects(previous, change)) {
      merged.push({ ...change });
      continue;
    }
    if (change.from < previous.to) return null;
    previous.afterText +=
      before.slice(previous.to, change.from) + change.afterText;
    previous.to = change.to;
    previous.beforeText = before.slice(previous.from, previous.to);
  }
  return merged;
}

function dependentOperation(
  operation: MarkdownOperation,
  transition: SuggestionPresentationTransition,
) {
  if (!verifiedTransition(transition)) return null;
  const checked = checkedOperation(operation);
  if (
    !checked ||
    checked.before.markdown !== transition.before ||
    transition.changes.some((change) => overlaps(checked.range, change))
  )
    return null;
  return checked;
}

function dependentPresentationOperations(
  operation: MarkdownOperation,
  transition: SuggestionPresentationTransition,
) {
  const precise = preciseSuggestionPresentationOperations(operation) ?? [
    operation,
  ];
  return precise.every((span) => dependentOperation(span, transition))
    ? precise
    : null;
}

function combinePresentationTransitions(
  left: SuggestionPresentationTransition,
  right: SuggestionPresentationTransition,
) {
  if (
    !verifiedTransition(left) ||
    !verifiedTransition(right) ||
    left.before !== right.before
  )
    return null;
  const changes = [
    ...new Map(
      [...left.changes, ...right.changes].map((change) => [
        JSON.stringify([
          change.from,
          change.to,
          change.beforeText,
          change.afterText,
        ]),
        change,
      ]),
    ).values(),
  ].sort((first, second) => first.from - second.from || first.to - second.to);
  const after = reconstruct(left.before, changes);
  if (after === null) return null;
  const combined = { before: left.before, after, changes };
  return verifiedTransition(combined) ? combined : null;
}

export function suggestionPresentationTransitionKey(
  suggestion: PendingSuggestion,
) {
  return JSON.stringify([
    suggestion.id,
    suggestion.revision,
    suggestion.operations,
  ]);
}

export function pruneSuggestionPresentationTransitions(
  current: SuggestionPresentationTransitions,
  suggestions: PendingSuggestion[],
): SuggestionPresentationTransitions {
  const pending = new Set(
    suggestions
      .filter((suggestion) => suggestion.status === "pending")
      .map(suggestionPresentationTransitionKey),
  );
  return [...current.keys()].every((key) => pending.has(key))
    ? current
    : new Map([...current].filter(([key]) => pending.has(key)));
}

export function retainCommittedSuggestionPresentationTransitions(
  current: SuggestionPresentationTransitions,
  pending: PendingSuggestion[],
  committed: Array<Pick<ResourceSuggestion, "id" | "status" | "operations">>,
): SuggestionPresentationTransitions {
  const retained = pruneSuggestionPresentationTransitions(current, pending);
  const transition = createCommittedSuggestionPresentationTransition(committed);
  if (!transition) return retained;
  const committedIds = new Set(committed.map((suggestion) => suggestion.id));
  const next = new Map(retained);
  for (const suggestion of pending) {
    const key = suggestionPresentationTransitionKey(suggestion);
    const known = next.get(key);
    const candidate = known
      ? combinePresentationTransitions(known, transition)
      : transition;
    if (
      suggestion.status === "pending" &&
      !committedIds.has(suggestion.id) &&
      suggestion.operations.length === 1 &&
      candidate
    ) {
      const precise = dependentPresentationOperations(
        suggestion.operations[0]!,
        candidate,
      );
      if (
        precise?.every(
          (span) =>
            resolveSuggestionPresentationRange(
              candidate.after,
              span,
              candidate,
            ) !== null,
        )
      )
        next.set(key, candidate);
    }
  }
  return next;
}

function placesOnResult(
  operation: MarkdownOperation,
  transition: SuggestionPresentationTransition,
) {
  const precise = dependentPresentationOperations(operation, transition);
  return (
    precise !== null &&
    precise.every(
      (span) =>
        resolveSuggestionPresentationRange(
          transition.after,
          span,
          transition,
        ) !== null,
    )
  );
}

// A piece can depend on several accepted edits at once, such as the rest of its
// own edit and a neighboring one. None of them alone explains the Page then, but
// together they can. Records that only repeat one another add no proof.
function jointTransition(
  operation: MarkdownOperation,
  transitions: SuggestionPresentationTransition[],
) {
  const [first = null, ...rest] = transitions;
  if (!first || rest.length === 0) return null;
  const joint = rest.reduce<SuggestionPresentationTransition | null>(
    (all, transition) => all && combinePresentationTransitions(all, transition),
    first,
  );
  return joint &&
    transitions.every(({ changes }) => joint.changes.length > changes.length) &&
    placesOnResult(operation, joint)
    ? joint
    : null;
}

type SavedOperation = ResourceSuggestion["operations"][number];
const operationsOnBasis = new WeakMap<
  SavedOperation,
  Map<string, SavedOperation | null>
>();

function firstOperation(suggestion: {
  operations: SavedOperation[];
}): SavedOperation | undefined {
  return suggestion.operations[0];
}

function operationOnBasis(operation: SavedOperation, basis: string) {
  let moved = operationsOnBasis.get(operation);
  if (!moved) operationsOnBasis.set(operation, (moved = new Map()));
  const known = moved.get(basis);
  if (known !== undefined) return known;
  const anchor = operation.anchor as {
    prefix?: unknown;
    suffix?: unknown;
  } | null;
  const result =
    typeof anchor?.prefix === "string" && typeof anchor.suffix === "string"
      ? operationOnText(operation, basis)
      : null;
  moved.set(basis, result);
  return result;
}

export function hydrateSuggestionPresentationTransitions(
  current: SuggestionPresentationTransitions,
  suggestions: Array<
    PendingSuggestion & { proposalId?: ResourceSuggestion["proposalId"] }
  >,
  committed: Array<
    Pick<ResourceSuggestion, "status" | "operations"> & {
      proposalId?: ResourceSuggestion["proposalId"];
    }
  >,
  currentContent: string,
): SuggestionPresentationTransitions {
  const retained = pruneSuggestionPresentationTransitions(current, suggestions);
  const missing = suggestions.filter(
    (suggestion) =>
      suggestion.status === "pending" &&
      suggestion.operations.length === 1 &&
      !retained.has(suggestionPresentationTransitionKey(suggestion)),
  );
  if (missing.length === 0) return retained;
  const bases = new Set<string>();
  const proposalBases = new Map<string, Set<string>>();
  for (const suggestion of missing) {
    const [operation] = suggestion.operations;
    const basis = operation && checkedOperation(operation)?.before.markdown;
    if (basis === undefined) continue;
    bases.add(basis);
    if (!suggestion.proposalId) continue;
    const known = proposalBases.get(suggestion.proposalId) ?? new Set();
    proposalBases.set(suggestion.proposalId, known.add(basis));
  }
  const groups = new Map<string, typeof committed>();
  const group = (key: string, member: (typeof committed)[number]) => {
    const members = groups.get(key) ?? [];
    members.push(member);
    groups.set(key, members);
  };
  committed.forEach((suggestion, index) => {
    const operation = firstOperation(suggestion);
    if (!operation || suggestion.status !== "accepted") return;
    const basis = checkedOperation(operation)?.before.markdown;
    if (basis === undefined) return;
    if (bases.has(basis))
      group(
        suggestion.proposalId
          ? JSON.stringify([suggestion.proposalId, basis])
          : `record:${index}`,
        suggestion,
      );
    const late = suggestion.proposalId
      ? proposalBases.get(suggestion.proposalId)
      : undefined;
    for (const onto of late ?? []) {
      const moved = onto === basis ? null : operationOnBasis(operation, onto);
      if (moved)
        group(JSON.stringify([suggestion.proposalId, onto]), {
          ...suggestion,
          operations: [moved],
        });
    }
  });
  const candidates = [...groups.values()]
    .map(createCommittedSuggestionPresentationTransition)
    .filter(
      (transition): transition is SuggestionPresentationTransition =>
        transition !== null,
    );
  const canonical = canonicalizeNfm(currentContent);
  let next: Map<string, SuggestionPresentationTransition> | undefined;
  for (const suggestion of missing) {
    const operation = suggestion.operations[0]!;
    const matching = candidates.filter((transition) =>
      placesOnResult(operation, transition),
    );
    const [only, ...others] = matching;
    const transition =
      others.length === 0 ? only : jointTransition(operation, matching);
    if (!transition) continue;
    const precise = dependentPresentationOperations(operation, transition)!;
    if (
      canonical !== canonicalizeNfm(transition.before) &&
      precise.some(
        (span) =>
          resolveSuggestionPresentationRange(canonical, span, transition) ===
          null,
      )
    )
      continue;
    next ??= new Map(retained);
    next.set(suggestionPresentationTransitionKey(suggestion), transition);
  }
  return next ?? retained;
}

export function resolveSuggestionPresentationRange(
  currentMarkdown: string,
  operation: MarkdownOperation,
  transition?: SuggestionPresentationTransition,
  observedTransition?: SuggestionPresentationTransition,
): Range | null {
  if (!checkedOperation(operation)) return null;
  const ordinary = resolveMarkdownSuggestionRange(currentMarkdown, operation);
  if (ordinary) return ordinary;
  const observed = observedTransition
    ? transition
      ? combinePresentationTransitions(transition, observedTransition)
      : observedTransition
    : null;
  if (observedTransition && (!observed || !verifiedTransition(observed)))
    return null;
  if (
    observed &&
    (currentMarkdown === observed.after ||
      currentMarkdown === canonicalizeNfm(observed.after))
  ) {
    transition = observed;
  }
  if (!transition) return ordinary;
  const checked = dependentOperation(operation, transition);
  if (!checked) return ordinary;
  if (
    currentMarkdown === transition.before ||
    canonicalizeNfm(transition.before) === currentMarkdown
  )
    return ordinary;
  const anchor = operation.anchor as Range & {
    prefix: string;
    suffix: string;
    siblingRanges?: Range[];
  };
  const siblings = [...(anchor.siblingRanges ?? []), ...transition.changes]
    .map(({ from, to }) => ({ from, to }))
    .sort((left, right) => left.from - right.from || left.to - right.to);
  const union: Range[] = [];
  for (const sibling of siblings) {
    if (overlaps(checked.range, sibling)) return null;
    const previous = union[union.length - 1];
    if (previous && sibling.from <= previous.to)
      previous.to = Math.max(previous.to, sibling.to);
    else union.push(sibling);
  }
  const range = resolveMarkdownSuggestionRange(transition.after, {
    ...operation,
    anchor: { ...anchor, siblingRanges: union },
  });
  // Masked context must agree with the exact committed edits and unchanged target.
  const shift = transition.changes
    .filter((change) => placedAfter(change, checked.range))
    .reduce(
      (delta, change) =>
        delta + change.afterText.length - change.beforeText.length,
      0,
    );
  if (
    !range ||
    range.from !== checked.range.from + shift ||
    range.to !== checked.range.to + shift ||
    transition.after.slice(range.from, range.to) !== checked.before.changedText
  )
    return null;
  if (currentMarkdown === transition.after) return range;
  const source =
    currentMarkdown === canonicalizeNfm(currentMarkdown)
      ? canonicalizeNfm(transition.after)
      : transition.after;
  const unchanged = {
    markdown: transition.after,
    changedText: transition.after.slice(range.from, range.to),
  };
  const projectedRange =
    source === transition.after
      ? range
      : resolveMarkdownSuggestionRange(source, {
          before: unchanged,
          after: unchanged,
          anchor: {
            ...range,
            prefix: transition.after.slice(
              Math.max(0, range.from - 32),
              range.from,
            ),
            suffix: transition.after.slice(range.to, range.to + 32),
          },
        });
  if (!projectedRange) return null;
  if (source !== transition.after)
    return resolveOutsideChange(source, currentMarkdown, projectedRange);
  const text = source.slice(projectedRange.from, projectedRange.to);
  return resolveMarkdownSuggestionRange(currentMarkdown, {
    before: { markdown: source, changedText: text },
    after: {
      markdown:
        source.slice(0, projectedRange.from) +
        checked.after.changedText +
        source.slice(projectedRange.to),
      changedText: checked.after.changedText,
    },
    anchor: {
      ...projectedRange,
      prefix: source.slice(
        Math.max(0, projectedRange.from - 32),
        projectedRange.from,
      ),
      suffix: source.slice(projectedRange.to, projectedRange.to + 32),
    },
  });
}

// Text typed at a saved suggestion's spot splits the context that places it on
// the draft, so place it on the draft's base and carry it across the draft's
// edits. The editor maps a highlight past text typed at its position, so a
// saved edit stays after a draft insertion at the same offset.
export function resolveSuggestionPresentationRangeInDraft(
  draft: SuggestionPresentationTransition,
  operation: MarkdownOperation,
  transition?: SuggestionPresentationTransition,
  observedTransition?: SuggestionPresentationTransition,
): Range | null {
  if (!verifiedTransition(draft)) return null;
  const range = resolveSuggestionPresentationRange(
    draft.before,
    operation,
    transition,
    observedTransition,
  );
  if (!range || draft.changes.some((change) => overlaps(range, change)))
    return null;
  const shift = draft.changes
    .filter((change) => change.to <= range.from)
    .reduce(
      (delta, change) =>
        delta + change.afterText.length - change.beforeText.length,
      0,
    );
  return { from: range.from + shift, to: range.to + shift };
}
