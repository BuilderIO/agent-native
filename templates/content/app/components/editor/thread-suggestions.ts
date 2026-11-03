import type { ResourceSuggestion } from "@agent-native/core/review";
import { nfmToDoc, type PMNode } from "@shared/nfm";

import { wordDiff } from "./comment-ai-diff";

/**
 * The comment thread an AI suggestion was asked for from, if any. Only a
 * suggestion bound to a comment AI request counts: the server checks that
 * request's thread, while any commenter can write `sourceThreadId` alone.
 */
export function suggestionSourceThreadId(
  suggestion: Pick<ResourceSuggestion, "metadata">,
): string | null {
  const source = suggestion.metadata?.sourceThreadId;
  return typeof source === "string" &&
    source &&
    typeof suggestion.metadata?.commentAiRequestId === "string"
    ? source
    : null;
}

/**
 * Whether a suggestion is reviewed inside this thread instead of on its own
 * card. A pending one whose thread was resolved goes back to its card, since a
 * resolved thread drops out of every open review view.
 */
export function reviewedInThread(
  suggestion: Pick<ResourceSuggestion, "metadata" | "status">,
  thread: { threadId: string; resolved: boolean },
): boolean {
  return (
    suggestionSourceThreadId(suggestion) === thread.threadId &&
    (!thread.resolved || suggestion.status !== "pending")
  );
}

/** Suggestions reviewed inside each comment thread on this page, oldest first. */
export function suggestionsByThread(
  suggestions: readonly ResourceSuggestion[],
  threads: readonly { threadId: string; resolved: boolean }[],
): Map<string, ResourceSuggestion[]> {
  const byId = new Map(threads.map((thread) => [thread.threadId, thread]));
  const grouped = new Map<string, ResourceSuggestion[]>();
  for (const suggestion of suggestions) {
    const threadId = suggestionSourceThreadId(suggestion);
    const thread = threadId ? byId.get(threadId) : undefined;
    if (!threadId || !thread || !reviewedInThread(suggestion, thread)) continue;
    const list = grouped.get(threadId) ?? [];
    list.push(suggestion);
    grouped.set(threadId, list);
  }
  for (const list of grouped.values()) {
    list.sort(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) ||
        left.id.localeCompare(right.id),
    );
  }
  return grouped;
}

function anchorStart(suggestion: ResourceSuggestion): number {
  const from = (suggestion.operations[0]?.anchor as { from?: unknown } | null)
    ?.from;
  return typeof from === "number" ? from : Number.POSITIVE_INFINITY;
}

/**
 * The edits reviewed together in a thread: every edit of one proposal in a
 * group, in Page order, and any other suggestion alone. Groups keep the order
 * of their first edit.
 */
export function proposalGroups(
  suggestions: readonly ResourceSuggestion[],
): ResourceSuggestion[][] {
  const groups = new Map<string, ResourceSuggestion[]>();
  for (const suggestion of suggestions) {
    const key = suggestion.proposalId
      ? `proposal:${suggestion.proposalId}`
      : suggestion.id;
    groups.set(key, [...(groups.get(key) ?? []), suggestion]);
  }
  return [...groups.values()].map((group) =>
    group.length > 1
      ? [...group].sort(
          (left, right) => anchorStart(left) - anchorStart(right) || 0,
        )
      : group,
  );
}

/** Pieces of an edit a reviewer takes or leaves together. */
export type ReviewUnit = {
  leader: ResourceSuggestion;
  members: ResourceSuggestion[];
};

/** The unit a piece was staged in, if it was staged with one. */
export function reviewUnitLabel(
  suggestion: Pick<ResourceSuggestion, "metadata">,
): string | null {
  const label = suggestion.metadata?.reviewUnit;
  return typeof label === "string" && label ? label : null;
}

/**
 * The units a proposal's edits are reviewed in, in the order given. A suggestion
 * with no unit label, as one staged before units, is a unit of its own. Pieces
 * that ended differently no longer decide together.
 */
export function reviewUnits(
  suggestions: readonly ResourceSuggestion[],
): ReviewUnit[] {
  const units = new Map<string, ReviewUnit>();
  for (const suggestion of suggestions) {
    const label = reviewUnitLabel(suggestion);
    const key = label
      ? `unit:${suggestion.proposalId}:${label}:${suggestion.status}`
      : suggestion.id;
    const unit = units.get(key);
    if (unit) unit.members.push(suggestion);
    else units.set(key, { leader: suggestion, members: [suggestion] });
  }
  return [...units.values()];
}

function placedPiece(operation: ResourceSuggestion["operations"][number]) {
  const before = operation.before as { markdown?: unknown } | undefined;
  const after = operation.after as { changedText?: unknown } | undefined;
  const anchor = operation.anchor as { from?: unknown; to?: unknown } | null;
  return typeof before?.markdown === "string" &&
    typeof after?.changedText === "string" &&
    after.changedText !== "<empty-block/>" &&
    typeof anchor?.from === "number" &&
    typeof anchor.to === "number"
    ? {
        source: before.markdown,
        from: anchor.from,
        to: anchor.to,
        inserted: after.changedText,
      }
    : null;
}

/**
 * What a unit changes as one edit, from its first piece to its last with every
 * piece applied, so a card reads it the way the Page will. Pieces that can't be
 * read together, as when they were staged on different text, stay listed.
 */
export function reviewUnitOperations(
  unit: ReviewUnit,
): ResourceSuggestion["operations"] {
  if (unit.members.length === 1) return unit.leader.operations;
  const operations = unit.members.flatMap((member) => member.operations);
  const pieces = operations
    .map(placedPiece)
    .filter((piece) => piece !== null)
    .sort((left, right) => left.from - right.from);
  const [first] = pieces;
  const last = pieces[pieces.length - 1];
  if (
    pieces.length === 0 ||
    pieces.length !== operations.length ||
    pieces.some((piece) => piece.source !== first.source)
  )
    return operations;
  const changedText = pieces.reduceRight(
    (text, piece) =>
      text.slice(0, piece.from - first.from) +
      piece.inserted +
      text.slice(piece.to - first.from),
    first.source.slice(first.from, last.to),
  );
  const [leader] = operations;
  return [
    {
      ...leader,
      kind: "replace_text",
      before: {
        markdown: first.source,
        changedText: first.source.slice(first.from, last.to),
      },
      after: {
        markdown:
          first.source.slice(0, first.from) +
          changedText +
          first.source.slice(last.to),
        changedText,
      },
      anchor: { from: first.from, to: last.to },
    },
  ];
}

const REVIEW_UNIT_DIFF_TYPE = {
  same: "equal",
  removed: "delete",
  added: "insert",
} as const;

/** A unit's change by whole words: by characters, a rewrite reads as noise. */
export function reviewUnitDiffParts(before: string, after: string) {
  return wordDiff(before, after).map(({ kind, text }) => ({
    type: REVIEW_UNIT_DIFF_TYPE[kind],
    text,
  }));
}

// Suggestion ids are URL-safe, so the encoded id in the link is the id itself.
// The receipt's summary has its brackets stripped, so it is the whole comment.
const RECEIPT_LINK = /^\[[^[\]]*\]\([^)\s]*[?&]suggestion=([\w.~-]+)[^)\s]*\)$/;

/**
 * The suggestion an AI receipt reply (`[summary](…?suggestion=id)`) stands
 * for. The receipt is posted as the requester, who also authors the
 * suggestion, so anyone else's link to it stays an ordinary reply.
 */
export function receiptSuggestion(
  comment: { content: string; author_email: string },
  suggestions: readonly ResourceSuggestion[],
): ResourceSuggestion | null {
  const id = RECEIPT_LINK.exec(comment.content.trim())?.[1];
  const suggestion = id && suggestions.find((entry) => entry.id === id);
  return suggestion && suggestion.authorEmail === comment.author_email
    ? suggestion
    : null;
}

function plainText(markdown: string): string {
  const blocks: string[] = [];
  const text = (node: PMNode): string =>
    node.text ??
    (node.type === "hardBreak"
      ? "\n"
      : (node.content ?? []).map(text).join(""));
  const walk = (node: PMNode) => {
    if (node.content?.some((child) => child.text !== undefined)) {
      blocks.push(text(node));
      return;
    }
    if (!node.content?.length) {
      if (node.type !== "doc") blocks.push("");
      return;
    }
    node.content.forEach(walk);
  };
  walk(nfmToDoc(markdown));
  return blocks.join("\n").trim();
}

function lineEnd(text: string, from: number) {
  const end = text.indexOf("\n", from);
  return end < 0 ? text.length : end;
}

/**
 * The whole line(s) a single-operation suggestion touches, before and after,
 * as reader text. A character-level edit range can start mid-word, which reads
 * as nonsense on its own; the surrounding line gives a word diff its context.
 */
export function suggestionLineExcerpt(
  operations: ResourceSuggestion["operations"],
): { before: string; after: string } | null {
  const [operation] = operations;
  if (!operation || operations.length > 1) return null;
  const before = operation.before as
    | { markdown?: unknown; changedText?: unknown }
    | undefined;
  const after = operation.after as
    | { markdown?: unknown; changedText?: unknown }
    | undefined;
  const anchor = operation.anchor as { from?: unknown; to?: unknown } | null;
  if (
    typeof before?.markdown !== "string" ||
    typeof after?.markdown !== "string" ||
    typeof after.changedText !== "string" ||
    typeof anchor?.from !== "number" ||
    typeof anchor.to !== "number" ||
    before.markdown.slice(anchor.from, anchor.to) !== before.changedText
  ) {
    return null;
  }
  const start = before.markdown.lastIndexOf("\n", anchor.from - 1) + 1;
  const insertedEnd =
    anchor.from +
    (after.changedText === "<empty-block/>" ? 0 : after.changedText.length);
  return {
    before: plainText(
      before.markdown.slice(start, lineEnd(before.markdown, anchor.to)),
    ),
    after: plainText(
      after.markdown.slice(start, lineEnd(after.markdown, insertedEnd)),
    ),
  };
}
