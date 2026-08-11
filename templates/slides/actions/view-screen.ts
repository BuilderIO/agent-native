import { defineAction } from "@agent-native/core";
import {
  getRequestRunContext,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { accessFilter } from "@agent-native/core/sharing";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { hashSlideContent, type DeckFitState } from "../shared/slide-fit.js";
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

      const selection = (await readAppStateForCurrentTab(
        "slides-selection",
      )) as {
        slideId?: string;
        mode?: string;
        activeTool?: string;
        items?: Array<{
          selector?: string;
          runtimeSelector?: string;
          objectId?: string;
          text?: string;
          kind?: string;
          tagName?: string;
          imageSrc?: string;
          style?: Record<string, unknown>;
        }>;
      } | null;
      if (selection && currentSlide && selection.slideId === currentSlide.id) {
        lines.push(``);
        lines.push(`### Current visual selection`);
        lines.push(
          `selectionSlideId: ${selection.slideId}   (matches currentSlideId)`,
        );
        lines.push(`mode: ${selection.mode ?? "unknown"}`);
        lines.push(`activeTool: ${selection.activeTool ?? "select"}`);
        if (Array.isArray(selection.items) && selection.items.length > 0) {
          for (const [index, item] of selection.items.entries()) {
            lines.push(
              `selected ${index + 1}: ${item.kind ?? "element"} ${item.tagName ?? ""} selector=${item.selector ?? "(none)"}`,
            );
            if (item.objectId) lines.push(`objectId: ${item.objectId}`);
            if (item.runtimeSelector) {
              lines.push(`runtimeSelector: ${item.runtimeSelector}`);
            }
            if (item.text) lines.push(`text: ${item.text}`);
            if (item.imageSrc) lines.push(`imageSrc: ${item.imageSrc}`);
            if (item.style) {
              lines.push(`style: ${JSON.stringify(item.style)}`);
            }
          }
        } else {
          lines.push(`(no selected elements)`);
        }
      }

      // ─── Layout-fit measurement ──────────────────────────────────────────
      // The editor measures the rendered slide and reports vertical overflow
      // here whenever the natural content bounds exceed the canvas content
      // area. If this block is present, the current slide's HTML needs to be
      // rewritten to fit the canvas.
      const overflow = (await readAppStateForCurrentTab("slide-fit-check")) as {
        slideId?: string;
        contentHash?: string;
        verticalOverflow?: number;
        horizontalOverflow?: number;
        contentHeight?: number;
        contentWidth?: number;
        viewportHeight?: number;
        viewportWidth?: number;
      } | null;
      const verticalOverflow = overflow?.verticalOverflow ?? 0;
      const horizontalOverflow = overflow?.horizontalOverflow ?? 0;
      if (
        overflow &&
        typeof overflow.contentHash === "string" &&
        currentSlide?.content &&
        overflow.contentHash === hashSlideContent(currentSlide.content) &&
        Number.isFinite(overflow.verticalOverflow) &&
        (overflow.horizontalOverflow === undefined ||
          Number.isFinite(overflow.horizontalOverflow)) &&
        Number.isFinite(overflow.contentHeight) &&
        Number.isFinite(overflow.viewportHeight) &&
        (verticalOverflow > 0 || horizontalOverflow > 0) &&
        overflow.slideId === currentSlide?.id
      ) {
        lines.push(``);
        lines.push(`### ⚠ Layout overflows the canvas`);
        lines.push(
          `This slide's natural rendered content is ${overflow.contentWidth ?? "unknown"}x${overflow.contentHeight}px, ` +
            `but the canvas content area is ${overflow.viewportWidth ?? "unknown"}x${overflow.viewportHeight}px ` +
            `(overflow: ${verticalOverflow}px vertical, ${horizontalOverflow}px horizontal). The renderer no longer ` +
            `auto-shrinks overflowing slides — you must rewrite the slide HTML so ` +
            `the rendered content fits the measured content area. Options, ` +
            `in order of preference: (1) tighten copy — shorter headings/bullets, ` +
            `drop low-value lines; (2) reduce vertical density — fewer stacked ` +
            `cards, smaller gaps, slightly smaller body font (not below 16px); ` +
            `(3) reduce slide padding (e.g. 40px top/bottom); (4) split the ` +
            `content across two slides if it genuinely cannot be compressed. ` +
            `Do not solve this with transform: scale, overflow: scroll, or ` +
            `absolute positioning — only the HTML shape can fix it now.`,
        );
      }

      const deckFit = (await readAppStateForCurrentTab(
        "deck-fit-checks",
      )) as DeckFitState | null;
      if (
        deckFit?.deckId === rows[0].id &&
        deckFit.aspectRatio === (deck.aspectRatio ?? "16:9") &&
        deckFit.slides
      ) {
        type DeckFitSummary =
          | { kind: "unknown"; index: number }
          | {
              kind: "overflow";
              index: number;
              measurement: (typeof deckFit.slides)[string];
            };
        const measured: DeckFitSummary[] = slides.flatMap(
          (slide, index): DeckFitSummary[] => {
            const measurement = deckFit.slides[slide.id];
            if (
              !measurement ||
              measurement.contentHash !==
                hashSlideContent(slide.content ?? "") ||
              !Number.isFinite(measurement.verticalOverflow) ||
              !Number.isFinite(measurement.horizontalOverflow) ||
              !Number.isFinite(measurement.contentHeight) ||
              !Number.isFinite(measurement.contentWidth) ||
              !Number.isFinite(measurement.viewportHeight) ||
              !Number.isFinite(measurement.viewportWidth) ||
              !Number.isFinite(measurement.measuredAt)
            ) {
              return [{ kind: "unknown" as const, index }];
            }
            return measurement.verticalOverflow > 0 ||
              measurement.horizontalOverflow > 0
              ? [{ kind: "overflow" as const, index, measurement }]
              : [];
          },
        );
        const unknown = measured.filter((item) => item.kind === "unknown");
        const overflows = measured.filter((item) => item.kind === "overflow");
        lines.push(``);
        lines.push(`### Deck-wide layout fit`);
        if (unknown.length > 0) {
          lines.push(
            `Measured ${slides.length - unknown.length} of ${slides.length} slides; ` +
              `the remaining slides need a fresh browser measurement before claiming the deck fits.`,
          );
        } else if (overflows.length > 0) {
          lines.push(
            `Overflow detected on ${overflows.length} slide(s): ${overflows
              .map((item) => {
                if (item.kind !== "overflow") return "";
                return `slide ${item.index + 1} (${item.measurement.verticalOverflow}px vertical, ${item.measurement.horizontalOverflow}px horizontal)`;
              })
              .join(", ")}.`,
          );
        } else {
          lines.push(
            `All ${slides.length} slides fit their measured content area.`,
          );
        }
      }

      return lines.join("\n");
    }

    // ─── List view: user is on the deck list ─────────────────────────────
    // Project only the columns this summary reads. `decks.data` holds each
    // deck's entire slide JSON and can be large — never select it for a
    // plain list. Mirrors the light-mode projection in list-decks.ts; call
    // list-decks or open a specific deck for slide counts / content.
    const rows = await db
      .select({
        id: schema.decks.id,
        title: schema.decks.title,
        ownerEmail: schema.decks.ownerEmail,
      })
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
        lines.push(`- id=${row.id}  title="${row.title ?? "(untitled)"}"`);
      }
      lines.push(``);
      lines.push(
        `(slide counts omitted here for performance — call list-decks or open a deck to see slide content)`,
      );
    }
    return lines.join("\n");
  },
});
