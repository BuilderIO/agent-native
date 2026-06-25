import { defineAction } from "@agent-native/core";
import {
  getRequestRunContext,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { accessFilter } from "@agent-native/core/sharing";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { readAppStateForCurrentTab } from "./_tab-state.js";

export default defineAction({
  description:
    "See what the user is currently looking at. Returns the CURRENT deck ID, current slide ID, and the full list of slide IDs in the open deck (or the deck list if the user is on the home page). Call this before any slide operation to get the exact IDs you need for add-slide / update-slide / create-deck.",
  schema: z.object({}),
  http: false,
  run: async (_args) => {
    const navigation = (await readAppStateForCurrentTab("navigation")) as {
      view?: string;
      deckId?: string;
      deckFilter?: "all" | "created-by-me";
      slideNumber?: number;
      slideIndex?: number;
    } | null;
    const chatScope = getRequestRunContext()?.chatScope;
    const scopedDeckId =
      chatScope?.type === "deck" && typeof chatScope.id === "string"
        ? chatScope.id
        : null;
    const effectiveNavigation = scopedDeckId
      ? {
          ...(navigation ?? {}),
          view: "editor",
          deckId: scopedDeckId,
          slideNumber:
            navigation?.deckId === scopedDeckId
              ? navigation.slideNumber
              : undefined,
          slideIndex:
            navigation?.deckId === scopedDeckId ? navigation.slideIndex : 0,
        }
      : navigation;
    const db = getDb();

    // ─── Editor view: user has a specific deck open ─────────────────────
    if (effectiveNavigation?.deckId) {
      const rows = await db
        .select()
        .from(schema.decks)
        .where(
          and(
            eq(schema.decks.id, effectiveNavigation.deckId),
            accessFilter(schema.decks, schema.deckShares),
          ),
        )
        .limit(1);

      if (rows.length === 0) {
        return [
          `view: ${effectiveNavigation.view ?? "editor"}`,
          `deckId: ${effectiveNavigation.deckId}  (NOT FOUND in database — the deck may have just been created and not yet persisted)`,
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
      const slideIndex =
        typeof effectiveNavigation.slideIndex === "number"
          ? effectiveNavigation.slideIndex
          : typeof effectiveNavigation.slideNumber === "number" &&
              Number.isFinite(effectiveNavigation.slideNumber) &&
              effectiveNavigation.slideNumber >= 1
            ? effectiveNavigation.slideNumber - 1
            : 0;
      const slideNumber = slideIndex + 1;
      const currentSlide = slides[slideIndex] ?? null;

      // Emit a compact, scannable format with IDs at the top. The agent
      // should be able to grab what it needs at a glance without parsing
      // nested JSON.
      const lines: string[] = [];
      lines.push(`## Current Screen`);
      lines.push(``);
      lines.push(`view: ${effectiveNavigation.view ?? "editor"}`);
      lines.push(
        `deckId: ${rows[0].id}            ← use this for add-slide / update-slide / create-deck --deckId`,
      );
      lines.push(`deckTitle: ${rows[0].title ?? deck?.title ?? "(untitled)"}`);
      lines.push(`slideCount: ${slides.length}`);
      lines.push(
        `slideNumbering: User-visible slide numbers are 1-based and match the UI. "Slide 1" means the first slide, not internal index 1. Use slideId for edits.`,
      );
      lines.push(
        `currentSlideNumber: ${slideNumber} of ${slides.length}   (1-based; matches the UI)`,
      );
      lines.push(
        `currentSlideIndex: ${slideIndex}   (0-based internal value only; do not use this to interpret "slide N" from the user)`,
      );
      if (currentSlide) {
        lines.push(
          `currentSlideId: ${currentSlide.id}   ← use this for update-slide --slideId`,
        );
        lines.push(`currentSlideLayout: ${currentSlide.layout ?? "(none)"}`);
      } else {
        lines.push(
          `currentSlideId: (no slide for slide number ${slideNumber} / internal index ${slideIndex} — deck may be empty)`,
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
            `Slide ${i + 1}. id=${s.id}  internalIndex=${i}  layout=${s.layout ?? "-"}  "${contentPreview}"${marker}`,
          );
        }
      }
      if (currentSlide?.content) {
        lines.push(``);
        lines.push(
          `### Current slide HTML (slide ${slideNumber}, internal index ${slideIndex}, id ${currentSlide.id})`,
        );
        lines.push("```html");
        lines.push(currentSlide.content);
        lines.push("```");
      }

      // ─── Layout-fit measurement ──────────────────────────────────────────
      // The editor measures the rendered slide and reports vertical overflow
      // here whenever the natural content height exceeds the canvas content
      // area. If this block is present, the current slide's HTML is too tall
      // and needs to be rewritten to fit the canvas.
      const overflow = (await readAppStateForCurrentTab("slide-fit-check")) as {
        slideId?: string;
        verticalOverflow?: number;
        contentHeight?: number;
        viewportHeight?: number;
      } | null;
      if (
        overflow &&
        typeof overflow.verticalOverflow === "number" &&
        overflow.verticalOverflow > 0 &&
        overflow.slideId === currentSlide?.id
      ) {
        lines.push(``);
        lines.push(`### ⚠ Layout overflows the canvas vertically`);
        lines.push(
          `This slide's natural rendered height is ${overflow.contentHeight}px, ` +
            `but the canvas content area is only ${overflow.viewportHeight}px tall ` +
            `(overflow: ${overflow.verticalOverflow}px). The renderer no longer ` +
            `auto-shrinks overflowing slides — you must rewrite the slide HTML so ` +
            `the rendered height is at most ${overflow.viewportHeight}px. Options, ` +
            `in order of preference: (1) tighten copy — shorter headings/bullets, ` +
            `drop low-value lines; (2) reduce vertical density — fewer stacked ` +
            `cards, smaller gaps, slightly smaller body font (not below 16px); ` +
            `(3) reduce slide padding (e.g. 40px top/bottom); (4) split the ` +
            `content across two slides if it genuinely cannot be compressed. ` +
            `Do not solve this with transform: scale, overflow: scroll, or ` +
            `absolute positioning — only the HTML shape can fix it now.`,
        );
      }

      return lines.join("\n");
    }

    // ─── List view: user is on the deck list ─────────────────────────────
    const rows = await db
      .select()
      .from(schema.decks)
      .where(accessFilter(schema.decks, schema.deckShares))
      .orderBy(desc(schema.decks.updatedAt));

    const userEmail = getRequestUserEmail();
    const filteredRows =
      navigation?.deckFilter === "created-by-me"
        ? userEmail
          ? rows.filter((row) => row.ownerEmail === userEmail)
          : []
        : rows;
    const lines: string[] = [];
    lines.push(`## Current Screen`);
    lines.push(``);
    lines.push(`view: ${effectiveNavigation?.view ?? "list"}`);
    lines.push(`No deck currently open. User is on the deck list.`);
    lines.push(
      `deckFilter: ${
        navigation?.deckFilter === "created-by-me"
          ? "created by me"
          : "all accessible decks"
      }`,
    );
    lines.push(``);
    lines.push(
      navigation?.deckFilter === "created-by-me"
        ? `### Decks created by current user (${filteredRows.length} of ${rows.length})`
        : `### All decks (${rows.length})`,
    );
    if (filteredRows.length === 0) {
      lines.push(`(no decks — use create-deck to make one)`);
    } else {
      for (const row of filteredRows) {
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
