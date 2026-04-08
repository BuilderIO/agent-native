import { defineAction } from "@agent-native/core";
import { readAppState } from "@agent-native/core/application-state";
import { eq, desc } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";

export default defineAction({
  description:
    "See what the user is currently looking at on screen. Returns navigation state, deck list or current deck/slide details. Always call this first before taking any action.",
  parameters: {},
  http: false,
  run: async (_args) => {
    const navigation = await readAppState("navigation");

    const screen: Record<string, unknown> = {};
    if (navigation) screen.navigation = navigation;

    const nav = navigation as any;
    const db = getDb();

    if (nav?.deckId) {
      // User is editing a specific deck
      const rows = await db
        .select()
        .from(schema.decks)
        .where(eq(schema.decks.id, nav.deckId))
        .limit(1);

      if (rows.length > 0) {
        const deck = JSON.parse(rows[0].data);
        const slides = deck?.slides || [];
        const slideIndex = nav.slideIndex ?? 0;
        const currentSlide = slides[slideIndex] || null;

        screen.deck = {
          id: rows[0].id,
          title: rows[0].title || deck?.title,
          slideCount: slides.length,
          currentSlideIndex: slideIndex,
          currentSlide: currentSlide
            ? {
                id: currentSlide.id,
                layout: currentSlide.layout ?? null,
                content: currentSlide.content,
              }
            : null,
        };
      }
    } else {
      // User is on the deck list
      const rows = await db
        .select()
        .from(schema.decks)
        .orderBy(desc(schema.decks.updatedAt));

      const decks = rows.map((row) => {
        const data = JSON.parse(row.data);
        return { ...data, id: row.id, title: row.title };
      });

      screen.deckList = {
        count: decks.length,
        decks: decks.map((d: any) => {
          const slides =
            d.slides ??
            (typeof d.data === "string" ? JSON.parse(d.data) : d.data)?.slides;
          return {
            id: d.id,
            title: d.title,
            slideCount: slides?.length ?? 0,
            updatedAt: d.updatedAt ?? d.updated_at,
          };
        }),
      };
    }

    if (Object.keys(screen).length === 0) {
      return "No application state found. Is the app running?";
    }
    return JSON.stringify(screen, null, 2);
  },
});
