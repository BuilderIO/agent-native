import type { ResourceSuggestion } from "@agent-native/core/review";
import { nfmToDoc, type PMNode } from "@shared/nfm";

/** The comment thread an AI suggestion was asked for from, if any. */
export function suggestionSourceThreadId(
  suggestion: Pick<ResourceSuggestion, "metadata">,
): string | null {
  const source = suggestion.metadata?.sourceThreadId;
  return typeof source === "string" && source ? source : null;
}

/**
 * Suggestions that belong inside a comment thread on this page, oldest first.
 * A suggestion whose source thread is not here keeps its own margin card.
 */
export function suggestionsByThread(
  suggestions: readonly ResourceSuggestion[],
  threadIds: ReadonlySet<string>,
): Map<string, ResourceSuggestion[]> {
  const grouped = new Map<string, ResourceSuggestion[]>();
  for (const suggestion of suggestions) {
    const threadId = suggestionSourceThreadId(suggestion);
    if (!threadId || !threadIds.has(threadId)) continue;
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
const RECEIPT_LINK = /\]\([^)\s]*[?&]suggestion=([\w.~-]+)[^)\s]*\)$/;

/** The suggestion an AI receipt reply (`[summary](…?suggestion=id)`) links to. */
export function receiptSuggestionId(content: string): string | null {
  return RECEIPT_LINK.exec(content.trim())?.[1] ?? null;
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
