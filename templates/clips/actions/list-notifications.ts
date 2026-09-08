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

import { defineAction } from "@agent-native/core/action";
import { accessFilter } from "@agent-native/core/sharing";
import { getUserProfiles } from "@agent-native/core/user-profile/server";
import { and, desc, gte, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { canReceiveRecordingActivity } from "../server/lib/recording-page-access.js";
import {
  getCurrentOwnerEmail,
  sameOwnerEmail,
} from "../server/lib/recordings.js";
import { profileNameFor } from "../server/lib/user-identities.js";
import { parseCommentMentions } from "../shared/comment-mentions.js";

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

    // Activity on recordings I own plus mentions on recordings I can open.
    const visibleRecordings = await db
      .select({
        id: schema.recordings.id,
        title: schema.recordings.title,
        ownerEmail: schema.recordings.ownerEmail,
        password: schema.recordings.password,
        expiresAt: schema.recordings.expiresAt,
      })
      .from(schema.recordings)
      .where(accessFilter(schema.recordings, schema.recordingShares));
    const accessibleRecordings = visibleRecordings.filter((recording) =>
      canReceiveRecordingActivity({
        ownerEmail: recording.ownerEmail,
        recipientEmail: me,
        hasPassword: Boolean(recording.password),
        expiresAt: recording.expiresAt,
      }),
    );
    if (accessibleRecordings.length === 0) {
      return { items: [], count: 0 };
    }

    const myRecordingIds = accessibleRecordings
      .filter((recording) => sameOwnerEmail(recording.ownerEmail, me))
      .map((recording) => recording.id);
    const myRecordingIdSet = new Set(myRecordingIds);
    const ids = accessibleRecordings.map((recording) => recording.id);
    const titleById = new Map(
      accessibleRecordings.map(
        (recording) => [recording.id, recording.title] as const,
      ),
    );

    const cutoff = new Date(
      Date.now() - args.days * 24 * 60 * 60 * 1000,
    ).toISOString();

    const mentionPattern = `%"email":"${me.toLowerCase()}"%`;
    const commentScope = myRecordingIds.length
      ? or(
          inArray(schema.recordingComments.recordingId, myRecordingIds),
          sql`lower(${schema.recordingComments.mentionsJson}) LIKE ${mentionPattern}`,
        )
      : sql`lower(${schema.recordingComments.mentionsJson}) LIKE ${mentionPattern}`;

    const [comments, reactions] = await Promise.all([
      db
        .select()
        .from(schema.recordingComments)
        .where(
          and(
            inArray(schema.recordingComments.recordingId, ids),
            gte(schema.recordingComments.createdAt, cutoff),
            commentScope,
          ),
        )
        .orderBy(desc(schema.recordingComments.createdAt))
        .limit(args.limit),
      myRecordingIds.length
        ? db
            .select()
            .from(schema.recordingReactions)
            .where(
              and(
                inArray(schema.recordingReactions.recordingId, myRecordingIds),
                gte(schema.recordingReactions.createdAt, cutoff),
              ),
            )
            .orderBy(desc(schema.recordingReactions.createdAt))
            .limit(args.limit)
        : Promise.resolve([]),
    ]);

    const commentRows = comments.filter(
      (comment) =>
        !sameOwnerEmail(comment.authorEmail, me) &&
        (myRecordingIdSet.has(comment.recordingId) ||
          parseCommentMentions(comment.mentionsJson).some(
            (mention) => mention.email === me.toLowerCase(),
          )),
    );
    const reactionRows = reactions.filter(
      (r) => !sameOwnerEmail(r.viewerEmail, me),
    );
    const profiles = await getUserProfiles([
      ...commentRows.map((c) => c.authorEmail),
      ...reactionRows.flatMap((r) => (r.viewerEmail ? [r.viewerEmail] : [])),
    ]);

    const items = [
      ...commentRows.map((c) => ({
        id: `c:${c.id}`,
        kind: (parseCommentMentions(c.mentionsJson).some(
          (mention) => mention.email === me.toLowerCase(),
        )
          ? "mention"
          : "comment") as "mention" | "comment",
        recordingId: c.recordingId,
        recordingTitle: titleById.get(c.recordingId) ?? "Untitled",
        authorEmail: c.authorEmail,
        authorName: profileNameFor(c.authorEmail, c.authorName, profiles),
        preview: c.content,
        createdAt: c.createdAt,
      })),
      ...reactionRows.map((r) => ({
        id: `r:${r.id}`,
        kind: "reaction" as const,
        recordingId: r.recordingId,
        recordingTitle: titleById.get(r.recordingId) ?? "Untitled",
        authorEmail: r.viewerEmail,
        authorName: r.viewerEmail
          ? profileNameFor(r.viewerEmail, r.viewerName, profiles)
          : null,
        preview: `Reacted with ${r.emoji}`,
        createdAt: r.createdAt,
      })),
    ].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

    return { items, count: items.length };
  },
});
