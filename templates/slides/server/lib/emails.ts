/**
 * Catalog entries for the transactional emails Slides sends.
 *
 * Registered from `server/plugins/transactional-emails.ts` so Dispatch can list
 * and preview them without the app having sent anything yet.
 */

import {
  defineTransactionalEmail,
  getTransactionalEmail,
} from "@agent-native/core/email-catalog";

import {
  renderDeckAccessRequestEmail,
  SLIDES_DECK_ACCESS_REQUEST_EMAIL_ID,
} from "../../actions/request-deck-access.js";
import { renderDeckCommentEmail } from "./comment-notifications.js";

export const SLIDES_DECK_COMMENT_EMAIL_ID = "slides.deck-comment";

let registered = false;

export function registerSlidesEmails(): void {
  // Nitro can re-evaluate this module during dev HMR while the core registry
  // remains alive. Treat the existing Slides-owned entry as already registered.
  if (registered || getTransactionalEmail(SLIDES_DECK_COMMENT_EMAIL_ID)) return;
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

  defineTransactionalEmail({
    id: SLIDES_DECK_ACCESS_REQUEST_EMAIL_ID,
    name: "Deck access request",
    trigger:
      "A signed-in viewer requests access to a private Slides deck. One request is recorded per viewer and deck.",
    recipientLabel: "Deck owner",
    recipient:
      "The owner of the private deck. The in-app notification is stored even when email delivery is unavailable.",
    senderLabel: "Agent-Native Slides",
    sender:
      "The configured default sender. This call site sets no custom from or app sender.",
    preview: () =>
      renderDeckAccessRequestEmail({
        requesterName: "Sam Rivera",
        requesterEmail: "sam.rivera@example.com",
        deckTitle: "Quarterly review",
        url: "https://example.com/deck/deck_sample",
        allowAccessUrl:
          "https://example.com/access-request/approve?deckId=deck_sample&token=preview-token",
      }),
  });
}
