/**
 * Aggregate notification feed for the current user.
 *
 * Returns comments and reactions added TO the user's recordings in the last
 * N days (default 30), plus mentions in comments. Used by the Notifications
 * Center route.
 *
 * Usage:
 *   pnpm action list-notifications
 *   pnpm action list-notifications --days=7
 */

import { defineAction } from "@agent-native/core";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import { getCurrentOwnerEmail } from "../server/lib/recordings.js";

export default defineAction({
  description:
    "Aggregate notifications for the current user: comments, reactions, mentions, and share events on their recordings in the last N days.",
  schema: z.object({
    days: z.coerce.number().int().min(1).max(365).default(30),
    limit: z.coerce.number().int().min(1).max(500).default(200),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const db = getDb();
    const me = getCurrentOwnerEmail();

    // Recordings I own — notifications are about activity ON these.
    const myRecordings = await db
      .select({
        id: schema.recordings.id,
        title: schema.recordings.title,
      })
      .from(schema.recordings)
      .where(eq(schema.recordings.ownerEmail, me));
    if (myRecordings.length === 0) {
      return { items: [], count: 0 };
    }

    const ids = myRecordings.map((r) => r.id);
    const titleById = new Map(
      myRecordings.map((r) => [r.id, r.title] as const),
    );

    const cutoff = new Date(
      Date.now() - args.days * 24 * 60 * 60 * 1000,
    ).toISOString();

    const [comments, reactions] = await Promise.all([
      db
        .select()
        .from(schema.recordingComments)
        .where(
          and(
            inArray(schema.recordingComments.recordingId, ids),
            gte(schema.recordingComments.createdAt, cutoff),
          ),
        )
        .orderBy(desc(schema.recordingComments.createdAt))
        .limit(args.limit),
      db
        .select()
        .from(schema.recordingReactions)
        .where(
          and(
            inArray(schema.recordingReactions.recordingId, ids),
            gte(schema.recordingReactions.createdAt, cutoff),
          ),
        )
        .orderBy(desc(schema.recordingReactions.createdAt))
        .limit(args.limit),
    ]);

    const mentionRegex = new RegExp(
      `@${me.replace(/[.+?^${}()|[\]\\]/g, "\\$&")}\\b`,
      "i",
    );

    const items = [
      ...comments
        .filter((c) => c.authorEmail !== me)
        .map((c) => ({
          id: `c:${c.id}`,
          kind: (mentionRegex.test(c.content) ? "mention" : "comment") as
            | "mention"
            | "comment",
          recordingId: c.recordingId,
          recordingTitle: titleById.get(c.recordingId) ?? "Untitled",
          authorEmail: c.authorEmail,
          preview: c.content,
          createdAt: c.createdAt,
        })),
      ...reactions
        .filter((r) => r.viewerEmail !== me)
        .map((r) => ({
          id: `r:${r.id}`,
          kind: "reaction" as const,
          recordingId: r.recordingId,
          recordingTitle: titleById.get(r.recordingId) ?? "Untitled",
          authorEmail: r.viewerEmail,
          preview: `Reacted with ${r.emoji}`,
          createdAt: r.createdAt,
        })),
    ].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

    return { items, count: items.length };
  },
});
