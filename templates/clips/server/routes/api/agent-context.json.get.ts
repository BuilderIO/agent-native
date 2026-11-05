import { and, asc, count, eq, gte, lt, or, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  defineEventHandler,
  getQuery,
  setResponseStatus,
  type H3Event,
} from "h3";

import {
  getExcludedRanges,
  parseEdits,
} from "../../../app/lib/timestamp-mapping.js";
import { canReadRecordingComments } from "../../../shared/comment-access.js";
import { getDb, schema } from "../../db/index.js";
import {
  applyAgentJsonHeaders,
  buildPublicAgentContext,
  canReadAppActivityEvents,
  describeAgentAccessFailure,
  loadAgentBugReport,
  loadAgentBrowserDiagnostics,
  loadAgentCtas,
  loadAgentTranscript,
  loadPublicAgentAccess,
  MAX_PUBLIC_AGENT_HISTORY_ITEMS,
  parseAgentChapters,
  queryString,
  CLIPS_AGENT_ACCESS_PARAM,
} from "../../lib/public-agent-context.js";
import { hydrateCommentAuthorNames } from "../../lib/user-identities.js";

export default defineEventHandler(async (event: H3Event) => {
  applyAgentJsonHeaders(event);

  const query = getQuery(event);
  const id = queryString(query.id);
  const accessResult = await loadPublicAgentAccess(event, id, {
    password: queryString(query.password),
    token: queryString(query[CLIPS_AGENT_ACCESS_PARAM]),
  });

  if (!accessResult.ok) {
    const failure = describeAgentAccessFailure(accessResult.failure);
    setResponseStatus(event, failure.status);
    return failure.body;
  }

  const recording = accessResult.access.recording;
  const commentsReadable = canReadRecordingComments({
    enableComments: recording.enableComments,
    viewerIsOwner: accessResult.access.viewerIsOwner,
  });
  const db = getDb();
  const historyQueryLimit = MAX_PUBLIC_AGENT_HISTORY_ITEMS + 1;
  // Owner-cut footage is excluded before the history cap, so removed rows
  // cannot crowd out visible ones.
  const excludedRanges = getExcludedRanges(parseEdits(recording.editsJson));
  const outsideCuts = (timestamp: AnyPgColumn) =>
    excludedRanges.map(
      (range): SQL =>
        or(lt(timestamp, range.startMs), gte(timestamp, range.endMs)) as SQL,
    );
  const commentScope = excludedRanges.length
    ? and(
        eq(schema.recordingComments.recordingId, recording.id),
        ...outsideCuts(schema.recordingComments.videoTimestampMs),
      )
    : eq(schema.recordingComments.recordingId, recording.id);
  const reactionScope = excludedRanges.length
    ? and(
        eq(schema.recordingReactions.recordingId, recording.id),
        ...outsideCuts(schema.recordingReactions.videoTimestampMs),
      )
    : eq(schema.recordingReactions.recordingId, recording.id);
  const [
    { transcript, agentSegments },
    commentRows,
    reactionRows,
    commentCountRows,
    reactionCountRows,
    ctas,
    browserDiagnostics,
    bugReport,
  ] = await Promise.all([
    loadAgentTranscript(recording.id, recording.durationMs),
    commentsReadable
      ? db
          .select({
            id: schema.recordingComments.id,
            recordingId: schema.recordingComments.recordingId,
            threadId: schema.recordingComments.threadId,
            parentId: schema.recordingComments.parentId,
            authorEmail: schema.recordingComments.authorEmail,
            authorName: schema.recordingComments.authorName,
            content: schema.recordingComments.content,
            videoTimestampMs: schema.recordingComments.videoTimestampMs,
            resolved: schema.recordingComments.resolved,
            createdAt: schema.recordingComments.createdAt,
            updatedAt: schema.recordingComments.updatedAt,
          })
          .from(schema.recordingComments)
          .where(commentScope)
          .orderBy(
            asc(schema.recordingComments.videoTimestampMs),
            asc(schema.recordingComments.createdAt),
          )
          .limit(historyQueryLimit)
      : Promise.resolve([]),
    recording.enableReactions
      ? db
          .select({
            id: schema.recordingReactions.id,
            emoji: schema.recordingReactions.emoji,
            videoTimestampMs: schema.recordingReactions.videoTimestampMs,
            viewerName: schema.recordingReactions.viewerName,
            createdAt: schema.recordingReactions.createdAt,
          })
          .from(schema.recordingReactions)
          .where(reactionScope)
          .orderBy(asc(schema.recordingReactions.createdAt))
          .limit(historyQueryLimit)
      : Promise.resolve([]),
    commentsReadable
      ? db
          .select({ count: count() })
          .from(schema.recordingComments)
          .where(commentScope)
      : Promise.resolve([{ count: 0 }]),
    recording.enableReactions
      ? db
          .select({ count: count() })
          .from(schema.recordingReactions)
          .where(reactionScope)
      : Promise.resolve([{ count: 0 }]),
    loadAgentCtas(recording.id),
    loadAgentBrowserDiagnostics(recording.id),
    loadAgentBugReport(recording.id),
  ]);
  const chapters = parseAgentChapters(recording);
  const comments = (await hydrateCommentAuthorNames(commentRows)).slice(
    0,
    MAX_PUBLIC_AGENT_HISTORY_ITEMS,
  );
  const reactions = reactionRows.slice(0, MAX_PUBLIC_AGENT_HISTORY_ITEMS);
  const commentCount = Number(commentCountRows[0]?.count ?? comments.length);
  const reactionCount = Number(reactionCountRows[0]?.count ?? reactions.length);

  const appActivityEventsReadable = await canReadAppActivityEvents(
    accessResult.access,
  );

  return buildPublicAgentContext({
    event,
    access: accessResult.access,
    transcript,
    agentSegments,
    chapters,
    comments,
    reactions,
    commentCount,
    commentsTruncated:
      commentRows.length > MAX_PUBLIC_AGENT_HISTORY_ITEMS ||
      commentCount > comments.length,
    reactionCount,
    reactionsTruncated:
      reactionRows.length > MAX_PUBLIC_AGENT_HISTORY_ITEMS ||
      reactionCount > reactions.length,
    ctas,
    browserDiagnostics,
    bugReport,
    appActivityEventsReadable,
  });
});
