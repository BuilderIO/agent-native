/**
 * GET /api/agent-context.json?id=<recordingId>[&password=<pw>|&t=<token>]
 *
 * Public, AI-readable context for a shared clip. This follows the same
 * visibility/password/expiry rules as `/api/public-recording`, but returns a
 * smaller agent-oriented shape plus discoverable transcript/frame APIs.
 */

import { asc, eq } from "drizzle-orm";
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
  const [
    { transcript, agentSegments },
    comments,
    reactions,
    ctas,
    browserDiagnostics,
    bugReport,
  ] = await Promise.all([
    loadAgentTranscript(recording.id, recording.durationMs),
    recording.enableComments
      ? db
          .select()
          .from(schema.recordingComments)
          .where(eq(schema.recordingComments.recordingId, recording.id))
          .orderBy(
            asc(schema.recordingComments.videoTimestampMs),
            asc(schema.recordingComments.createdAt),
          )
      : Promise.resolve([]),
    recording.enableReactions
      ? db
          .select()
          .from(schema.recordingReactions)
          .where(eq(schema.recordingReactions.recordingId, recording.id))
          .orderBy(asc(schema.recordingReactions.createdAt))
      : Promise.resolve([]),
    loadAgentCtas(recording.id),
    loadAgentBrowserDiagnostics(recording.id),
    loadAgentBugReport(recording.id),
  ]);
  const chapters = parseAgentChapters(recording);

  return buildPublicAgentContext({
    event,
    access: accessResult.access,
    transcript,
    agentSegments,
    chapters,
    comments,
    reactions,
    ctas,
    browserDiagnostics,
    bugReport,
  });
});
