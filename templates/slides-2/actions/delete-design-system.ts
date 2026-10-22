import { defineAction } from "@agent-native/core/action";
import { getRequestOrgId } from "@agent-native/core/server/request-context";
import {
  accessFilter,
  assertAccess,
  resolveAccess,
  type ShareRole,
} from "@agent-native/core/sharing";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { assertSlides2DeckData } from "./_deck-app-scope.js";
import {
  assertDeckWriteApplied,
  deckRevisionWhere,
  nextDeckRevision,
} from "./_deck-write.js";
import { withDeckLock } from "./patch-deck.js";

function canEditDeckRole(role: "owner" | ShareRole) {
  return role === "owner" || role === "admin" || role === "editor";
}

type UnlinkResult =
  | { deckId: string; status: "unlinked" }
  | { deckId: string; status: "skipped-no-access" };

function unlinkDeck(
  deckId: string,
  designSystemId: string,
): Promise<UnlinkResult> {
  return withDeckLock(deckId, async () => {
    const access = await resolveAccess("deck", deckId);
    if (!access || !canEditDeckRole(access.role)) {
      return { deckId, status: "skipped-no-access" };
    }

    const db = getDb();
    const [deck] = await db
      .select({
        designSystemId: schema.decks.designSystemId,
        data: schema.decks.data,
        updatedAt: schema.decks.updatedAt,
      })
      .from(schema.decks)
      .where(eq(schema.decks.id, deckId));
    if (!deck || deck.designSystemId !== designSystemId) {
      return { deckId, status: "unlinked" };
    }

    const data = JSON.parse(deck.data);
    assertSlides2DeckData(data);
    if ("designSystemId" in data) delete data.designSystemId;
    const updateResult = await db
      .update(schema.decks)
      .set({
        designSystemId: null,
        data: JSON.stringify(data),
        updatedAt: nextDeckRevision(deck.updatedAt),
      })
      .where(deckRevisionWhere(schema.decks, deckId, deck.updatedAt));
    assertDeckWriteApplied(updateResult, deckId, "design-system unlink");
    return { deckId, status: "unlinked" };
  });
}

export default defineAction({
  description:
    "Delete a design system. Requires admin access or higher. Decks linked to it that " +
    "the caller can edit are unlinked; others keep a dangling reference and are returned " +
    "in decksSkippedForAccess. Once you have editor access, clear a skipped link with " +
    "patch-deck using designSystemId: null; use apply-design-system to link a system. If the " +
    "deleted system was the caller's default, another of their design systems is promoted to default.",
  schema: z.object({
    id: z.string().min(1).describe("Design system ID to delete"),
  }),
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
  run: async ({ id }) => {
    const access = await assertAccess("design-system", id, "admin");

    const db = getDb();
    const orgId = getRequestOrgId();

    const linkedDecks = await db
      .select({ id: schema.decks.id, data: schema.decks.data })
      .from(schema.decks)
      .where(
        and(
          eq(schema.decks.designSystemId, id),
          accessFilter(schema.decks, schema.deckShares),
        ),
      );
    for (const deck of linkedDecks) {
      assertSlides2DeckData(JSON.parse(deck.data));
    }

    const linkedDeckIds = linkedDecks.map((row) => row.id);

    await db.transaction(async (tx) => {
      await tx
        .delete(schema.designSystemShares)
        .where(eq(schema.designSystemShares.resourceId, id));

      await tx
        .delete(schema.designSystems)
        .where(eq(schema.designSystems.id, id));

      if (access.resource.isDefault) {
        const [next] = await tx
          .select({ id: schema.designSystems.id })
          .from(schema.designSystems)
          .where(
            orgId
              ? and(
                  eq(
                    schema.designSystems.ownerEmail,
                    access.resource.ownerEmail,
                  ),
                  eq(schema.designSystems.orgId, orgId),
                )
              : and(
                  eq(
                    schema.designSystems.ownerEmail,
                    access.resource.ownerEmail,
                  ),
                  isNull(schema.designSystems.orgId),
                ),
          )
          .orderBy(desc(schema.designSystems.updatedAt))
          .limit(1);
        if (next) {
          await tx
            .update(schema.designSystems)
            .set({ isDefault: true, updatedAt: new Date().toISOString() })
            .where(eq(schema.designSystems.id, next.id));
        }
      }
    });

    const settled = await Promise.allSettled(
      linkedDeckIds.map((deckId) => unlinkDeck(deckId, id)),
    );

    const decksSkippedForAccess: string[] = [];
    const decksFailedToUnlink: string[] = [];
    settled.forEach((result, index) => {
      const deckId = linkedDeckIds[index];
      if (result.status === "rejected") {
        decksFailedToUnlink.push(deckId);
      } else if (result.value.status === "skipped-no-access") {
        decksSkippedForAccess.push(deckId);
      }
    });

    return {
      id,
      deleted: true,
      ...(decksSkippedForAccess.length > 0 ? { decksSkippedForAccess } : {}),
      ...(decksFailedToUnlink.length > 0 ? { decksFailedToUnlink } : {}),
    };
  },
});
