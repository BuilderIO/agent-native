/**
 * Catalog entries for the transactional emails Documents sends.
 *
 * Registered from `server/plugins/transactional-emails.ts` so Dispatch can list
 * and preview them without the app having sent anything yet.
 */

import { defineTransactionalEmail } from "@agent-native/core/email-catalog";

import { renderDocumentCommentEmail } from "./comment-notifications.js";

/** Obviously-fake sample data — these render in a preview pane, never send. */
const SAMPLE_TITLE = "Q3 launch brief";
const SAMPLE_URL = "https://example.com/page/doc_sample";
const SAMPLE_COMMENT =
  "Can we tighten the second paragraph? It repeats the intro.";

export const CONTENT_DOCUMENT_COMMENT_EMAIL_ID = "content.document-comment";
export const CONTENT_DOCUMENT_MENTION_EMAIL_ID = "content.document-mention";

let registered = false;

export function registerContentEmails(): void {
  if (registered) return;
  registered = true;

  defineTransactionalEmail({
    id: CONTENT_DOCUMENT_COMMENT_EMAIL_ID,
    name: "Document comment",
    trigger:
      "Someone posts a comment or a thread reply on a document. Sent to recipients who were not mentioned in it; the copy and subject differ slightly for a reply.",
    recipient:
      "The document owner, plus every prior author in the thread when the new comment is a reply. The list is re-checked against the document's live ACL and filtered by each user's `emailNotifications` preference; the comment's own author never receives it.",
    sender:
      "The configured default sender. This call site sets no `from`, `fromName`, `replyTo`, or `appSender`.",
    preview: () =>
      renderDocumentCommentEmail({
        actor: "Sam Rivera",
        title: SAMPLE_TITLE,
        url: SAMPLE_URL,
        content: SAMPLE_COMMENT,
        isReply: false,
        wasMentioned: false,
      }),
  });

  defineTransactionalEmail({
    id: CONTENT_DOCUMENT_MENTION_EMAIL_ID,
    name: "Document mention",
    trigger:
      "A comment or reply mentions someone by email. Sent instead of the plain comment notification to each mentioned recipient.",
    recipient:
      "The mentioned addresses supplied by the caller, re-checked against the document's live ACL and filtered by each user's `emailNotifications` preference.",
    sender:
      "The configured default sender. This call site sets no `from`, `fromName`, `replyTo`, or `appSender`.",
    preview: () =>
      renderDocumentCommentEmail({
        actor: "Sam Rivera",
        title: SAMPLE_TITLE,
        url: SAMPLE_URL,
        content: SAMPLE_COMMENT,
        isReply: false,
        wasMentioned: true,
      }),
  });
}
