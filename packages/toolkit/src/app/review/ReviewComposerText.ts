import type { ReviewMention } from "@agent-native/core/review/types";
import type { JSONContent } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

export const REVIEW_MENTION_NODE_NAME = "reviewMention";

const NAME_CHAR = /[\p{L}\p{M}\p{N}_]/u;
const ENDS_IN_NAME_CHAR = /[\p{L}\p{M}\p{N}_]$/u;

export function reviewMentionLeafText(node: ProseMirrorNode): string {
  return `@${node.attrs.label}`;
}

/**
 * The comment body the editor represents: one line per paragraph, each mention
 * chip written as `@label`. This is the exact string a plain textarea held.
 */
export function serializeReviewComposerDoc(doc: ProseMirrorNode): string {
  return doc.textBetween(0, doc.content.size, "\n", reviewMentionLeafText);
}

/**
 * Inverse of `serializeReviewComposerDoc`. A stored `@label` becomes a chip
 * only as a whole token (longest name first), so `@Sam` is not read inside
 * `@Samantha`; anything else stays text.
 */
export function parseReviewComposerText(
  text: string,
  mentions: readonly ReviewMention[],
): JSONContent {
  const ordered = mentions
    .filter((mention) => mention.label)
    .sort((a, b) => b.label.length - a.label.length);
  return {
    type: "doc",
    content: text.split("\n").map((line) => {
      const content = parseLine(line, ordered);
      return content.length
        ? { type: "paragraph", content }
        : { type: "paragraph" };
    }),
  };
}

function parseLine(
  line: string,
  mentions: readonly ReviewMention[],
): JSONContent[] {
  const content: JSONContent[] = [];
  let textStart = 0;
  let index = line.indexOf("@");
  while (index !== -1) {
    const mention = matchMentionAt(line, index, mentions);
    if (mention) {
      if (index > textStart) {
        content.push({ type: "text", text: line.slice(textStart, index) });
      }
      content.push({
        type: REVIEW_MENTION_NODE_NAME,
        attrs: {
          label: mention.label,
          email: mention.email ?? null,
          id: mention.id ?? null,
        },
      });
      textStart = index + 1 + mention.label.length;
      index = line.indexOf("@", textStart);
    } else {
      index = line.indexOf("@", index + 1);
    }
  }
  if (textStart < line.length) {
    content.push({ type: "text", text: line.slice(textStart) });
  }
  return content;
}

function matchMentionAt(
  line: string,
  index: number,
  mentions: readonly ReviewMention[],
): ReviewMention | undefined {
  const previous = [...line.slice(0, index)].pop();
  if (previous && NAME_CHAR.test(previous)) return undefined;
  return mentions.find((mention) => {
    const token = `@${mention.label}`;
    if (!line.startsWith(token, index)) return false;
    const next = [...line.slice(index + token.length)][0];
    return !(ENDS_IN_NAME_CHAR.test(token) && next && NAME_CHAR.test(next));
  });
}
