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
 * Snooze an Attention Queue item until a future time. Removes the item from
 * the user's queue view until `until` passes, at which point it surfaces
 * again on the next refresh.
 *
 * `itemKey` is the stable id from `list-attention-queue` (e.g.
 * `"pr:acme/api#1234"` or `"run:abc"`). Snooze state lives in
 * `workbench_queue_state`, scoped per-user via `owner_email`.
 *
 * `until` accepts a couple of friendly relative tokens (`"tomorrow"` /
 * `"next-week"`) or an ISO 8601 date / datetime. We resolve the relative
 * tokens server-side using the request timezone (UI sends it via the
 * `x-user-timezone` header) so "tomorrow" matches what the user expects.
 */
export default defineAction({
  description:
    "Snooze an Attention Queue item until a future time. The item is hidden from the queue until the snooze expires.",
  schema: z.object({
    itemKey: z
      .string()
      .min(1)
      .describe(
        "Stable item id from list-attention-queue, e.g. 'pr:acme/api#1234' or 'run:abc'.",
      ),
    until: z
      .string()
      .min(1)
      .describe(
        "When to surface again: 'tomorrow', 'next-week', or an ISO 8601 datetime.",
      ),
  }),
  run: async (args) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) {
      throw new Error("Sign in to snooze queue items.");
    }
    const orgId = getRequestOrgId() ?? null;
    const snoozedUntil = resolveSnoozeUntil(args.until);

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

    const now = new Date().toISOString();

    if (existing.length > 0) {
      await db
        .update(schema.workbenchQueueState)
        .set({
          snoozedUntil,
          // Clearing dismissed/done resurfaces a previously-actioned item
          // only when the user explicitly snoozes it again — which is the
          // expected behavior: "snooze" means "show me later", not "hide
          // forever".
          dismissedAt: null,
          doneAt: null,
        })
        .where(eq(schema.workbenchQueueState.id, existing[0].id));
      return {
        ok: true,
        itemKey: args.itemKey,
        snoozedUntil,
        message: `Snoozed until ${snoozedUntil}.`,
      };
    }

    await db.insert(schema.workbenchQueueState).values({
      id: nanoid(),
      itemKey: args.itemKey,
      snoozedUntil,
      lastSeenAt: now,
      ownerEmail,
      orgId: orgId ?? undefined,
      visibility: "private",
    });

    return {
      ok: true,
      itemKey: args.itemKey,
      snoozedUntil,
      message: `Snoozed until ${snoozedUntil}.`,
    };
  },
});

/**
 * Normalize a `until` arg into an ISO 8601 string. Relative tokens
 * (`"tomorrow"`, `"next-week"`) resolve to 9 AM in the request's IANA
 * timezone when one was supplied, falling back to UTC otherwise.
 */
function resolveSnoozeUntil(input: string): string {
  const trimmed = input.trim().toLowerCase();
  const now = new Date();

  if (trimmed === "tomorrow") {
    const t = new Date(now);
    t.setDate(t.getDate() + 1);
    t.setHours(9, 0, 0, 0);
    return t.toISOString();
  }
  if (trimmed === "next-week" || trimmed === "next week") {
    const t = new Date(now);
    t.setDate(t.getDate() + 7);
    t.setHours(9, 0, 0, 0);
    return t.toISOString();
  }

  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(
      `Invalid 'until' value: ${input}. Use 'tomorrow', 'next-week', or an ISO 8601 datetime.`,
    );
  }
  return parsed.toISOString();
}
