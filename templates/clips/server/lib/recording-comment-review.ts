import { sql, type DbExec } from "@agent-native/core/db";
import {
  type ReviewableResourceRegistration,
  type ReviewCommentWriteEvent,
  type ReviewResourceAccess,
  type ReviewResourceContext,
} from "@agent-native/core/review";
import {
  ForbiddenError,
  resolveAccess,
  roleSatisfies,
  type AccessContext,
} from "@agent-native/core/sharing";
import { z } from "zod";

import { sendRecordingCommentEmails } from "./activity-notifications.js";
import { commentAccessRefusal } from "./comment-access.js";
import {
  isCommentDelete,
  RECORDING_REVIEW_RESOURCE,
  VIDEO_TIME_ANCHOR,
} from "./recording-comments.js";

const videoTimeAnchorSchema = z
  .object({ videoTimestampMs: z.number().int().min(0) })
  .strict();

function accessContextFrom(
  ctx: ReviewResourceContext | undefined,
): AccessContext | undefined {
  if (!ctx) return undefined;
  const transaction = ctx.transaction as AccessContext["transaction"];
  return {
    ...(ctx.userEmail ? { userEmail: ctx.userEmail } : {}),
    ...(ctx.orgId ? { orgId: ctx.orgId } : {}),
    ...(transaction ? { transaction } : {}),
  };
}

export async function resolveRecordingCommentAccess(
  recordingId: string,
  ctx?: ReviewResourceContext,
): Promise<ReviewResourceAccess | null> {
  const access = await resolveAccess(
    RECORDING_REVIEW_RESOURCE,
    recordingId,
    accessContextFrom(ctx),
  );
  if (!access) return null;
  const requestHeaders =
    ctx?.requestHeaders instanceof Headers ? ctx.requestHeaders : undefined;
  const operation = isCommentDelete(ctx) ? "delete" : "read";
  if (commentAccessRefusal(recordingId, access, operation, requestHeaders)) {
    return null;
  }
  return {
    role: access.role,
    ownerEmail: access.resource.ownerEmail ?? null,
    orgId: access.resource.orgId ?? null,
    visibility: access.resource.visibility,
    resource: access.resource,
  };
}

function eventRecordingId(event: ReviewCommentWriteEvent): string {
  return "comment" in event ? event.comment.resourceId : event.resourceId;
}

async function assertMayResolve(
  recordingId: string,
  threadId: string,
  actorEmail: string | null,
  tx: DbExec,
): Promise<void> {
  const actor = actorEmail?.trim().toLowerCase();
  if (actor) {
    const { rows } = await tx.execute(sql`SELECT author_email
        FROM agent_review_comments
       WHERE resource_type = ${sql.value(RECORDING_REVIEW_RESOURCE)}
         AND resource_id = ${sql.value(recordingId)}
         AND thread_id = ${sql.value(threadId)}
         AND parent_comment_id IS NULL`);
    if (
      rows.some(
        (row) =>
          String(row.author_email ?? "")
            .trim()
            .toLowerCase() === actor,
      )
    ) {
      return;
    }
    const access = await resolveAccess(RECORDING_REVIEW_RESOURCE, recordingId, {
      userEmail: actor,
      transaction: tx,
    });
    if (access && roleSatisfies(access.role, "editor")) return;
  }
  throw new ForbiddenError(
    "Only the comment author or a recording editor can resolve this comment.",
  );
}

const OLD_COPIES_DELETED_PER_STATEMENT = 1_000;

export async function guardRecordingCommentWrite(
  event: ReviewCommentWriteEvent,
  tx: DbExec,
): Promise<void> {
  if (event.type === "deleted") {
    for (
      let start = 0;
      start < event.commentIds.length;
      start += OLD_COPIES_DELETED_PER_STATEMENT
    ) {
      const ids = event.commentIds.slice(
        start,
        start + OLD_COPIES_DELETED_PER_STATEMENT,
      );
      // guard:allow-unscoped — the kit checked the deleter's access before its write hook runs; this empties those comments' copies from before the switch, keeping a key so its resend is still refused.
      await tx.execute(sql`UPDATE recording_comments
          SET content = '', mentions_json = NULL, emoji_reactions_json = '{}'
          WHERE recording_id = ${sql.value(event.resourceId)}
            AND id IN ${sql.in(ids)}
            AND idempotency_key IS NOT NULL`);
      // guard:allow-unscoped — the kit checked the deleter's access before its write hook runs; this removes those comments' copies from before the switch that hold no key.
      await tx.execute(sql`DELETE FROM recording_comments
          WHERE recording_id = ${sql.value(event.resourceId)}
            AND id IN ${sql.in(ids)}
            AND idempotency_key IS NULL`);
    }
    return;
  }
  if (event.type === "anchor-moved") {
    throw new ForbiddenError(
      "A Clips comment stays at the video time it was written at.",
    );
  }
  const recordingId = eventRecordingId(event);
  // guard:allow-unscoped — the kit checked the writer's access before its write hook runs; this reads only whether comments are on.
  const read = sql`SELECT enable_comments
      FROM recordings
     WHERE id = ${sql.value(recordingId)}`;
  const { rows } = await tx.execute(
    event.type === "created" ? sql`${read} FOR KEY SHARE` : read,
  );
  if (!rows[0]?.enable_comments) {
    throw new ForbiddenError("Comments are turned off for this recording.");
  }
  if (event.type === "resolved" || event.type === "reopened") {
    await assertMayResolve(recordingId, event.threadId, event.actorEmail, tx);
  }
}

export const recordingReviewResource: ReviewableResourceRegistration = {
  type: RECORDING_REVIEW_RESOURCE,
  displayName: "Recording",
  anchorKinds: {
    [VIDEO_TIME_ANCHOR]: {
      version: 1,
      parse: (anchor) => videoTimeAnchorSchema.parse(anchor),
    },
  },
  comments: {
    minimumRole: "viewer",
    unmentionedRoute: "human",
    resolveRole: "viewer",
  },
  email: { send: sendRecordingCommentEmails },
  resolveAccess: resolveRecordingCommentAccess,
  onCommentWrite: guardRecordingCommentWrite,
};
