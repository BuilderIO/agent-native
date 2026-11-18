import { registerReviewableResource } from "@agent-native/core/review";
import { defineNitroPlugin } from "@agent-native/core/server";
import { eq } from "drizzle-orm";

import { getDeckUrl } from "../../actions/_app-url.js";
import { slideCommentAnchorSchema } from "../../shared/slide-comment-anchor.js";
import { withUniqueSlideIds } from "../../shared/slide-ids.js";
import { SLIDES_USER_PREFS_KEY } from "../../shared/slides-user-prefs.js";
import { getDb, schema } from "../db/index.js";
import {
  assertCommentSlideInDeck,
  DECK_REVIEW_RESOURCE,
  SLIDE_POINT_ANCHOR,
} from "../lib/slide-comments.js";

async function readDeck(deckId: string) {
  // guard:allow-unscoped — the kit asks for a deck's title and link only for a comment it has already let someone write there.
  const rows = await getDb()
    .select({ title: schema.decks.title, data: schema.decks.data })
    .from(schema.decks)
    .where(eq(schema.decks.id, deckId))
    .limit(1);
  return rows.at(0) ?? null;
}

function slideNumber(
  deckId: string,
  data: string,
  slideId: string,
): number | null {
  let parsed: unknown;
  try {
    parsed = withUniqueSlideIds(deckId, JSON.parse(data));
    // coercion-ok: a deck whose data can't be read still gets a link, to the deck rather than the slide.
  } catch {
    return null;
  }
  const slides = (parsed as { slides?: Array<{ id?: unknown } | null> } | null)
    ?.slides;
  if (!Array.isArray(slides)) return null;
  const index = slides.findIndex((slide) => slide?.id === slideId);
  return index >= 0 ? index + 1 : null;
}

export default defineNitroPlugin(() => {
  registerReviewableResource({
    type: DECK_REVIEW_RESOURCE,
    displayName: "Deck",
    anchorKinds: {
      [SLIDE_POINT_ANCHOR]: {
        version: 1,
        parse: (anchor) => slideCommentAnchorSchema.parse(anchor),
      },
    },
    comments: {
      unmentionedRoute: "human",
      resolveRole: "commenter",
      agentDeleteApproval: true,
    },
    resolveTitle: async (deckId) => (await readDeck(deckId))?.title,
    resolveUrl: async (deckId, comment) => {
      const url = getDeckUrl(deckId);
      if (!comment?.surfaceId) return url;
      const deck = await readDeck(deckId);
      const number = deck && slideNumber(deckId, deck.data, comment.surfaceId);
      return number ? `${url}?slide=${number}` : url;
    },
    email: {
      preferenceKey: SLIDES_USER_PREFS_KEY,
      settingsName: "Slides settings",
    },
    onCommentWrite: async (event, tx) => {
      if (event.type === "created") {
        await assertCommentSlideInDeck(tx, event.comment);
      }
    },
  });
});
