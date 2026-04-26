import { defineAction } from "@agent-native/core";
import { getDbExec, isPostgres } from "@agent-native/core/db";
import { hasCollabState } from "@agent-native/core/collab";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";
import { notifyClients } from "../server/handlers/decks.js";
import "../server/db/index.js"; // ensure registerShareableResource runs

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

    await assertAccess("deck", deckId, "editor");

    const docId = `deck-${deckId}-slide-${slideId}`;
    const client = getDbExec();

    // 1. Update decks.data SQL snapshot
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

    let applied = false;
    let findFound = true;

    if (fullContent) {
      slide.content = fullContent;
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

    if (!findFound) {
      return {
        ok: false,
        message: `Text not found in slide: "${find?.slice(0, 60)}". Use get-deck to see current slide content.`,
      };
    }

    if (applied) {
      const nowExpr = isPostgres() ? "NOW()::text" : "datetime('now')";
      await client.execute({
        sql: `UPDATE decks SET data = ?, updated_at = ${nowExpr} WHERE id = ?`,
        args: [JSON.stringify(deck), deckId],
      });
      // Broadcast so in-memory deck list in the editor refreshes. Yjs handles
      // live content sync for find/replace, but --fullContent and the slide
      // list itself aren't covered by Yjs — the SSE push fills that gap.
      notifyClients(deckId);
    }

    // 2. Push through Yjs for live collaborative sync (only if editor is open and
    //    collab state exists, and only for find/replace — fullContent goes via SSE)
    const collabEnabled = find ? await hasCollabState(docId) : false;
    if (collabEnabled) {
      const tryOrigins = [
        process.env.ORIGIN,
        process.env.PORT ? `http://localhost:${process.env.PORT}` : null,
        "http://localhost:8080",
        "http://localhost:8081",
        "http://localhost:8082",
        "http://localhost:8083",
      ].filter(Boolean) as string[];

      let serverOrigin: string | null = null;
      for (const origin of tryOrigins) {
        try {
          const res = await fetch(`${origin}/_agent-native/ping`, {
            signal: AbortSignal.timeout(500),
          });
          if (res.ok) {
            serverOrigin = origin;
            break;
          }
        } catch {
          // Try next
        }
      }

      if (serverOrigin) {
        // Post agent awareness to slide doc (shows "AI editing" indicator + avatar)
        await fetch(`${serverOrigin}/_agent-native/collab/${docId}/awareness`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientId: 2147483647, // Fixed agent clientId (max 32-bit signed int)
            state: JSON.stringify({
              user: { name: "AI", email: "agent@system", color: "#a78bfa" },
              slide: slideId,
            }),
          }),
        }).catch(() => {});

        // Post agent awareness to deck doc (shows avatar in sidebar)
        await fetch(
          `${serverOrigin}/_agent-native/collab/deck-${deckId}/awareness`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              clientId: 2147483647,
              state: JSON.stringify({
                user: { name: "AI", email: "agent@system", color: "#a78bfa" },
                slide: slideId,
              }),
            }),
          },
        ).catch(() => {});

        // Apply surgical search-replace to the Yjs doc
        await fetch(
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
        ).catch(() => {});
      }
    }

    console.log(
      `update-slide: deck=${deckId} slide=${slideId} ${find ? `find="${find.slice(0, 40)}"` : "fullContent"} collab=${collabEnabled}`,
    );

    return { ok: true, deckId, slideId, applied, collabSynced: collabEnabled };
  },
});
