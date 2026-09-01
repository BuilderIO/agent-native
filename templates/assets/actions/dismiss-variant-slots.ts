import { defineAction } from "@agent-native/core/action";
import type { ActionRunContext } from "@agent-native/core/action";
import { ForbiddenError } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  assertCanDeleteAsset,
  assertCanDraft,
} from "../server/lib/library-access.js";
import {
  deleteVariantState,
  readVariantState,
  writeVariantState,
} from "./variant-slots.js";

/**
 * Dismiss only ever removes an unsaved draft the caller may discard. Anything
 * else — saved kit content, another drafter's candidate — is reported back as
 * retained rather than deleted or silently swallowed.
 */
async function canDiscardAsset(asset: {
  libraryId: string;
  role: string | null;
  status: string | null;
  generationRunId: string | null;
}): Promise<boolean> {
  if (asset.role !== "generated" || asset.status !== "candidate") return false;
  try {
    await assertCanDeleteAsset(asset);
    return true;
  } catch (error) {
    // A refusal is a decision the caller should see as "retained". Anything
    // else — an unreadable run row, a failed query — must not read back as
    // "not yours to discard".
    if (error instanceof ForbiddenError) return false;
    throw error;
  }
}

export default defineAction({
  description:
    "Clear one or more live candidate slots from application_state.asset-variants. Uses the current chat thread when available. Use slotId for a single slot, scope='failed' to drop every failed slot, or scope='all' to clear the panel. Unsaved draft candidates behind the cleared slots are deleted when the caller may discard them; anything already saved into the kit is left in place and counted in assetsRetained.",
  schema: z
    .object({
      slotId: z.string().optional(),
      scope: z.enum(["failed", "all"]).optional(),
      threadId: z.string().nullable().optional(),
    })
    .refine((v) => Boolean(v.slotId) !== Boolean(v.scope), {
      message: "Provide exactly one of `slotId` or `scope`.",
    }),
  run: async ({ slotId, scope, threadId }, context?: ActionRunContext) => {
    const effectiveThreadId = threadId ?? context?.threadId ?? null;
    const state = await readVariantState(effectiveThreadId);
    if (!state || !Array.isArray(state.slots) || state.slots.length === 0) {
      return { dismissed: 0, assetsDeleted: 0, cleared: true };
    }
    const stateThreadId =
      effectiveThreadId ?? state.variantScopeId ?? state.threadId ?? null;

    await assertCanDraft(state.libraryId);

    const toRemove = state.slots.filter((slot) => {
      if (slotId) return slot.slotId === slotId;
      if (scope === "failed") return slot.status === "failed";
      return true;
    });

    if (toRemove.length === 0) {
      return {
        dismissed: 0,
        assetsDeleted: 0,
        assetsRetained: 0,
        cleared: false,
      };
    }

    let assetsDeleted = 0;
    let assetsRetained = 0;
    const db = getDb();
    for (const slot of toRemove) {
      if (!slot.assetId) continue;
      // Never trust the slot's assetId as permission to delete: variant state
      // is client-writable, so re-read the row and let the draft rules decide.
      // A slot pointing at another kit, at saved kit content, or at someone
      // else's draft clears from the tray without touching the asset.
      const [asset] = await db
        .select({
          id: schema.assets.id,
          libraryId: schema.assets.libraryId,
          role: schema.assets.role,
          status: schema.assets.status,
          generationRunId: schema.assets.generationRunId,
        })
        .from(schema.assets)
        .where(eq(schema.assets.id, slot.assetId))
        .limit(1);
      if (!asset) continue;
      if (
        asset.libraryId !== state.libraryId ||
        !(await canDiscardAsset(asset))
      ) {
        assetsRetained++;
        continue;
      }
      // Delete against the state that was authorized, not just the id: an
      // editor can save this candidate between the check and the delete, and
      // that save must win over an in-flight dismissal.
      await db
        .delete(schema.assets)
        .where(
          and(
            eq(schema.assets.id, asset.id),
            eq(schema.assets.libraryId, asset.libraryId),
            eq(schema.assets.role, "generated"),
            eq(schema.assets.status, "candidate"),
          ),
        );
      // Row counts are adapter-specific, so confirm by re-reading rather than
      // trusting a driver-shaped result.
      const [survivor] = await db
        .select({ id: schema.assets.id })
        .from(schema.assets)
        .where(eq(schema.assets.id, asset.id))
        .limit(1);
      if (survivor) {
        assetsRetained++;
      } else {
        assetsDeleted++;
      }
    }

    const removed = new Set(toRemove.map((s) => s.slotId));
    const remaining = state.slots.filter((s) => !removed.has(s.slotId));

    if (remaining.length === 0) {
      await deleteVariantState(stateThreadId);
      return {
        dismissed: toRemove.length,
        assetsDeleted,
        assetsRetained,
        cleared: true,
      };
    }

    state.slots = remaining;
    state.updatedAt = new Date().toISOString();
    await writeVariantState(state, stateThreadId);
    return {
      dismissed: toRemove.length,
      assetsDeleted,
      assetsRetained,
      cleared: false,
    };
  },
});
