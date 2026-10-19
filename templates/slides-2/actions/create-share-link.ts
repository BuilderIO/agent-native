import crypto from "node:crypto";

import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { toSharedDeckSlide } from "@shared/api";
import { eq, lt } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { slideRevealIssues } from "../server/lib/slide-reveal-issues.js";
import { trackSlides } from "../server/lib/slides-tracking.js";
import { assertSlides2DeckData } from "./_deck-app-scope.js";
import {
  projectRenderingDesignSystemData,
  readDeckLinkedDesignSystem,
} from "./_linked-design-system.js";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function shareTokenHash(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex").slice(0, 16);
}

export default defineAction({
  title: "Create deck share link",
  description:
    "Create a 30-day public presentation link from the current saved deck. The link contains a read-only snapshot without speaker notes.",
  schema: z.object({ deckId: z.string().min(1).describe("Deck to share") }),
  retrySafe: false,
  http: { method: "POST" },
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: true,
  },
  run: async ({ deckId }, ctx) => {
    const access = await assertAccess("deck", deckId, "admin");
    const deck = access.resource as {
      id: string;
      title?: string | null;
      data: string;
      designSystemId?: string | null;
    };
    let storedDeck: unknown;
    try {
      storedDeck = JSON.parse(deck.data);
    } catch {
      throw Object.assign(new Error("Deck data is unreadable."), {
        statusCode: 500,
        errorCode: "invalid_deck_data",
      });
    }
    assertSlides2DeckData(storedDeck);
    if (
      !storedDeck ||
      typeof storedDeck !== "object" ||
      Array.isArray(storedDeck) ||
      !Array.isArray((storedDeck as { slides?: unknown }).slides) ||
      (storedDeck as { slides: unknown[] }).slides.length === 0
    ) {
      throw Object.assign(new Error("Deck with slides is required."), {
        statusCode: 400,
        errorCode: "deck_slides_required",
      });
    }

    const data = storedDeck as {
      title?: string;
      slides: unknown[];
      aspectRatio?: string;
      designSystemId?: string;
    };
    const token = crypto.randomBytes(12).toString("base64url");
    const designSystemId = deck.designSystemId ?? data.designSystemId;
    let designSystemData: string | null = null;
    if (typeof designSystemId === "string" && designSystemId.trim()) {
      const designSystemAccess = await readDeckLinkedDesignSystem(
        deck,
        designSystemId,
      );
      designSystemData = projectRenderingDesignSystemData(
        designSystemAccess?.resource?.data,
      );
    }

    const slides = data.slides.map((slide, index) =>
      toSharedDeckSlide(slide, index, {
        includeNotes: false,
        revealIssues: slideRevealIssues(slide),
      }),
    );
    const db = getDb();
    await db.insert(schema.deckShareLinks).values({
      token,
      title: deck.title ?? data.title ?? "Untitled",
      slides: JSON.stringify(slides),
      aspectRatio: data.aspectRatio ?? null,
      designSystemData,
      createdAt: new Date().toISOString(),
    });

    trackSlides(
      "share_link_created",
      {
        output_id: deckId,
        output_type: "deck",
        share_type: "presentation_link",
        share_token_hash: shareTokenHash(token),
      },
      ctx,
    );
    await db
      .delete(schema.deckShareLinks)
      .where(
        lt(
          schema.deckShareLinks.createdAt,
          new Date(Date.now() - THIRTY_DAYS_MS).toISOString(),
        ),
      );
    return { shareToken: token };
  },
});
