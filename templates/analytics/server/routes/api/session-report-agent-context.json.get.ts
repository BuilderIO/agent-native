import {
  AGENT_ACCESS_PARAM,
  getForwardedRequestOrigin,
} from "@agent-native/core/server";
import {
  defineEventHandler,
  getQuery,
  setResponseHeader,
  setResponseStatus,
} from "h3";

import { buildSessionReportAgentContext } from "../../lib/session-reports.js";

function queryString(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return "";
}

export default defineEventHandler(async (event) => {
  setResponseHeader(event, "Content-Type", "application/json; charset=utf-8");
  setResponseHeader(event, "X-Content-Type-Options", "nosniff");
  setResponseHeader(event, "Referrer-Policy", "no-referrer");
  setResponseHeader(event, "Cache-Control", "private, max-age=0, no-store");
  const query = getQuery(event);
  const id = queryString(query.id);
  const token = queryString(query[AGENT_ACCESS_PARAM]);
  if (!id || !token) {
    setResponseStatus(event, 400);
    return {
      error: `id and ${AGENT_ACCESS_PARAM} are required. Ask the report's owner for its link from Share > Send to > Copy agent link.`,
    };
  }

  try {
    return await buildSessionReportAgentContext({
      reportId: id,
      token,
      origin: getForwardedRequestOrigin(event),
    });
  } catch (error) {
    const statusCode = (error as { statusCode?: unknown }).statusCode;
    if (typeof statusCode === "number" && statusCode < 500) {
      setResponseStatus(event, statusCode);
      return {
        error: (error as Error).message,
        nextStep:
          "Ask someone who can open the report for a new link from Share > Send to > Copy agent link.",
      };
    }
    console.error("[session-report-agent-context]", error);
    setResponseStatus(event, 500);
    return { error: "Couldn't read this report. Try the link again." };
  }
});
