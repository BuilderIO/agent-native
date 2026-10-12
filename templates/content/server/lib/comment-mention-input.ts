import { fail } from "@agent-native/core/action";

import {
  mentionsMissingFromText,
  parseCommentMentions,
  type CommentMention,
} from "../../shared/comment-mentions.js";

/** Mentions submitted with a comment write; a malformed list is the caller's to fix. */
export function submittedCommentMentions(value: unknown): CommentMention[] {
  try {
    return parseCommentMentions(value);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error), {
      statusCode: 400,
    });
  }
}

/**
 * Fails unless each mention has its own `@name` in the text, in text order.
 * A mention without one notifies someone the comment never names, and a
 * second person under one `@name` would take another person's pill.
 */
export function assertMentionsInText(
  text: string,
  mentions: readonly CommentMention[],
): void {
  const missing = mentionsMissingFromText(text, mentions);
  if (missing.length === 0) return;
  fail(
    `Each mention needs its own @name in the comment text, listed in text order; unmatched: ${missing
      .map(
        (mention) =>
          `@${mention.name} (${mention.kind === "agent" ? mention.model : mention.email})`,
      )
      .join(", ")}`,
    { statusCode: 400 },
  );
}
