import { defineAction } from "@agent-native/core";
import type { ActionRunContext } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  deleteVariantState,
  readVariantState,
  writeVariantState,
} from "./variant-slots.js";

export default defineAction({
  description:
    "Clear one or more live candidate slots from application_state.asset-variants. Uses the current chat thread when available. Use slotId for a single slot, scope='failed' to drop every failed slot, or scope='all' to clear the panel. Any underlying asset rows for cleared slots are deleted (requires editor access on the library).",
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

    await assertAccess("asset-library", state.libraryId, "editor");

    const toRemove = state.slots.filter((slot) => {
      if (slotId) return slot.slotId === slotId;
      if (scope === "failed") return slot.status === "failed";
      return true;
    });

    if (toRemove.length === 0) {
      return { dismissed: 0, assetsDeleted: 0, cleared: false };
    }

    let assetsDeleted = 0;
    const db = getDb();
    for (const slot of toRemove) {
      if (!slot.assetId) continue;
      try {
        await db
          .delete(schema.assets)
          .where(eq(schema.assets.id, slot.assetId));
        assetsDeleted++;
      } catch {
        // Best-effort: the slot can still be cleared even if the row is gone.
      }
    }

    const removed = new Set(toRemove.map((s) => s.slotId));
    const remaining = state.slots.filter((s) => !removed.has(s.slotId));

    if (remaining.length === 0) {
      await deleteVariantState(stateThreadId);
      return {
        dismissed: toRemove.length,
        assetsDeleted,
        cleared: true,
      };
    }

    state.slots = remaining;
    state.updatedAt = new Date().toISOString();
    await writeVariantState(state, stateThreadId);
    return {
      dismissed: toRemove.length,
      assetsDeleted,
      cleared: false,
    };
  },
});
