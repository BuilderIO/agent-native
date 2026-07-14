import { defineAction, embedApp } from "@agent-native/core";
import { buildDeepLink } from "@agent-native/core/server";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { normalizeSlidePadding } from "../app/lib/normalize-slide-padding.js";
import { getDb, schema } from "../server/db/index.js";
import { notifyClients } from "../server/handlers/decks.js";
import { createDeckVersionSnapshot } from "../server/lib/deck-versions.js";
import { slideLabelFor, touchAgentSlidePresence } from "./_agent-presence.js";
import {
  awaitLayoutFitCheck,
  formatOverflowForTool,
} from "./_await-fit-check.js";
import {
  readAppStateForCurrentTab,
  writeAppStateForCurrentTab,
} from "./_tab-state.js";
// Use the shared, globalThis-pinned per-deck lock so add-slide, update-slide,
// and the browser's patch-deck all serialise against the SAME lock — writes to
// different slides of the same deck can never clobber each other.
import { withDeckLock } from "./patch-deck.js";

function deckDeepLink(deckId: string): string {
  return buildDeepLink({
    app: "slides",
    view: "editor",
    params: { deckId },
  });
}

export default defineAction({
  description:
    "Add a single slide to an existing deck. Use this to build decks slide-by-slide — " +
    "call it once per slide in slide order and wait for each result before adding the next slide. " +
    "Avoid parallel add-slide calls for the same deck; sequential writes keep the editor and agent connection stable. " +
    "If the deck has a designSystemId, first use `get-design-system` and apply its `agentContext` tokens/docs; do not use generic slide styling from the id alone. " +
    "Returns the new slide ID, 1-based slideNumber, and updated slide count.",
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
    notes: z.string().optional().describe("Speaker notes for this slide"),
    position: z
      .preprocess((value) => {
        if (typeof value !== "string") return value;
        const trimmed = value.trim();
        return trimmed === "" ? value : Number(trimmed);
      }, z.number().int().min(0))
      .optional()
      .describe(
        "Optional 0-based index to insert at. If not provided, appends to the end of the deck.",
      ),
  }),
  mcpApp: {
    compactCatalog: true,
    resource: embedApp({
      title: "Deck editor",
      description: "Open the updated deck in the real Slides editor.",
      iframeTitle: "Agent-Native Slides",
      openLabel: "Open deck",
      height: 680,
    }),
  },
  http: false,
  run: async ({ deckId, content, slideId, layout, notes, position }) =>
    withDeckLock(deckId, async () => {
      await assertAccess("deck", deckId, "editor");
      const db = getDb();

      const rows = await db
        .select()
        .from(schema.decks)
        .where(eq(schema.decks.id, deckId));

      if (!rows.length) {
        throw new Error(`Deck ${deckId} not found`);
      }

      const row = rows[0];
      await createDeckVersionSnapshot(
        {
          id: row.id,
          title: row.title,
          data: row.data,
          ownerEmail: row.ownerEmail,
        },
        { label: "Before adding slide" },
      );
      const deck = JSON.parse(row.data);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const slides: any[] = Array.isArray(deck.slides) ? deck.slides : [];

      const newSlideId =
        slideId ??
        `slide-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const newSlide: any = {
        id: newSlideId,
        content: normalizeSlidePadding(content),
      };
      if (layout) newSlide.layout = layout;
      if (notes) newSlide.notes = notes;

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

      // Best-effort agent presence: light the agent up on the newly-added slide
      // in open editors and drop a lingering "AI edited" highlight for it. Uses
      // the NEW slide's id. Never blocks or fails the write.
      touchAgentSlidePresence({
        deckId,
        slideId: newSlideId,
        label: slideLabelFor(newSlide, insertIndex),
      });

      // Broadcast to any open editors so the new slide appears immediately.
      // Include the new slideId + agent actor (backwards-compatible payload).
      notifyClients(deckId, { slideId: newSlideId, actor: "agent" });

      // Nudge any open editor onto the new slide so the renderer measures
      // IT (not whichever slide was previously selected). Only fires when an
      // editor is open on this deck; navigation state is a no-op if nobody
      // is watching.
      const nav = (await readAppStateForCurrentTab("navigation", {
        fallbackToGlobal: false,
      }).catch(() => null)) as {
        view?: string;
        deckId?: string;
      } | null;
      if (nav?.view === "editor" && nav.deckId === deckId) {
        await writeAppStateForCurrentTab("navigate", {
          deckId,
          slideIndex: insertIndex,
          // Unique-per-write token. The UI's `use-navigation-state` hook
          // dedups by this so a race between the GET and the consume-DELETE
          // doesn't cause the same command to be re-applied repeatedly
          // (which previously bounced the editor between slides whenever the
          // agent path errored partway through a turn).
          _writeId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        }).catch(() => {});
      }

      // Wait briefly for the editor to render the new slide and report its
      // measured fit. If we get an "overflows" signal, append the auto-fix
      // hint so the agent can call update-slide right away and patch the
      // slide HTML until it fits. Timeout = no editor measurement available
      // (e.g. headless server) — return success without a fit hint.
      const fitSince = Date.now();
      const fit = await awaitLayoutFitCheck(newSlideId, fitSince, 5000);

      const base = {
        deckId,
        slideId: newSlideId,
        slideNumber: insertIndex + 1,
        position: insertIndex,
        slideCount: slides.length,
        deepLink: deckDeepLink(deckId),
      };

      if (fit.status === "overflows") {
        return {
          ...base,
          layoutOverflow: {
            verticalOverflow: fit.measurement.verticalOverflow,
            contentHeight: fit.measurement.contentHeight,
            viewportHeight: fit.measurement.viewportHeight,
          },
          message: formatOverflowForTool(deckId, fit.measurement),
        };
      }

      return base;
    }),
  link: ({ result, args }) => {
    const deckId =
      result && typeof result === "object"
        ? ((result as { deckId?: string }).deckId ??
          (typeof args.deckId === "string" ? args.deckId : undefined))
        : typeof args.deckId === "string"
          ? args.deckId
          : undefined;
    if (!deckId) return null;
    return {
      url: deckDeepLink(deckId),
      label: "Open deck in Slides",
      view: "editor",
    };
  },
});
