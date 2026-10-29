import type {
  ReviewCommentEmail,
  ReviewCommentEmailInput,
  ReviewCommentNotificationKind,
} from "@agent-native/core/review";
import { emailStrong, renderEmail } from "@agent-native/core/server";
import { assertAccess } from "@agent-native/core/sharing";

import { getDeckUrl } from "../../actions/_app-url.js";
import { SLIDE_REVIEW_THREAD_PARAM } from "../../shared/slide-review.js";

const EXCERPT_LIMIT = 240;

function excerpt(content: string): string {
  const collapsed = content.replace(/\s+/g, " ").trim();
  return collapsed.length > EXCERPT_LIMIT
    ? `${collapsed.slice(0, EXCERPT_LIMIT - 1)}…`
    : collapsed;
}

/**
 * Links by thread id, never by slide position: a position goes stale when the
 * deck is reordered, while the thread carries its slide id with it.
 */
export function slideReviewThreadUrl(deckId: string, threadId: string): string {
  const url = new URL(getDeckUrl(deckId));
  url.searchParams.set(SLIDE_REVIEW_THREAD_PARAM, threadId);
  return url.toString();
}

export function renderDeckCommentEmail({
  actor,
  title,
  url,
  content,
  kind,
}: {
  actor: string;
  title: string;
  url: string;
  content: string;
  kind: ReviewCommentNotificationKind;
}): ReviewCommentEmail {
  const copy = {
    mention: {
      subject: `${actor} mentioned you on "${title}"`,
      preheader: `${actor} mentioned you in a comment on ${title}.`,
      heading: "You were mentioned",
      lead: `${emailStrong(actor)} mentioned you in a comment on ${emailStrong(title)}.`,
    },
    reply: {
      subject: `${actor} replied to a comment on "${title}"`,
      preheader: `${actor} replied to a comment on ${title}.`,
      heading: "New reply on your deck",
      lead: `${emailStrong(actor)} replied in a comment thread on ${emailStrong(title)}.`,
    },
    comment: {
      subject: `${actor} commented on "${title}"`,
      preheader: `${actor} commented on ${title}.`,
      heading: "New comment",
      lead: `${emailStrong(actor)} commented on ${emailStrong(title)}.`,
    },
  }[kind];
  return {
    subject: copy.subject,
    ...renderEmail({
      preheader: copy.preheader,
      heading: copy.heading,
      paragraphs: [copy.lead, `"${excerpt(content)}"`],
      cta: { label: "Open comment", url },
      footer:
        "You received this because you own this deck, were mentioned, or are in this thread. Turn these off in Slides settings.",
    }),
  };
}

export async function renderSlideReviewEmail(
  input: ReviewCommentEmailInput,
): Promise<ReviewCommentEmail> {
  // The comment's author just passed this check to post it.
  const deck = (await assertAccess("deck", input.comment.resourceId, "viewer"))
    .resource as { title: string };
  return renderDeckCommentEmail({
    actor: input.actor,
    title: deck.title,
    url: input.url,
    content: input.comment.body,
    kind: input.kind,
  });
}
