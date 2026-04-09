import { defineAction } from "@agent-native/core";
import { z } from "zod";
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
    "Create a new deck with slides. Returns the created deck including its id.",
  schema: z.object({
    title: z.string().describe("Deck title"),
    slides: z
      .array(SlideSchema)
      .describe("Array of slides with id, content (HTML), and optional layout"),
  }),
  http: false,
  run: async ({ title, slides }) => {
    const id = `deck-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const now = new Date().toISOString();
    const data = { title, slides, createdAt: now, updatedAt: now };

    const db = getDb();
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
