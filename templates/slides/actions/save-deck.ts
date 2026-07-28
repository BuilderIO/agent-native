/**
 * save-deck — create-or-replace a deck's whole JSON payload.
 *
 * The browser editor saves through `patch-deck`; this full-payload write is
 * reserved for the paths that already hold an authoritative snapshot (undo/redo
 * and bulk slide replacement). Hidden from the agent, which edits through
 * `patch-deck`, `update-slide`, and `add-slide` so concurrent writers on
 * different slides don't clobber each other.
 */
import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { resolveAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { notifyClients } from "../server/handlers/decks.js";
import { createDeckVersionSnapshot } from "../server/lib/deck-versions.js";
import {
  assertDesignSystemReadable,
  assertValidAspectRatio,
  deckDesignSystemId,
  deckHttpError,
  deckTitle,
  type DeckPayload,
} from "./_deck-write.js";
import { withDeckLock } from "./patch-deck.js";

function comparableDeckData(raw: unknown): string {
  try {
    const data = typeof raw === "string" ? JSON.parse(raw) : raw;
    const clone = JSON.parse(JSON.stringify(data ?? {}));
    delete clone.updatedAt;
    return JSON.stringify(clone);
  } catch {
    return String(raw ?? "");
  }
}

function shouldSnapshotDeckWrite(
  current: { title?: string | null; data?: string | null },
  nextTitle: string,
  nextDeck: DeckPayload,
): boolean {
  return (
    (current.title ?? "Untitled") !== nextTitle ||
    comparableDeckData(current.data ?? "") !== comparableDeckData(nextDeck)
  );
}

export default defineAction({
  description:
    "Create or replace a deck's full JSON payload (title, slides, deck-level fields).",
  schema: z.object({
    deckId: z.string().min(1).describe("Deck ID"),
    deck: z.record(z.string(), z.unknown()).describe("Full deck JSON payload"),
  }),
  http: { method: "PUT" },
  agentTool: false,
  run: async (args) =>
    withDeckLock(args.deckId, async () => {
      const deckId = args.deckId;
      const deck = args.deck as DeckPayload;
      assertValidAspectRatio(deck);

      const db = getDb();
      const now = new Date().toISOString();

      deck.id = deckId;
      deck.updatedAt = now;
      const title = deckTitle(deck);
      const nextDesignSystemId = deckDesignSystemId(deck);

      // Resolve access first — this loads the row AND tells us the caller's
      // effective role in one pass, so we never run an unscoped existence
      // SELECT that would leak "this id exists" to non-owners.
      const access = await resolveAccess("deck", deckId);

      if (!access) {
        // Either the deck does not exist OR the caller cannot see it. In both
        // cases we treat this as a create for the caller. If the row actually
        // exists but is owned by someone else, the INSERT below fails on the
        // primary key — mapped to a 404 so we never reveal that the id is taken.
        const ownerEmail = getRequestUserEmail();
        if (!ownerEmail) {
          throw deckHttpError(403, "Sign in to create a deck");
        }
        await assertDesignSystemReadable(nextDesignSystemId);
        try {
          await db.insert(schema.decks).values({
            id: deckId,
            title,
            data: JSON.stringify(deck),
            designSystemId: nextDesignSystemId,
            ownerEmail,
            orgId: getRequestOrgId() ?? null,
            createdAt: now,
            updatedAt: now,
          });
        } catch {
          // Some adapters wrap duplicate-key failures in a generic query error
          // that includes bound params, so never surface the raw error here.
          throw deckHttpError(404, "Deck not found");
        }
      } else if (
        access.role === "owner" ||
        access.role === "admin" ||
        access.role === "editor"
      ) {
        await assertDesignSystemReadable(nextDesignSystemId);
        if (shouldSnapshotDeckWrite(access.resource, title, deck)) {
          await createDeckVersionSnapshot(
            {
              id: access.resource.id,
              title: access.resource.title,
              data: access.resource.data,
              ownerEmail: access.resource.ownerEmail as string,
            },
            { label: "Before editor save" },
          );
        }
        await db
          .update(schema.decks)
          .set({
            title,
            data: JSON.stringify(deck),
            designSystemId:
              nextDesignSystemId ?? access.resource.designSystemId,
            updatedAt: now,
          })
          .where(eq(schema.decks.id, deckId));
      } else {
        // Viewer-only access — same 404 as no-access so we don't leak that the
        // deck exists with restricted permissions.
        throw deckHttpError(404, "Deck not found");
      }

      notifyClients(deckId);
      return deck;
    }),
});
