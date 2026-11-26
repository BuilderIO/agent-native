import {
  COMMENT_DOC_MENTION,
  commentDocToMarkdown,
  commentMarkdownToDoc,
  type CommentDocNode,
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
  return commentDocToMarkdown(withMentionBoundaries(doc.toJSON()));
}

function withMentionBoundaries(content: CommentDocNode): CommentDocNode {
  const visit = (node: CommentDocNode) => {
    const children = node.content;
    if (!children) return;
    for (const [index, child] of children.entries()) {
      const next = children.at(index + 1);
      if (
        child.type === REVIEW_MENTION_NODE_NAME &&
        next?.type === "text" &&
        next.text !== undefined &&
        /^[\p{L}\p{M}\p{N}_]/u.test(next.text)
      ) {
        next.text = ` ${next.text}`;
      }
      visit(child);
    }
  };
  visit(content);
  return content;
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
