import {
  defineEventHandler,
  getQuery,
  sendRedirect,
  setResponseStatus,
} from "h3";

import { runApiHandlerWithContext } from "../../lib/credentials";
import { resolveSessionReplayLink } from "../../lib/session-replay.js";

function queryString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Array.isArray(value) && typeof value[0] === "string" && value[0].trim()) {
    return value[0].trim();
  }
  return null;
}

export default defineEventHandler(async (event) => {
  return runApiHandlerWithContext(event, async (ctx) => {
    const query = getQuery(event);
    const sessionId = queryString(query.sessionId);
    const clientRecordingId = queryString(
      query.clientRecordingId ?? query.replayId,
    );
    if (!sessionId || !clientRecordingId) {
      setResponseStatus(event, 400);
      return {
        error: "sessionId and replayId are required",
      };
    }

    const resolution = await resolveSessionReplayLink(
      {
        sessionId,
        clientRecordingId,
        at: queryString(query.at),
      },
      { userEmail: ctx.userEmail, orgId: ctx.orgId ?? null },
    );
    if (!resolution) {
      setResponseStatus(event, 404);
      return { error: "Session recording not found" };
    }
    return sendRedirect(event, resolution.path, 302);
  });
});
