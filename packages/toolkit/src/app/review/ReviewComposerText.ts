import {
  COMMENT_DOC_MENTION,
  commentDocToMarkdown,
  commentMarkdownToDoc,
} from "@agent-native/core/review/markdown";
import type { ReviewMention } from "@agent-native/core/review/types";
import type { JSONContent } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

export const REVIEW_MENTION_NODE_NAME = COMMENT_DOC_MENTION;

export function reviewMentionLeafText(node: ProseMirrorNode): string {
  return `@${node.attrs.label}`;
}

/**
 * The comment the editor holds, as the Markdown it saves: lines, lists,
 * quotes, code and formatting, each mention chip written as `@label`.
 */
export function serializeReviewComposerDoc(doc: ProseMirrorNode): string {
  return commentDocToMarkdown(doc.toJSON());
}

/**
 * The editor's document for a comment's Markdown, opened the way the comment
 * shows. A stored `@label` becomes a chip only as a whole word (longest name
 * first), so `@Sam` is not read inside `@Samantha`; anything else stays text.
 */
export function parseReviewComposerText(
  text: string,
  mentions: readonly ReviewMention[],
): JSONContent {
  return commentMarkdownToDoc(text, mentions);
}
