import { defineAction } from "@agent-native/core";
import {
  getRequestUserEmail,
  getRequestOrgId,
} from "@agent-native/core/server";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";

/**
 * Mark an Attention Queue item as done. Hides it from the queue going
 * forward. Same SQL footprint as `dismiss`, but the semantic intent
 * (item handled vs item ignored) is preserved for future analytics on
 * inbox-zero behavior.
 */
export default defineAction({
  description:
    "Mark an Attention Queue item as done. The item is removed from the queue silently.",
  schema: z.object({
    itemKey: z
      .string()
      .min(1)
      .describe(
        "Stable item id from list-attention-queue, e.g. 'pr:acme/api#1234'.",
      ),
  }),
  run: async (args) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) {
      throw new Error("Sign in to mark queue items done.");
    }
    const orgId = getRequestOrgId() ?? null;
    const now = new Date().toISOString();

    const db = getDb();
    const existing = await db
      .select()
      .from(schema.workbenchQueueState)
      .where(
        and(
          eq(schema.workbenchQueueState.ownerEmail, ownerEmail),
          eq(schema.workbenchQueueState.itemKey, args.itemKey),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(schema.workbenchQueueState)
        .set({
          doneAt: now,
          snoozedUntil: null,
        })
        .where(eq(schema.workbenchQueueState.id, existing[0].id));
    } else {
      await db.insert(schema.workbenchQueueState).values({
        id: nanoid(),
        itemKey: args.itemKey,
        doneAt: now,
        lastSeenAt: now,
        ownerEmail,
        orgId: orgId ?? undefined,
        visibility: "private",
      });
    }

    return {
      ok: true,
      itemKey: args.itemKey,
      doneAt: now,
      message: "Marked done.",
    };
  },
});
