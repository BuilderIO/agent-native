import { asc, count, eq } from "drizzle-orm";
import {
  defineEventHandler,
  getQuery,
  setResponseStatus,
  type H3Event,
} from "h3";

import {
  originalToEdited,
  parseEdits,
} from "../../../app/lib/timestamp-mapping.js";
import { canReadRecordingComments } from "../../../shared/comment-access.js";
import { getDb, schema } from "../../db/index.js";
import {
  EDITED_TIMELINE_UNAVAILABLE,
  editedTimelineState,
} from "../../lib/agent-edited-timeline.js";
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
  const timelineState = editedTimelineState(recording.editsJson);
  if (timelineState === "invalid") {
    setResponseStatus(event, 409);
    return EDITED_TIMELINE_UNAVAILABLE;
  }
  const edited = timelineState === "edited";
  const commentsReadable = canReadRecordingComments({
    enableComments: recording.enableComments,
    viewerIsOwner: accessResult.access.viewerIsOwner,
  });
  const db = getDb();
  const historyQueryLimit = MAX_PUBLIC_AGENT_HISTORY_ITEMS + 1;
  let transcriptResult: Awaited<ReturnType<typeof loadAgentTranscript>>;
  let transcriptUnavailable = false;
  try {
    transcriptResult = await loadAgentTranscript(
      recording.id,
      recording.durationMs,
      recording.editsJson,
    );
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "EDITED_TRANSCRIPT_UNAVAILABLE"
    ) {
      transcriptUnavailable = true;
      transcriptResult = { transcript: null, segments: [], agentSegments: [] };
    } else {
      throw error;
    }
  }
  const [
    commentRows,
    reactionRows,
    commentCountRows,
    reactionCountRows,
    ctas,
    browserDiagnostics,
    bugReport,
  ] = await Promise.all([
    commentsReadable && !edited
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
          .where(eq(schema.recordingComments.recordingId, recording.id))
          .orderBy(
            asc(schema.recordingComments.videoTimestampMs),
            asc(schema.recordingComments.createdAt),
          )
          .limit(historyQueryLimit)
      : Promise.resolve([]),
    recording.enableReactions && !edited
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
    commentsReadable && !edited
      ? db
          .select({ count: count() })
          .from(schema.recordingComments)
          .where(eq(schema.recordingComments.recordingId, recording.id))
      : Promise.resolve([{ count: 0 }]),
    recording.enableReactions && !edited
      ? db
          .select({ count: count() })
          .from(schema.recordingReactions)
          .where(eq(schema.recordingReactions.recordingId, recording.id))
      : Promise.resolve([{ count: 0 }]),
    edited ? Promise.resolve([]) : loadAgentCtas(recording.id),
    edited ? Promise.resolve(null) : loadAgentBrowserDiagnostics(recording.id),
    edited ? Promise.resolve(null) : loadAgentBugReport(recording.id),
  ]);
  const { transcript, agentSegments } = transcriptResult;
  const chapters = edited ? [] : parseAgentChapters(recording);
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

  const context = buildPublicAgentContext({
    event,
    access: edited
      ? {
          ...accessResult.access,
          recording: {
            ...recording,
            durationMs: originalToEdited(
              recording.durationMs,
              parseEdits(recording.editsJson),
            ),
            thumbnailUrl: null,
            animatedThumbnailUrl: null,
            description: "",
          },
        }
      : accessResult.access,
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
  if (!edited) return context;
  return {
    ...context,
    ...(transcriptUnavailable
      ? {
          transcript: {
            status: "unavailable",
            failureReason:
              "Transcript timing overlaps an edit and cannot safely identify retained speech.",
            segments: [],
            segmentCount: 0,
          },
        }
      : {}),
    editedTimelineOmissions: [
      "chapters",
      "comments",
      "reactions",
      "browserDiagnostics",
      "appActivity",
      "thumbnail",
      "description",
      "bugReport",
      "ctas",
    ],
    instructions: [
      ...context.instructions.filter(
        (instruction) =>
          !transcriptUnavailable || !/transcript/i.test(instruction),
      ),
      "Some source-clock context is unavailable for the edited timeline; see editedTimelineOmissions.",
      ...(transcriptUnavailable
        ? [
            "Transcript is unavailable for this edited clip. Use the frame API with playback timestamps to inspect retained video.",
          ]
        : []),
    ],
  };
});
