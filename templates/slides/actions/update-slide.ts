import { defineAction } from "@agent-native/core";
import { getDbExec } from "@agent-native/core/db";
import {
  hasCollabState,
  agentEnterDocument,
  agentLeaveDocument,
} from "@agent-native/core/collab";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";
import { notifyClients } from "../server/handlers/decks.js";
import "../server/db/index.js"; // ensure registerShareableResource runs

import { normalizeSlidePadding } from "../app/lib/normalize-slide-padding.js";
import {
  awaitLayoutFitCheck,
  formatOverflowForTool,
} from "./_await-fit-check.js";

async function findCollabOrigin(): Promise<string | null> {
  const tryOrigins = [
    process.env.ORIGIN,
    process.env.PORT ? `http://localhost:${process.env.PORT}` : null,
    "http://localhost:8080",
    "http://localhost:8081",
    "http://localhost:8082",
    "http://localhost:8083",
  ].filter(Boolean) as string[];
  for (const origin of tryOrigins) {
    try {
      const res = await fetch(`${origin}/_agent-native/ping`, {
        signal: AbortSignal.timeout(500),
      });
      if (res.ok) return origin;
    } catch {
      // Try next
    }
  }
  return null;
}

export default defineAction({
  description:
    "Surgically edit a slide's content using search-replace or full replacement. " +
    "Syncs live to open editors via Yjs CRDT. Prefer this over full deck rewrites.",
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

    const docId = `deck-${deckId}-slide-${slideId}`;
    const client = getDbExec();

    // Read SQL deck for the slide-existence check and the local fallback
    // computation that keeps decks.data in sync.
    const existing = await client.execute({
      sql: "SELECT data FROM decks WHERE id = ?",
      args: [deckId],
    });
    if (!existing.rows?.length) {
      throw new Error(`Deck ${deckId} not found`);
    }

    const deck = JSON.parse(existing.rows[0].data as string);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const slide = deck.slides?.find((s: any) => s.id === slideId);
    if (!slide) {
      throw new Error(`Slide ${slideId} not found in deck ${deckId}`);
    }

    // ─── Step 1: Push the change through Yjs FIRST ─────────────────────────
    //
    // While an editor session is active the per-slide Y.Doc is the source of
    // truth — TipTap renders the Y.XmlFragment, not decks.data. The previous
    // order (SQL write first, Yjs push second) raced against the editor's
    // autosave: by the time the agent's Yjs push landed, the editor had often
    // already overwritten decks.data with its own pre-edit state, making the
    // agent's edit appear to revert. Pushing to Yjs first lets the agent's
    // change merge with concurrent typing via CRDT, and any subsequent
    // autosave preserves it. (See #SLI-2026-05-09.)
    let yjsAccepted = false;
    const collabActive = find ? await hasCollabState(docId) : false;
    if (collabActive && find) {
      agentEnterDocument(docId);
      agentEnterDocument(`deck-${deckId}`);
      try {
        const serverOrigin = await findCollabOrigin();
        if (serverOrigin) {
          const res = await fetch(
            `${serverOrigin}/_agent-native/collab/${docId}/search-replace`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                find,
                replace: replace ?? "",
                requestSource: "agent",
              }),
            },
          ).catch(() => null);
          if (res?.ok) {
            const json = (await res.json().catch(() => null)) as {
              found?: boolean;
            } | null;
            yjsAccepted = !!json?.found;
          }
        }
      } finally {
        agentLeaveDocument(docId);
        agentLeaveDocument(`deck-${deckId}`);
      }
    }

    // ─── Step 2: Apply the same edit locally for SQL persistence ────────────

    let applied = false;
    let findFound = true;

    if (fullContent) {
      slide.content = normalizeSlidePadding(fullContent);
      applied = true;
    } else if (find) {
      const idx = (slide.content as string).indexOf(find);
      if (idx === -1) {
        findFound = false;
      } else {
        slide.content =
          slide.content.slice(0, idx) +
          (replace ?? "") +
          slide.content.slice(idx + find.length);
        applied = true;
      }
    }

    // Only fail when neither the local SQL state nor Yjs had the find text.
    // If Yjs accepted but local SQL didn't (because the editor's recent
    // typing hasn't been autosaved yet), the edit is still successful — the
    // editor's autosave will catch decks.data up to the merged Y.Doc state.
    if (!findFound && !yjsAccepted) {
      return {
        ok: false,
        message: `Text not found in slide: "${find?.slice(0, 60)}". Use get-deck to see current slide content.`,
      };
    }

    // ─── Step 3: Persist to SQL ─────────────────────────────────────────────
    //
    // Always write SQL when local computation produced a change so decks.data
    // stays current for closed-editor sessions and for new clients that load
    // the deck via /api/decks/:id before they fetch the Yjs state. Concurrent
    // editor autosaves will overwrite this with the merged Y.Doc state, which
    // already contains the agent's edit (Yjs accepted it in Step 1) — so the
    // brief window where decks.data lags Yjs is invisible to users.
    if (applied) {
      const now = new Date().toISOString();
      deck.updatedAt = now;
      await client.execute({
        sql: "UPDATE decks SET data = ?, updated_at = ? WHERE id = ?",
        args: [JSON.stringify(deck), now, deckId],
      });
    }

    notifyClients(deckId);

    console.log(
      `update-slide: deck=${deckId} slide=${slideId} ${find ? `find="${find.slice(0, 40)}"` : "fullContent"} yjs=${yjsAccepted} sql=${applied}`,
    );

    // Wait briefly for the editor to re-render and measure. If the patched
    // slide still overflows, surface the new measurement so the agent can
    // tighten further. Timeout = no editor open / nothing to measure.
    const fit = await awaitLayoutFitCheck(slideId, fitSince, 4000);

    const base = {
      ok: true,
      deckId,
      slideId,
      applied: applied || yjsAccepted,
      collabSynced: yjsAccepted,
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
});
