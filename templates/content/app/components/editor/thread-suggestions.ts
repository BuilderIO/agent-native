import type { ResourceSuggestion } from "@agent-native/core/review";
import { nfmToDoc, type PMNode } from "@shared/nfm";

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
