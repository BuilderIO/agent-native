import { defineAction } from "@agent-native/core";
import {
  assertAccess,
  resolveAccess,
  type ShareRole,
} from "@agent-native/core/sharing";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { withDeckLock } from "./patch-deck.js";

function canEditDeckRole(role: "owner" | ShareRole) {
  return role === "owner" || role === "admin" || role === "editor";
}

type UnlinkResult =
  | { deckId: string; status: "unlinked" }
  | { deckId: string; status: "skipped-no-access" };

// Runs under the same per-deck lock patch-deck/save-deck/update-slide use for
// all deck writes, re-reading the row inside the lock so a concurrent slide
// edit can't be clobbered by this read-modify-write. Decks the caller can't
// edit are left pointing at the deleted id rather than silently mutated —
// admin access on a shared design system does not imply edit access on every
// deck that happens to reference it.
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
      })
      .from(schema.decks)
      .where(eq(schema.decks.id, deckId));
    if (!deck || deck.designSystemId !== designSystemId) {
      return { deckId, status: "unlinked" };
    }

    const data = JSON.parse(deck.data);
    if ("designSystemId" in data) delete data.designSystemId;
    await db
      .update(schema.decks)
      .set({
        designSystemId: null,
        data: JSON.stringify(data),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.decks.id, deckId));
    return { deckId, status: "unlinked" };
  });
}

export default defineAction({
  description:
    "Delete a design system. Requires admin access or higher. Decks linked to it that " +
    "the caller can edit are unlinked; others keep a dangling reference (clear it with " +
    "patch-deck's patch-deck-fields, designSystemId: null). If the deleted system was the " +
    "caller's default, another of their design systems is promoted to default.",
  schema: z.object({
    id: z.string().min(1).describe("Design system ID to delete"),
  }),
  run: async ({ id }) => {
    const access = await assertAccess("design-system", id, "admin");

    const db = getDb();

    const linkedDeckIds = (
      await db
        .select({ id: schema.decks.id })
        .from(schema.decks)
        .where(eq(schema.decks.designSystemId, id))
    ).map((row) => row.id);

    // Delete the design system (and its shares) before touching linked decks.
    // Once the row is gone, apply-design-system/create-deck's
    // assertAccess("design-system", ...) check fails for anyone trying to
    // attach a fresh link, shrinking the window for a deck to end up pointing
    // at a design system we're about to remove. If this was the owner's
    // default, promote another of their design systems in the same
    // transaction so deck creation never silently drops to "no design
    // system" just because the default happened to be deleted.
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
            eq(schema.designSystems.ownerEmail, access.resource.ownerEmail),
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

    // Best-effort cleanup: the design system is already gone, so a deck we
    // can't touch (missing access) or fail to update (write error) is left
    // dangling rather than retried here. Both cases are reported back instead
    // of swallowed, so the caller can decide whether to intervene.
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
