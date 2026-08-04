/**
 * Catalog entries for the transactional emails Slides sends.
 *
 * Registered from `server/plugins/transactional-emails.ts` so Dispatch can list
 * and preview them without the app having sent anything yet.
 */

import { defineTransactionalEmail } from "@agent-native/core/email-catalog";

import { renderDeckCommentEmail } from "./comment-notifications.js";

export const SLIDES_DECK_COMMENT_EMAIL_ID = "slides.deck-comment";

let registered = false;

export function registerSlidesEmails(): void {
  if (registered) return;
  registered = true;

  defineTransactionalEmail({
    id: SLIDES_DECK_COMMENT_EMAIL_ID,
    name: "Deck comment",
    trigger:
      "Someone posts a comment or a thread reply on a slide. Subject and copy differ slightly for a reply; both send under this id.",
    recipientLabel: "Deck owner and authors",
    recipient:
      "The deck owner, plus every prior author in the thread when the new comment is a reply. The list is re-checked against the deck's live ACL and filtered by each user's `emailNotifications` preference; the comment's own author never receives it.",
    senderLabel: "Default sender",
    sender:
      "The configured default sender. This call site sets no `from`, `fromName`, `replyTo`, or `appSender`.",
    preview: () =>
      renderDeckCommentEmail({
        actor: "Sam Rivera",
        title: "Series A narrative",
        url: "https://example.com/decks/deck_sample?slide=3",
        content: "Slide 3 needs the updated revenue chart before Thursday.",
        isReply: false,
      }),
  });
}
