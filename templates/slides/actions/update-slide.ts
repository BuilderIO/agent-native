import { defineAction } from "@agent-native/core";
import { buildDeepLink } from "@agent-native/core/server";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { normalizeSlidePadding } from "../app/lib/normalize-slide-padding.js";
import { getDb, schema } from "../server/db/index.js"; // ensure registerShareableResource runs
import { notifyClients } from "../server/handlers/decks.js";
import { createDeckVersionSnapshot } from "../server/lib/deck-versions.js";
import {
  awaitLayoutFitCheck,
  formatOverflowForTool,
} from "./_await-fit-check.js";

function deckDeepLink(deckId: string): string {
  return buildDeepLink({
    app: "slides",
    view: "editor",
    params: { deckId },
  });
}

export default defineAction({
  description:
    "Surgically edit a slide's content using search-replace or full replacement. " +
    "Syncs live to open editors. Prefer this over full deck rewrites.",
  schema: z.object({
    deckId: z.string().describe("Deck ID"),
    slideId: z.string().describe("Slide ID"),
    find: z
      .string()
      .optional()
      .describe("Text to find (for surgical search-replace edit)"),
    replace: z
      .string()
      .optional()
      .describe("Replacement text (default: empty string)"),
    fullContent: z
      .string()
      .optional()
      .describe("Full HTML to replace entire slide content"),
  }),
  http: false,
  run: async (args) => {
    const { deckId, slideId, find, replace, fullContent } = args;
    if (!find && !fullContent) {
      throw new Error("Either --find or --fullContent is required");
    }
    const fitSince = Date.now();

    await assertAccess("deck", deckId, "editor");

    const db = getDb();

    // Read SQL deck for the slide-existence check and to compute the new slide
    // HTML that we persist back into decks.data.
    const [row] = await db
      .select({
        id: schema.decks.id,
        title: schema.decks.title,
        data: schema.decks.data,
        ownerEmail: schema.decks.ownerEmail,
        designSystemId: schema.decks.designSystemId,
      })
      .from(schema.decks)
      .where(eq(schema.decks.id, deckId))
      .limit(1);
    if (!row) {
      throw new Error(`Deck ${deckId} not found`);
    }

    await createDeckVersionSnapshot(
      {
        id: row.id,
        title: row.title ?? "Untitled",
        data: row.data ?? "",
        ownerEmail: row.ownerEmail ?? "",
      },
      { label: "Before slide edit" },
    );

    const deck = JSON.parse(row.data);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const slide = deck.slides?.find((s: any) => s.id === slideId);
    if (!slide) {
      throw new Error(`Slide ${slideId} not found in deck ${deckId}`);
    }

    // ─── Apply the edit to the slide content in decks.data ──────────────────
    //
    // The agent edits the canonical slide HTML stored in `decks.data` (SQL is
    // the source of truth). The change is delivered live to any open editor by
    // the framework's normal change-sync: `notifyClients` invalidates the deck
    // query, the editor refetches, and reconciles the newer slide HTML into the
    // live view — gated on the deck's `updatedAt` so a lagging poll never
    // reverts an in-progress human edit, and (for the Yjs-backed inline editor)
    // applied through the editor's real content pipeline so new block structure
    // renders and merges with concurrent typing via the Yjs CRDT.
    //
    // (The old approach POSTed a Yjs search-replace to a localhost collab
    // origin, which silently no-oped on serverless — different process, no
    // localhost server — and could only patch text inside existing nodes,
    // never create new block structure.)
    let applied = false;

    if (fullContent) {
      slide.content = normalizeSlidePadding(fullContent);
      applied = true;
    } else if (find) {
      const idx = (slide.content as string).indexOf(find);
      if (idx === -1) {
        return {
          ok: false,
          message: `Text not found in slide: "${find.slice(0, 60)}". Use get-deck to see current slide content.`,
        };
      }
      slide.content =
        slide.content.slice(0, idx) +
        (replace ?? "") +
        slide.content.slice(idx + find.length);
      applied = true;
    }

    // ─── Persist to SQL ─────────────────────────────────────────────────────
    //
    // The fresh `updatedAt` (on both the deck JSON and the row) is the signal an
    // open editor uses to tell an intentional external edit apart from a stale
    // poll echo — only a newer timestamp is reconciled into the live view.
    if (applied) {
      const now = new Date().toISOString();
      deck.updatedAt = now;
      await db
        .update(schema.decks)
        .set({ data: JSON.stringify(deck), updatedAt: now })
        .where(eq(schema.decks.id, deckId));
    }

    notifyClients(deckId);

    console.log(
      `update-slide: deck=${deckId} slide=${slideId} ${find ? `find="${find.slice(0, 40)}"` : "fullContent"} applied=${applied}`,
    );

    // Wait briefly for the editor to re-render and measure. If the patched
    // slide still overflows, surface the new measurement so the agent can
    // tighten further. Timeout = no editor open / nothing to measure.
    const fit = await awaitLayoutFitCheck(slideId, fitSince, 4000);

    const base = {
      ok: true,
      deckId,
      slideId,
      applied,
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
  },
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
