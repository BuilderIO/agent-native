/**
 * Pure helpers for `@`-mention typing in a plain text input. Detecting the
 * active mention and rewriting the text are kept here so they can be unit
 * tested without React Native.
 */

import type { ChatReference, MentionItem } from "./types";

export interface ActiveMention {
  /** Text typed after the `@`, may be empty right after typing `@`. */
  query: string;
  /** Index of the `@`. */
  start: number;
  /** Cursor index (exclusive end of the query). */
  end: number;
}

/**
 * The mention being typed immediately before the cursor, or null. A mention
 * starts at an `@` that is at the start of the text or preceded by whitespace,
 * and runs up to the cursor with no whitespace or second `@` in between.
 */
export function activeMentionQuery(
  text: string,
  cursor: number,
): ActiveMention | null {
  const upto = text.slice(0, cursor);
  const match = /(?:^|\s)@([^\s@]*)$/.exec(upto);
  if (!match) return null;
  const query = match[1] ?? "";
  return { query, start: cursor - query.length - 1, end: cursor };
}

/** Replace the active `@query` fragment with `insert`; returns text + cursor. */
export function replaceMention(
  text: string,
  mention: ActiveMention,
  insert: string,
): { text: string; cursor: number } {
  const before = text.slice(0, mention.start);
  const after = text.slice(mention.end);
  return {
    text: `${before}${insert}${after}`,
    cursor: before.length + insert.length,
  };
}

/** Map a mention menu row to the reference shape the turn sends. */
export function mentionToReference(item: MentionItem): ChatReference {
  const type: ChatReference["type"] =
    item.refType === "file"
      ? "file"
      : item.refType === "agent"
        ? "agent"
        : item.refType === "custom-agent"
          ? "custom-agent"
          : item.refType === "skill"
            ? "skill"
            : "mention";
  return {
    type,
    path: item.refPath ?? "",
    name: item.label,
    source: item.source,
    refType: item.refType,
    ...(item.refId ? { refId: item.refId } : {}),
  };
}
