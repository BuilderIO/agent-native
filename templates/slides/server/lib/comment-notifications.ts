/**
 * Email notifications for deck comments and replies.
 *
 * Recipient resolution, preference filtering, and delivery reporting come from
 * `@agent-native/core/server`; this module owns only the Slides rows and the
 * email copy. Share invites are not routed through the `emailNotifications`
 * preference — they have their own delivery path.
 */

import {
  emailStrong,
  notifyActivity,
  renderEmail,
  runActivityNotification,
  sendEmail,
  type ActivityNotificationResult,
} from "@agent-native/core/server";
import { filterRecipientsByResourceAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";

import { getDeckUrl } from "../../actions/_app-url.js";
import { SLIDES_USER_PREFS_KEY } from "../../shared/slides-user-prefs.js";
import { getDb, schema } from "../db/index.js";

/**
 * `deck-missing` stays distinct from `no-recipients`: one means the deck could
 * not be read, the other means nobody wanted the email.
 */
export type SlidesCommentNotificationResult =
  | ActivityNotificationResult
  | { status: "deck-missing"; sent: []; failed: [] };

const LOG_LABEL = "[slides] comment notification";
const EXCERPT_LIMIT = 240;

function excerpt(content: string): string {
  const collapsed = content.replace(/\s+/g, " ").trim();
  return collapsed.length > EXCERPT_LIMIT
    ? `${collapsed.slice(0, EXCERPT_LIMIT - 1)}…`
    : collapsed;
}

/**
 * The editor reads `?slide=` as a one-based ordinal, not a slide id — passing
 * `slide_2` parses to NaN and silently lands on slide 1.
 */
function deckUrl(deckId: string, slideNumber: number | null): string {
  const base = getDeckUrl(deckId);
  return slideNumber ? `${base}?slide=${slideNumber}` : base;
}

function slideNumberIn(deckData: string, slideId: string): number | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(deckData);
  } catch (error) {
    // Unparsable deck JSON is a real anomaly, so say so — but the comment email
    // still goes out with a deck-level link rather than being dropped.
    console.error(
      `${LOG_LABEL}: deck data could not be parsed for a slide link:`,
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
  const slides = (parsed as { slides?: { id?: string }[] } | null)?.slides;
  if (!Array.isArray(slides)) return null;
  const index = slides.findIndex((slide) => slide?.id === slideId);
  return index >= 0 ? index + 1 : null;
}

async function getDeck(deckId: string) {
  const [row] = await getDb()
    .select({
      id: schema.decks.id,
      title: schema.decks.title,
      ownerEmail: schema.decks.ownerEmail,
      orgId: schema.decks.orgId,
      data: schema.decks.data,
    })
    .from(schema.decks)
    .where(eq(schema.decks.id, deckId))
    .limit(1);
  return row ?? null;
}

async function threadParticipants(
  deckId: string,
  threadId: string,
): Promise<string[]> {
  const rows = await getDb()
    .select({ authorEmail: schema.slideComments.authorEmail })
    .from(schema.slideComments)
    .where(
      and(
        eq(schema.slideComments.deckId, deckId),
        eq(schema.slideComments.threadId, threadId),
      ),
    );
  return rows.map((row) => row.authorEmail);
}

export async function notifyDeckComment(input: {
  deckId: string;
  slideId: string;
  threadId: string;
  authorEmail: string;
  authorName?: string | null;
  content: string;
  isReply: boolean;
}): Promise<SlidesCommentNotificationResult> {
  return runActivityNotification(LOG_LABEL, () =>
    deliverDeckCommentEmails(input),
  );
}

async function deliverDeckCommentEmails(input: {
  deckId: string;
  slideId: string;
  threadId: string;
  authorEmail: string;
  authorName?: string | null;
  content: string;
  isReply: boolean;
}): Promise<SlidesCommentNotificationResult> {
  const deck = await getDeck(input.deckId);
  if (!deck) {
    console.error(`${LOG_LABEL}: deck ${input.deckId} not found`);
    return { status: "deck-missing", sent: [], failed: [] };
  }

  const candidates = [deck.ownerEmail];
  if (input.isReply) {
    candidates.push(
      ...(await threadParticipants(input.deckId, input.threadId)),
    );
  }

  // Thread rows are history, not an access grant: someone removed from the
  // deck must stop receiving its comment bodies.
  const allowed = await filterRecipientsByResourceAccess({
    resourceType: "deck",
    resourceId: deck.id,
    emails: candidates,
    orgId: deck.orgId,
  });

  const actor = input.authorName?.trim() || input.authorEmail;
  const url = deckUrl(deck.id, slideNumberIn(deck.data, input.slideId));

  return notifyActivity({
    candidates: allowed,
    actorEmail: input.authorEmail,
    preferenceKey: SLIDES_USER_PREFS_KEY,
    logLabel: LOG_LABEL,
    send: async (to) => {
      const { html, text } = renderEmail({
        preheader: input.isReply
          ? `${actor} replied to a comment on ${deck.title}.`
          : `${actor} commented on ${deck.title}.`,
        heading: input.isReply ? "New reply on your deck" : "New comment",
        paragraphs: [
          input.isReply
            ? `${emailStrong(actor)} replied in a comment thread on ${emailStrong(deck.title)}.`
            : `${emailStrong(actor)} commented on ${emailStrong(deck.title)}.`,
          `"${excerpt(input.content)}"`,
        ],
        cta: { label: "Open deck", url },
        footer:
          "You received this because you own or participated in this thread. Turn these off in Slides settings.",
      });

      await sendEmail({
        to,
        subject: input.isReply
          ? `${actor} replied to a comment on "${deck.title}"`
          : `${actor} commented on "${deck.title}"`,
        html,
        text,
      });
    },
  });
}
