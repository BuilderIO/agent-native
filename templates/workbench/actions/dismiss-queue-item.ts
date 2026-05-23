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
 * Permanently hide an Attention Queue item from the user's queue. Use
 * `mark-queue-item-done` instead when the user actually completed the
 * action — `dismiss` is for "I do not want to see this again", whether or
 * not anything was done about it.
 */
export default defineAction({
  description:
    "Dismiss an Attention Queue item — hide it from the queue permanently.",
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
      throw new Error("Sign in to dismiss queue items.");
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
          dismissedAt: now,
          snoozedUntil: null,
        })
        .where(eq(schema.workbenchQueueState.id, existing[0].id));
    } else {
      await db.insert(schema.workbenchQueueState).values({
        id: nanoid(),
        itemKey: args.itemKey,
        dismissedAt: now,
        lastSeenAt: now,
        ownerEmail,
        orgId: orgId ?? undefined,
        visibility: "private",
      });
    }

    return {
      ok: true,
      itemKey: args.itemKey,
      dismissedAt: now,
      message: "Dismissed.",
    };
  },
});
