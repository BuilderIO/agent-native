import { defineAction } from "@agent-native/core";
import { readAppState } from "@agent-native/core/application-state";
import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { accessFilter } from "@agent-native/core/sharing";
import { z } from "zod";

export default defineAction({
  description:
    "See what the user is currently looking at. Returns the CURRENT deck ID, current slide ID, and the full list of slide IDs in the open deck (or the deck list if the user is on the home page). Call this before any slide operation to get the exact IDs you need for add-slide / update-slide / create-deck.",
  schema: z.object({}),
  http: false,
  run: async (_args) => {
    const navigation = (await readAppState("navigation")) as {
      view?: string;
      deckId?: string;
      slideIndex?: number;
    } | null;
    const db = getDb();

    // ─── Editor view: user has a specific deck open ─────────────────────
    if (navigation?.deckId) {
      const rows = await db
        .select()
        .from(schema.decks)
        .where(
          and(
            eq(schema.decks.id, navigation.deckId),
            accessFilter(schema.decks, schema.deckShares),
          ),
        )
        .limit(1);

      if (rows.length === 0) {
        return [
          `view: ${navigation.view ?? "editor"}`,
          `deckId: ${navigation.deckId}  (NOT FOUND in database — the deck may have just been created and not yet persisted)`,
          "",
          "Wait a moment and call view-screen again, or list-decks to see what's available.",
        ].join("\n");
      }

      const deck = JSON.parse(rows[0].data);
      const slides: Array<{
        id: string;
        layout?: string;
        content?: string;
      }> = Array.isArray(deck?.slides) ? deck.slides : [];
      const slideIndex = navigation.slideIndex ?? 0;
      const currentSlide = slides[slideIndex] ?? null;

      // Emit a compact, scannable format with IDs at the top. The agent
      // should be able to grab what it needs at a glance without parsing
      // nested JSON.
      const lines: string[] = [];
      lines.push(`## Current Screen`);
      lines.push(``);
      lines.push(`view: ${navigation.view ?? "editor"}`);
      lines.push(
        `deckId: ${rows[0].id}            ← use this for add-slide / update-slide / create-deck --deckId`,
      );
      lines.push(`deckTitle: ${rows[0].title ?? deck?.title ?? "(untitled)"}`);
      lines.push(`slideCount: ${slides.length}`);
      lines.push(`currentSlideIndex: ${slideIndex}`);
      if (currentSlide) {
        lines.push(
          `currentSlideId: ${currentSlide.id}   ← use this for update-slide --slideId`,
        );
        lines.push(`currentSlideLayout: ${currentSlide.layout ?? "(none)"}`);
      } else {
        lines.push(
          `currentSlideId: (no slide at index ${slideIndex} — deck may be empty)`,
        );
      }
      lines.push(``);
      lines.push(`### All slides in this deck (${slides.length})`);
      if (slides.length === 0) {
        lines.push(`(empty — use add-slide to add slides)`);
      } else {
        for (let i = 0; i < slides.length; i++) {
          const s = slides[i];
          const marker = i === slideIndex ? " ◀ current" : "";
          const contentPreview =
            typeof s.content === "string"
              ? s.content
                  .replace(/<[^>]+>/g, " ")
                  .replace(/\s+/g, " ")
                  .trim()
                  .slice(0, 60)
              : "";
          lines.push(
            `${String(i).padStart(2, " ")}. id=${s.id}  layout=${s.layout ?? "-"}  "${contentPreview}"${marker}`,
          );
        }
      }
      if (currentSlide?.content) {
        lines.push(``);
        lines.push(
          `### Current slide HTML (index ${slideIndex}, id ${currentSlide.id})`,
        );
        lines.push("```html");
        lines.push(currentSlide.content);
        lines.push("```");
      }
      return lines.join("\n");
    }

    // ─── List view: user is on the deck list ─────────────────────────────
    const rows = await db
      .select()
      .from(schema.decks)
      .where(accessFilter(schema.decks, schema.deckShares))
      .orderBy(desc(schema.decks.updatedAt));

    const lines: string[] = [];
    lines.push(`## Current Screen`);
    lines.push(``);
    lines.push(`view: ${navigation?.view ?? "list"}`);
    lines.push(`No deck currently open. User is on the deck list.`);
    lines.push(``);
    lines.push(`### All decks (${rows.length})`);
    if (rows.length === 0) {
      lines.push(`(no decks — use create-deck to make one)`);
    } else {
      for (const row of rows) {
        const data = JSON.parse(row.data);
        const slideCount = Array.isArray(data?.slides) ? data.slides.length : 0;
        lines.push(
          `- id=${row.id}  title="${row.title ?? data?.title ?? "(untitled)"}"  slides=${slideCount}`,
        );
      }
    }
    return lines.join("\n");
  },
});
