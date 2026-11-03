import { getSession } from "@agent-native/core/server";
import {
  defineEventHandler,
  getQuery,
  setResponseStatus,
  type H3Event,
} from "h3";

import {
  diagnosticReadSchema,
  DIAGNOSTIC_ACCESS_PARAM,
} from "../../../shared/diagnostic-context.js";
import {
  resolveRecordingDiagnosticAccess,
  readDiagnosticContext,
} from "../../lib/diagnostic-context.js";
import {
  applyAgentJsonHeaders,
  queryString,
} from "../../lib/public-agent-context.js";

export default defineEventHandler(async (event: H3Event) => {
  applyAgentJsonHeaders(event);
  const query = getQuery(event);
  const numeric = (key: string) =>
    queryString(query[key]) ? Number(queryString(query[key])) : undefined;
  const parsed = diagnosticReadSchema.safeParse({
    contextId: queryString(query.contextId) || undefined,
    recordingId: queryString(query.id) || undefined,
    diagnosticAccess: queryString(query[DIAGNOSTIC_ACCESS_PARAM]) || undefined,
    fromMs: numeric("fromMs"),
    toMs: numeric("toMs"),
    start: numeric("start"),
    maxEvents: numeric("maxEvents"),
    scopes: queryString(query.scopes)
      ? queryString(query.scopes).split(",")
      : undefined,
  });
  if (!parsed.success) {
    setResponseStatus(event, 400);
    return { failureKind: "request", error: "Invalid diagnostic request." };
  }
  const session = parsed.data.diagnosticAccess ? null : await getSession(event);
  if (!parsed.data.diagnosticAccess && !session) {
    setResponseStatus(event, 403);
    return {
      failureKind: "access",
      error: "Independent diagnostic authorization is required.",
    };
  }
  try {
    const access = await resolveRecordingDiagnosticAccess({
      ...parsed.data,
      userEmail: session?.email,
      orgId: session?.orgId,
    });
    return {
      type: "agent-native.clip.diagnostic-context",
      ...(await readDiagnosticContext(access, parsed.data)),
    };
  } catch (error) {
    const failure = error as {
      statusCode?: number;
      data?: { errorCode?: string };
      errorCode?: string;
      message?: string;
    };
    const status = failure.statusCode ?? 500;
    setResponseStatus(event, status);
    return {
      failureKind: status === 503 ? "storage" : "access",
      error:
        status < 500 ? failure.message : "Diagnostic context is unavailable.",
    };
  }
});
