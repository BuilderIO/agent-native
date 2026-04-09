import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";

// In-process serialization per deckId. The agent fires parallel add-slide calls
// from a single turn (see production-agent.ts parallel tool execution), and a
// naive read-modify-write on decks.data would lose writes. All parallel calls
// in one turn share this process, so a per-deckId promise chain is enough.
const deckLocks = new Map<string, Promise<unknown>>();

function withDeckLock<T>(deckId: string, fn: () => Promise<T>): Promise<T> {
  const prev = deckLocks.get(deckId) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  deckLocks.set(
    deckId,
    next.finally(() => {
      if (deckLocks.get(deckId) === next) deckLocks.delete(deckId);
    }),
  );
  return next;
}

export default defineAction({
  description:
    "Add a single slide to an existing deck. Use this to build decks slide-by-slide — " +
    "you can call this in parallel for multiple slides at once to generate an entire deck concurrently. " +
    "Returns the new slide ID and updated slide count.",
  schema: z.object({
    deckId: z.string().describe("Target deck ID"),
    content: z.string().describe("Full HTML content of the new slide"),
    slideId: z
      .string()
      .optional()
      .describe(
        "Optional slide ID. Auto-generated if not provided (format: slide-<timestamp>-<random>)",
      ),
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
    position: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe(
        "Optional 0-based index to insert at. If not provided, appends to the end of the deck.",
      ),
  }),
  http: false,
  run: async ({ deckId, content, slideId, layout, position }) =>
    withDeckLock(deckId, async () => {
      const db = getDb();

      const rows = await db
        .select()
        .from(schema.decks)
        .where(eq(schema.decks.id, deckId));

      if (!rows.length) {
        throw new Error(`Deck ${deckId} not found`);
      }

      const row = rows[0];
      const deck = JSON.parse(row.data);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const slides: any[] = Array.isArray(deck.slides) ? deck.slides : [];

      const newSlideId =
        slideId ??
        `slide-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const newSlide: any = { id: newSlideId, content };
      if (layout) newSlide.layout = layout;

      const insertIndex =
        typeof position === "number"
          ? Math.max(0, Math.min(position, slides.length))
          : slides.length;
      slides.splice(insertIndex, 0, newSlide);

      const now = new Date().toISOString();
      deck.slides = slides;
      deck.updatedAt = now;

      await db
        .update(schema.decks)
        .set({ data: JSON.stringify(deck), updatedAt: now })
        .where(eq(schema.decks.id, deckId));

      return {
        deckId,
        slideId: newSlideId,
        position: insertIndex,
        slideCount: slides.length,
      };
    }),
});
