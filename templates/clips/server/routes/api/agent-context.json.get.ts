/**
 * GET /api/agent-context.json?id=<recordingId>[&password=<pw>|&t=<token>]
 *
 * Public, AI-readable context for a shared clip. This follows the same
 * visibility/password/expiry rules as `/api/public-recording`, but returns a
 * smaller agent-oriented shape plus discoverable transcript/frame APIs.
 */

import {
  defineEventHandler,
  getQuery,
  setResponseStatus,
  type H3Event,
} from "h3";

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
} from "../../lib/public-agent-context.js";

export default defineEventHandler(async (event: H3Event) => {
  applyAgentJsonHeaders(event);

  const query = getQuery(event);
  const id = queryString(query.id);
  const accessResult = await loadPublicAgentAccess(event, id, {
    password: queryString(query.password),
    token: queryString(query.t),
  });

  if (!accessResult.ok) {
    setResponseStatus(event, accessResult.failure.status);
    return accessResult.failure.body;
  }

  const recording = accessResult.access.recording;
  const [{ transcript, agentSegments }, ctas, browserDiagnostics, bugReport] =
    await Promise.all([
      loadAgentTranscript(recording.id, recording.durationMs),
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
    ctas,
    browserDiagnostics,
    bugReport,
  });
});
