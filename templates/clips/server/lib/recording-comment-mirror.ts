import { getDbExec } from "@agent-native/core/db";
import {
  compareMirroredReviewComments,
  deleteMirroredReviewComments,
  deleteOrphanedMirroredReplies,
  ensureReviewTables,
  listMirroredResourceIds,
  mirrorReviewComments,
  type ReviewCommentCopy,
  type ReviewMirrorDifference,
  type ReviewMirrorResource,
} from "@agent-native/core/review";
import { and, asc, eq, gt, inArray } from "drizzle-orm";

import { parseCommentMentions } from "../../shared/comment-mentions.js";
import { getDb, schema } from "../db/index.js";
import { firstRow } from "./first-row.js";

export const RECORDING_REVIEW_RESOURCE = "recording";
export const VIDEO_TIME_ANCHOR = "video-time";
const CLIPS_COMMENT_WRITER = "human";

type RecordingCommentRow = typeof schema.recordingComments.$inferSelect;
type ClipsReader = Pick<ReturnType<typeof getDb>, "select">;

export function prepareRecordingCommentMirror(): Promise<void> {
  return ensureReviewTables();
}

function commentReactions(
  json: string,
): Array<{ actorEmail: string; reaction: string }> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json || "{}");
    // coercion-ok: react-to-comment and the player read unparseable reactions as none, so the kit's copy holds none.
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
  return Object.entries(parsed).flatMap(([reaction, actors]) =>
    Array.isArray(actors)
      ? [
          ...new Set(
            actors.filter(
              (actor): actor is string => typeof actor === "string",
            ),
          ),
        ].map((actorEmail) => ({ actorEmail, reaction }))
      : [],
  );
}

export function recordingCommentCopy(
  row: RecordingCommentRow,
): ReviewCommentCopy {
  return {
    id: row.id,
    threadId: row.threadId,
    parentCommentId: row.parentId,
    anchor: { videoTimestampMs: row.videoTimestampMs },
    anchorKind: VIDEO_TIME_ANCHOR,
    anchorVersion: 1,
    body: row.content,
    authorEmail: row.authorEmail,
    authorName: row.authorName,
    createdBy: CLIPS_COMMENT_WRITER,
    mentions: parseCommentMentions(row.mentionsJson).map(({ email, name }) => ({
      label: name,
      email,
    })),
    resolved: row.resolved,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    reactions: commentReactions(row.emojiReactionsJson),
  };
}

const RECORDING_SHARING = {
  ownerEmail: schema.recordings.ownerEmail,
  orgId: schema.recordings.orgId,
  visibility: schema.recordings.visibility,
};

async function recordingResource(
  db: ClipsReader,
  recordingId: string,
): Promise<ReviewMirrorResource | null> {
  const rows = await db
    .select(RECORDING_SHARING)
    .from(schema.recordings)
    .where(eq(schema.recordings.id, recordingId))
    .limit(1);
  const recording = firstRow(rows);
  return recording
    ? {
        resourceType: RECORDING_REVIEW_RESOURCE,
        resourceId: recordingId,
        ...recording,
      }
    : null;
}

export async function mirrorRecordingComments(
  db: ClipsReader,
  recordingId: string,
  ids: readonly string[] | "all",
): Promise<void> {
  if (ids !== "all" && ids.length === 0) return;
  const resource = await recordingResource(db, recordingId);
  if (!resource) return;
  const rows = await db
    .select()
    .from(schema.recordingComments)
    .where(
      and(
        eq(schema.recordingComments.recordingId, recordingId),
        ids === "all"
          ? undefined
          : inArray(schema.recordingComments.id, [...ids]),
      ),
    );
  await mirrorReviewComments(resource, rows.map(recordingCommentCopy));
}

export async function deleteMirroredRecordingComments(
  recordingId: string,
  ids: readonly string[] | "all",
  deletedBy?: string | null,
): Promise<void> {
  await deleteMirroredReviewComments(
    { resourceType: RECORDING_REVIEW_RESOURCE, resourceId: recordingId },
    ids,
    deletedBy,
  );
}

export interface RecordingCommentCopyReport {
  recordings: number;
  comments: number;
  replies: number;
  resolved: number;
  reactions: number;
  repliesWithoutParent: number;
  failedRecordings: string[];
  differences: Array<{ recordingId: string } & ReviewMirrorDifference>;
  kitWrittenComments: Array<{ recordingId: string; id: string }>;
  orphanedReplies: Array<{ recordingId: string; id: string }>;
}

const RECORDING_PAGE_SIZE = 200;

export async function copyRecordingCommentsToReviewKit(): Promise<RecordingCommentCopyReport> {
  await prepareRecordingCommentMirror();
  const db = getDb();
  const report: RecordingCommentCopyReport = {
    recordings: 0,
    comments: 0,
    replies: 0,
    resolved: 0,
    reactions: 0,
    repliesWithoutParent: 0,
    failedRecordings: [],
    differences: [],
    kitWrittenComments: [],
    orphanedReplies: [],
  };
  let after = "";
  for (;;) {
    // guard:allow-unscoped — the copy covers every recording with comments.
    const page = await db
      .selectDistinct({ recordingId: schema.recordingComments.recordingId })
      .from(schema.recordingComments)
      .where(gt(schema.recordingComments.recordingId, after))
      .orderBy(asc(schema.recordingComments.recordingId))
      .limit(RECORDING_PAGE_SIZE);
    for (const { recordingId } of page) {
      await copyRecording(recordingId, report);
    }
    const last = firstRow(page.slice(-1));
    if (page.length < RECORDING_PAGE_SIZE || !last) break;
    after = last.recordingId;
  }
  after = "";
  for (;;) {
    const page = await listMirroredResourceIds(RECORDING_REVIEW_RESOURCE, {
      after,
      limit: RECORDING_PAGE_SIZE,
    });
    const last = firstRow(page.slice(-1));
    if (last === undefined) break;
    // guard:allow-unscoped — the copy checks every recording the kit holds comments for.
    const copied = await db
      .selectDistinct({ recordingId: schema.recordingComments.recordingId })
      .from(schema.recordingComments)
      .where(inArray(schema.recordingComments.recordingId, page));
    const seen = new Set(copied.map((row) => row.recordingId));
    for (const recordingId of page) {
      if (!seen.has(recordingId)) await copyRecording(recordingId, report);
    }
    if (page.length < RECORDING_PAGE_SIZE) break;
    after = last;
  }
  return report;
}

async function copiedFromClips(recordingId: string): Promise<Set<string>> {
  const { rows } = await getDbExec().execute({
    sql: "SELECT id FROM agent_review_comments WHERE resource_type = ? AND resource_id = ? AND anchor_kind = ? AND created_by = ?",
    args: [
      RECORDING_REVIEW_RESOURCE,
      recordingId,
      VIDEO_TIME_ANCHOR,
      CLIPS_COMMENT_WRITER,
    ],
  });
  return new Set(rows.map((row: { id: unknown }) => String(row.id)));
}

async function copyRecording(
  recordingId: string,
  report: RecordingCommentCopyReport,
): Promise<void> {
  try {
    const copied = await getDb().transaction(async (tx) => {
      const recordings = await tx
        .select(RECORDING_SHARING)
        .from(schema.recordings)
        .where(eq(schema.recordings.id, recordingId))
        .for("update");
      const recording = firstRow(recordings);
      if (!recording) {
        await deleteMirroredRecordingComments(recordingId, "all");
        return null;
      }
      const resource = {
        resourceType: RECORDING_REVIEW_RESOURCE,
        resourceId: recordingId,
        ...recording,
      };
      const rows = await tx
        .select()
        .from(schema.recordingComments)
        .where(eq(schema.recordingComments.recordingId, recordingId))
        .orderBy(
          asc(schema.recordingComments.createdAt),
          asc(schema.recordingComments.id),
        )
        .for("update");
      const copies = rows.map(recordingCommentCopy);
      await mirrorReviewComments(resource, copies);
      const { differences } = await compareMirroredReviewComments(
        resource,
        copies,
      );
      const extra = differences
        .filter((difference) => difference.problem === "extra")
        .map((difference) => difference.id);
      const fromClips =
        extra.length === 0
          ? new Set<string>()
          : await copiedFromClips(recordingId);
      const stale = extra.filter((id) => fromClips.has(id));
      const kitOnly = extra.filter((id) => !fromClips.has(id));
      if (stale.length > 0) {
        await deleteMirroredRecordingComments(recordingId, stale);
      }
      const { deleted: orphaned } = await deleteOrphanedMirroredReplies(
        resource,
        kitOnly,
      );
      const remaining =
        stale.length === 0
          ? differences
          : (await compareMirroredReviewComments(resource, copies)).differences;
      return {
        rows,
        copies,
        kitWritten: kitOnly.filter((id) => !orphaned.includes(id)),
        orphaned,
        differences: remaining.filter(
          (difference) =>
            difference.problem !== "extra" || !kitOnly.includes(difference.id),
        ),
      };
    });
    if (!copied) return;
    report.recordings += 1;
    report.comments += copied.rows.length;
    for (const row of copied.rows) {
      if (row.parentId) report.replies += 1;
      else if (row.threadId !== row.id) report.repliesWithoutParent += 1;
      if (row.resolved) report.resolved += 1;
    }
    for (const copy of copied.copies) {
      report.reactions += copy.reactions?.length ?? 0;
    }
    for (const difference of copied.differences) {
      report.differences.push({ recordingId, ...difference });
    }
    for (const id of copied.kitWritten) {
      report.kitWrittenComments.push({ recordingId, id });
    }
    for (const id of copied.orphaned) {
      report.orphanedReplies.push({ recordingId, id });
    }
  } catch (error) {
    report.failedRecordings.push(recordingId);
    console.error(
      `[clips] Couldn't copy recording ${recordingId}'s comments to the review kit:`,
      error instanceof Error ? error.message : error,
    );
  }
}
