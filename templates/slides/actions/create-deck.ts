import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";

const SlideSchema = z.object({
  id: z.string().describe("Unique slide ID, e.g. 'slide-1'"),
  content: z.string().describe("Full HTML content of the slide"),
  layout: z
    .enum([
      "title",
      "section",
      "content",
      "two-column",
      "image",
      "statement",
      "full-image",
      "blank",
    ])
    .optional()
    .describe("Layout type hint"),
});

export default defineAction({
  description:
    "Create a new deck with slides, or replace all slides in an existing deck. " +
    "Pass deckId to populate an existing deck (e.g. one the user already has open). " +
    "Returns the deck id, title, and slide count.",
  schema: z.object({
    title: z.string().describe("Deck title"),
    slides: z
      .array(SlideSchema)
      .describe("Array of slides with id, content (HTML), and optional layout"),
    deckId: z
      .string()
      .optional()
      .describe(
        "If provided, update this existing deck instead of creating a new one",
      ),
  }),
  http: false,
  run: async ({ title, slides, deckId }) => {
    const db = getDb();
    const now = new Date().toISOString();

    if (deckId) {
      // Update existing deck
      const data = { title, slides, updatedAt: now };
      await db
        .update(schema.decks)
        .set({ title, data: JSON.stringify(data), updatedAt: now })
        .where(eq(schema.decks.id, deckId));
      return { id: deckId, title, slideCount: slides.length };
    }

    const id = `deck-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const data = { title, slides, createdAt: now, updatedAt: now };
    await db.insert(schema.decks).values({
      id,
      title,
      data: JSON.stringify(data),
      createdAt: now,
      updatedAt: now,
    });

    return { id, title, slideCount: slides.length };
  },
});
