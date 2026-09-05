/**
 * save-deck — create-or-replace a deck's whole JSON payload.
 *
 * The browser editor saves through `patch-deck`; this full-payload write is
 * reserved for the paths that already hold an authoritative snapshot (undo/redo
 * and bulk slide replacement). Hidden from the agent, which edits through
 * `patch-deck`, `update-slide`, and `add-slide` so concurrent writers on
 * different slides don't clobber each other.
 */
import { defineAction } from "@agent-native/core/action";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { resolveAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { notifyClients } from "../server/handlers/decks.js";
import {
  createDeckVersionSnapshot,
  deckVersionContentSignature,
} from "../server/lib/deck-versions.js";
import {
  assertHumanReadableDeckTitle,
  repairGeneratedDeckTitle,
} from "../shared/deck-title.js";
import {
  createLayoutFitRevision,
  deckFitRenderFieldsChanged,
  slideFitRenderFieldsChanged,
} from "../shared/slide-fit.js";
import {
  ensureUniqueSlideIds,
  repairDeckSlideReferences,
} from "../shared/slide-ids.js";
import { getDeckUrl } from "./_app-url.js";
import {
  assertDesignSystemReadable,
  assertValidAspectRatio,
  assertDeckWriteApplied,
  deckDesignSystemId,
  deckHttpError,
  deckTitle,
  deckRevisionWhere,
  nextDeckRevision,
  type DeckPayload,
} from "./_deck-write.js";
import { withDeckLock } from "./patch-deck.js";

function shouldSnapshotDeckWrite(
  current: { title?: string | null; data?: string | null },
  nextTitle: string,
  nextDeck: DeckPayload,
): boolean {
  return (
    (current.title ?? "Untitled") !== nextTitle ||
    deckVersionContentSignature(current.data ?? "") !==
      deckVersionContentSignature(nextDeck)
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
      if (Array.isArray(deck.slides)) {
        const normalized = ensureUniqueSlideIds(
          deck.slides as Array<{ id?: unknown }>,
        );
        deck.slides = normalized.slides;
        if (normalized.changed) {
          Object.assign(
            deck,
            repairDeckSlideReferences(
              deck,
              normalized.slides,
              normalized.originalIds,
            ),
          );
        }
      }
      assertValidAspectRatio(deck);

      const db = getDb();
      const now = new Date().toISOString();

      deck.id = deckId;
      deck.updatedAt = now;
      const requestedTitle = deckTitle(deck);

      // Resolve access first — this loads the row AND tells us the caller's
      // effective role in one pass, so we never run an unscoped existence
      // SELECT that would leak "this id exists" to non-owners.
      const access = await resolveAccess("deck", deckId);
      stampChangedSlideRevisions(access?.resource.data, deck);

      if (!access) {
        // Either the deck does not exist OR the caller cannot see it. In both
        // cases we treat this as a create for the caller. If the row actually
        // exists but is owned by someone else, the INSERT below fails on the
        // primary key — mapped to a 404 so we never reveal that the id is taken.
        const ownerEmail = getRequestUserEmail();
        if (!ownerEmail) {
          throw deckHttpError(403, "Sign in to create a deck");
        }
        const title =
          repairGeneratedDeckTitle(requestedTitle, firstSlideContent(deck)) ??
          requestedTitle;
        assertHumanReadableDeckTitle(title);
        deck.title = title;
        await assertDesignSystemReadable(deckDesignSystemId(deck));
        try {
          await db.insert(schema.decks).values({
            id: deckId,
            title,
            data: JSON.stringify(deck),
            designSystemId: deckDesignSystemId(deck),
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
        const title =
          repairGeneratedDeckTitle(
            requestedTitle,
            firstSlideContent(deck),
            access.resource.title,
          ) ?? requestedTitle;
        assertHumanReadableDeckTitle(title);
        deck.title = title;
        const updatedAt = nextDeckRevision(access.resource.updatedAt);
        deck.updatedAt = updatedAt;
        const nextDesignSystemId = Object.hasOwn(deck, "designSystemId")
          ? deckDesignSystemId(deck)
          : (access.resource.designSystemId ?? null);
        await assertDesignSystemReadable(nextDesignSystemId);
        if (!shouldSnapshotDeckWrite(access.resource, title, deck)) {
          return { ...deck, updatedAt: access.resource.updatedAt };
        }
        await db.transaction(async (tx: any) => {
          if (shouldSnapshotDeckWrite(access.resource, title, deck)) {
            await createDeckVersionSnapshot(
              {
                id: access.resource.id,
                title: access.resource.title,
                data: access.resource.data,
                ownerEmail: access.resource.ownerEmail as string,
              },
              { label: "Before editor save", db: tx },
            );
          }
          const updateResult = await tx
            .update(schema.decks)
            .set({
              title,
              data: JSON.stringify(deck),
              designSystemId: nextDesignSystemId,
              updatedAt,
            })
            .where(
              deckRevisionWhere(
                schema.decks,
                deckId,
                access.resource.updatedAt,
              ),
            );
          assertDeckWriteApplied(updateResult, deckId, "deck save");
        });
      } else {
        // Viewer-only access — same 404 as no-access so we don't leak that the
        // deck exists with restricted permissions.
        throw deckHttpError(404, "Deck not found");
      }

      notifyClients(deckId);
      return { ...deck, appUrl: getDeckUrl(deckId) };
    }),
});

function firstSlideContent(deck: DeckPayload): string | null {
  const slides = Array.isArray(deck.slides) ? deck.slides : [];
  const content = slides[0] && (slides[0] as Record<string, unknown>).content;
  return typeof content === "string" ? content : null;
}

export function stampChangedSlideRevisions(
  previousData: string | null | undefined,
  nextDeck: DeckPayload,
): void {
  const previous = previousData
    ? (JSON.parse(previousData) as {
        aspectRatio?: unknown;
        designSystemId?: unknown;
        slides?: unknown;
      })
    : {};
  const deckFitFieldsChanged = deckFitRenderFieldsChanged(previous, nextDeck);
  const previousSlides = (
    Array.isArray(previous.slides) ? previous.slides : []
  ) as Array<Record<string, unknown>>;
  const nextSlides = Array.isArray(nextDeck.slides)
    ? (nextDeck.slides as Array<Record<string, unknown>>)
    : [];

  for (const slide of nextSlides) {
    const prior = previousSlides.find((candidate) => candidate.id === slide.id);
    if (
      deckFitFieldsChanged ||
      !prior ||
      slideFitRenderFieldsChanged(prior, slide)
    ) {
      slide.layoutFitRevision = createLayoutFitRevision();
    } else if (typeof prior.layoutFitRevision === "string") {
      slide.layoutFitRevision = prior.layoutFitRevision;
    } else {
      delete slide.layoutFitRevision;
    }
  }
}
