/**
 * GET /api/agent-context.json?id=<recordingId>[&password=<pw>|&t=<token>]
 *
 * Public, AI-readable context for a shared clip. This follows the same
 * visibility/password/expiry rules as `/api/public-recording`, but returns a
 * smaller agent-oriented shape plus discoverable transcript/frame APIs.
 */

import { asc, count, eq } from "drizzle-orm";
import {
  defineEventHandler,
  getQuery,
  setResponseStatus,
  type H3Event,
} from "h3";

import { getDb, schema } from "../../db/index.js";
import {
  applyAgentJsonHeaders,
  buildPublicAgentContext,
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

export default defineEventHandler(async (event: H3Event) => {
  applyAgentJsonHeaders(event);

  const query = getQuery(event);
  const id = queryString(query.id);
  const accessResult = await loadPublicAgentAccess(event, id, {
    password: queryString(query.password),
    token: queryString(query[CLIPS_AGENT_ACCESS_PARAM]) || queryString(query.t),
  });

  if (!accessResult.ok) {
    setResponseStatus(event, accessResult.failure.status);
    return accessResult.failure.body;
  }

  const recording = accessResult.access.recording;
  const db = getDb();
  const historyQueryLimit = MAX_PUBLIC_AGENT_HISTORY_ITEMS + 1;
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
    recording.enableComments
      ? db
          .select({
            id: schema.recordingComments.id,
            recordingId: schema.recordingComments.recordingId,
            threadId: schema.recordingComments.threadId,
            parentId: schema.recordingComments.parentId,
            authorName: schema.recordingComments.authorName,
            content: schema.recordingComments.content,
            videoTimestampMs: schema.recordingComments.videoTimestampMs,
            resolved: schema.recordingComments.resolved,
            createdAt: schema.recordingComments.createdAt,
            updatedAt: schema.recordingComments.updatedAt,
          })
          .from(schema.recordingComments)
          .where(eq(schema.recordingComments.recordingId, recording.id))
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
          .where(eq(schema.recordingReactions.recordingId, recording.id))
          .orderBy(asc(schema.recordingReactions.createdAt))
          .limit(historyQueryLimit)
      : Promise.resolve([]),
    recording.enableComments
      ? db
          .select({ count: count() })
          .from(schema.recordingComments)
          .where(eq(schema.recordingComments.recordingId, recording.id))
      : Promise.resolve([{ count: 0 }]),
    recording.enableReactions
      ? db
          .select({ count: count() })
          .from(schema.recordingReactions)
          .where(eq(schema.recordingReactions.recordingId, recording.id))
      : Promise.resolve([{ count: 0 }]),
    loadAgentCtas(recording.id),
    loadAgentBrowserDiagnostics(recording.id),
    loadAgentBugReport(recording.id),
  ]);
  const chapters = parseAgentChapters(recording);
  const comments = commentRows.slice(0, MAX_PUBLIC_AGENT_HISTORY_ITEMS);
  const reactions = reactionRows.slice(0, MAX_PUBLIC_AGENT_HISTORY_ITEMS);
  const commentCount = Number(commentCountRows[0]?.count ?? comments.length);
  const reactionCount = Number(reactionCountRows[0]?.count ?? reactions.length);

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
  });
});
