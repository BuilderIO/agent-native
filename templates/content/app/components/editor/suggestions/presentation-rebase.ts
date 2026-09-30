import type { ResourceSuggestion } from "@agent-native/core/review";
import { canonicalizeNfm } from "@shared/nfm";
import { markdownSuggestionOperations } from "@shared/suggestion-diff";
import { SuggestionFormattingMappingError } from "@shared/suggestion-formatting";
import { resolveMarkdownSuggestionRange } from "@shared/suggestion-rebase";

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

export function preciseSuggestionPresentationOperations(
  operation: MarkdownOperation,
) {
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
    const precise = markdownSuggestionOperations(
      checked.before.markdown,
      checked.after.markdown,
    );
    const changes = precise.map((span) => ({
      from: span.anchor.from,
      to: span.anchor.to,
      beforeText: span.before.changedText,
      afterText: span.after.changedText,
    }));
    if (
      precise.length === 0 ||
      changes.some(
        (span) => span.from < checked.range.from || span.to > checked.range.to,
      ) ||
      reconstruct(checked.before.markdown, changes) !== checked.after.markdown
    )
      return null;
    const siblings =
      (operation.anchor as { siblingRanges?: Range[] }).siblingRanges ?? [];
    return precise.map((span) => ({
      ...span,
      anchor: {
        ...span.anchor,
        siblingRanges: [...(span.anchor.siblingRanges ?? []), ...siblings],
      },
    }));
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

function dependentOperation(
  operation: MarkdownOperation,
  transition: SuggestionPresentationTransition,
) {
  if (!verifiedTransition(transition)) return null;
  const checked = checkedOperation(operation);
  if (
    !checked ||
    checked.before.markdown !== transition.before ||
    transition.changes.some((change) => intersects(checked.range, change))
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

function combineCommittedTransitions(
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
      ? combineCommittedTransitions(known, transition)
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

export function hydrateSuggestionPresentationTransitions(
  current: SuggestionPresentationTransitions,
  suggestions: PendingSuggestion[],
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
  const bases = new Set(
    missing.map(
      (suggestion) =>
        checkedOperation(suggestion.operations[0]!)?.before.markdown,
    ),
  );
  const groups = new Map<string, typeof committed>();
  committed.forEach((suggestion, index) => {
    const operation = suggestion.operations[0];
    const basis = operation && checkedOperation(operation)?.before.markdown;
    if (
      suggestion.status !== "accepted" ||
      basis === undefined ||
      !bases.has(basis)
    )
      return;
    const key = suggestion.proposalId
      ? JSON.stringify([suggestion.proposalId, basis])
      : `record:${index}`;
    const members = groups.get(key) ?? [];
    members.push(suggestion);
    groups.set(key, members);
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
    const matching = candidates.filter((transition) => {
      const precise = dependentPresentationOperations(operation, transition);
      return (
        precise &&
        precise.every(
          (span) =>
            resolveSuggestionPresentationRange(
              transition.after,
              span,
              transition,
            ) !== null,
        )
      );
    });
    if (matching.length !== 1) continue;
    const transition = matching[0]!;
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
  if (
    !transition &&
    observedTransition &&
    verifiedTransition(observedTransition) &&
    (currentMarkdown === observedTransition.after ||
      currentMarkdown === canonicalizeNfm(observedTransition.after))
  ) {
    transition = observedTransition;
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
    if (intersects(checked.range, sibling)) return null;
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
    .filter((change) => change.to <= checked.range.from)
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
  const text = transition.after.slice(range.from, range.to);
  return resolveMarkdownSuggestionRange(currentMarkdown, {
    before: { markdown: transition.after, changedText: text },
    after: {
      markdown:
        transition.after.slice(0, range.from) +
        checked.after.changedText +
        transition.after.slice(range.to),
      changedText: checked.after.changedText,
    },
    anchor: {
      ...range,
      prefix: transition.after.slice(Math.max(0, range.from - 32), range.from),
      suffix: transition.after.slice(range.to, range.to + 32),
    },
  });
}
