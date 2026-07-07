import {
  defineEventHandler,
  getQuery,
  setResponseHeader,
  setResponseStatus,
} from "h3";

import {
  SESSION_REPLAY_AGENT_ACCESS_PARAM,
  verifySessionReplayAgentAccess,
} from "../../../lib/session-replay-agent-context.js";
import {
  getSessionReplayTokenizedEvents,
  type SessionReplayEventReadOptions,
} from "../../../lib/session-replay.js";

function queryString(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return "";
}

function queryInt(value: unknown): number | undefined {
  const raw = queryString(value);
  if (!raw || !/^\d+$/.test(raw)) return undefined;
  return Number(raw);
}

function applyAgentJsonHeaders(event: any) {
  setResponseHeader(event, "Content-Type", "application/json; charset=utf-8");
  setResponseHeader(event, "X-Content-Type-Options", "nosniff");
  setResponseHeader(event, "Referrer-Policy", "no-referrer");
  setResponseHeader(event, "Cache-Control", "private, max-age=0, no-store");
}

export default defineEventHandler(async (event) => {
  applyAgentJsonHeaders(event);
  const query = getQuery(event);
  const id = queryString(query.id);
  const token = queryString(query[SESSION_REPLAY_AGENT_ACCESS_PARAM]);

  if (!id || !token) {
    setResponseStatus(event, 400);
    return { error: "id and agent access token are required" };
  }
  if (!verifySessionReplayAgentAccess(id, token)) {
    setResponseStatus(event, 401);
    return { error: "Invalid or expired agent access" };
  }

  const options: SessionReplayEventReadOptions = {
    startSeq: queryInt(query.startSeq),
    endSeq: queryInt(query.endSeq),
    limit: queryInt(query.limit),
  };

  try {
    return await getSessionReplayTokenizedEvents(id, options);
  } catch (error: any) {
    setResponseStatus(event, error?.statusCode ?? 400);
    return { error: error?.message || String(error) };
  }
});
