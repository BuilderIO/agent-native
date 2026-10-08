import type { ChatReference, MentionItem } from "./types";

export interface ActiveMention {
  query: string;
  start: number;
  end: number;
}

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
