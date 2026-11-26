import {
  deleteMirroredReviewComments,
  ensureReviewTables,
  linkMirroredReviewReplies,
  lockMirroredReviewThreads,
  mirrorReviewComments,
  type ReviewCommentCopy,
} from "@agent-native/core/review";
import { asc, eq, gt } from "drizzle-orm";

import { parseCommentMentions } from "../../shared/comment-mentions.js";
import { getDb, schema } from "../db/index.js";
import { firstRow } from "./first-row.js";
import {
  RECORDING_REVIEW_RESOURCE,
  VIDEO_TIME_ANCHOR,
} from "./recording-comments.js";

const CLIPS_COMMENT_WRITER = "human";

type RecordingCommentRow = typeof schema.recordingComments.$inferSelect;

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
  parentCommentId = row.parentId,
): ReviewCommentCopy {
  return {
    id: row.id,
    threadId: row.threadId,
    parentCommentId,
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

export async function lockRecordingCommentThreads(
  recordingId: string,
): Promise<void> {
  await lockMirroredReviewThreads({
    resourceType: RECORDING_REVIEW_RESOURCE,
    resourceId: recordingId,
  });
}

export function unlinkedReplyParents(
  rows: readonly RecordingCommentRow[],
): Map<string, string> {
  const firsts = new Map<string, RecordingCommentRow>();
  for (const row of rows) {
    const first = firsts.get(row.threadId);
    if (!first || (row.id === row.threadId && first.id !== row.threadId)) {
      firsts.set(row.threadId, row);
    }
  }
  const parents = new Map<string, string>();
  for (const row of rows) {
    const first = firsts.get(row.threadId);
    if (!row.parentId && first && first.id !== row.id) {
      parents.set(row.id, first.id);
    }
  }
  return parents;
}

export interface RecordingCommentCopyReport {
  recordings: number;
  comments: number;
  added: number;
  linked: number;
  failedRecordings: string[];
}

const RECORDING_PAGE_SIZE = 200;

export async function addMissingRecordingCommentsToReviewKit(): Promise<RecordingCommentCopyReport> {
  await prepareRecordingCommentMirror();
  const db = getDb();
  const report: RecordingCommentCopyReport = {
    recordings: 0,
    comments: 0,
    added: 0,
    linked: 0,
    failedRecordings: [],
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
  return report;
}

async function copyRecording(
  recordingId: string,
  report: RecordingCommentCopyReport,
): Promise<void> {
  try {
    const copied = await getDb().transaction(async (tx) => {
      await lockRecordingCommentThreads(recordingId);
      const recordings = await tx
        .select(RECORDING_SHARING)
        .from(schema.recordings)
        .where(eq(schema.recordings.id, recordingId))
        .for("update");
      const recording = firstRow(recordings);
      if (!recording) return null;
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
        );
      const parents = unlinkedReplyParents(rows);
      const { written } = await mirrorReviewComments(
        resource,
        rows.map((row) => recordingCommentCopy(row, parents.get(row.id))),
        { onlyMissing: true },
      );
      const { linked } = await linkMirroredReviewReplies(
        resource,
        [...parents].map(([id, parentCommentId]) => ({ id, parentCommentId })),
      );
      return { comments: rows.length, added: written, linked };
    });
    if (!copied) return;
    report.recordings += 1;
    report.comments += copied.comments;
    report.added += copied.added;
    report.linked += copied.linked;
  } catch (error) {
    report.failedRecordings.push(recordingId);
    console.error(
      `[clips] Couldn't copy recording ${recordingId}'s comments to the review kit:`,
      error instanceof Error ? error.message : error,
    );
  }
}
