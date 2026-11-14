import { createError, type H3Event } from "h3";

import { redact, redactErrorStack } from "../tracking/redaction.js";
import { captureError } from "./capture-error.js";
import { getHttpRequestTelemetryId } from "./http-response-telemetry.js";

// Also read by templates that answer their own 503, so the key stays stable.
const CONTEXT_KEY = "__anSessionResolutionError";

export const SESSION_UNAVAILABLE_ERROR_CODE = "session_unavailable";
export const SESSION_UNAVAILABLE_MESSAGE =
  "Your session could not be verified. Retry shortly.";

interface SessionResolutionFailure {
  source: string;
  error: unknown;
  reported: boolean;
}

function contextOf(event: H3Event): Record<string, unknown> {
  const holder = event as { context?: Record<string, unknown> };
  return (holder.context ??= {});
}

/**
 * Records that this request presented a session credential the server could
 * not check (the lookup threw). Such a request has no session, but it is not
 * signed out: answer a retryable 503, never a 401 that reads as "sign in
 * again". The first failure is kept; later ones are usually its echo.
 */
export function markSessionResolutionUnavailable(
  event: H3Event,
  source: string,
  error: unknown,
): void {
  const context = contextOf(event);
  if (context[CONTEXT_KEY]) return;
  context[CONTEXT_KEY] = {
    source,
    error,
    reported: false,
  } satisfies SessionResolutionFailure;
}

export function isSessionResolutionUnavailable(event: H3Event): boolean {
  return Boolean(
    (event.context as Record<string, unknown> | undefined)?.[CONTEXT_KEY],
  );
}

/**
 * Sends the lookup's real cause to the error tracker and the server log with
 * the request id the client also holds, once per request. Called where a null
 * session is handed to a consumer, so a lookup that a fallback path recovered
 * from is not reported.
 */
export function reportSessionResolutionUnavailable(event: H3Event): void {
  const failure = (event.context as Record<string, unknown> | undefined)?.[
    CONTEXT_KEY
  ] as SessionResolutionFailure | true | undefined;
  if (!failure || failure === true || failure.reported) return;
  failure.reported = true;
  const requestId = getHttpRequestTelemetryId(event);
  const captureId = captureError(failure.error, {
    route: "auth.session-resolution",
    tags: { auth: "session-resolution", source: failure.source },
    ...(requestId ? { extra: { request_id: requestId } } : {}),
  });
  console.error("[auth] session unavailable, request refused with 503:", {
    source: failure.source,
    ...(requestId ? { requestId } : {}),
    ...(captureId ? { captureId } : {}),
    error: redactErrorStack(failure.error) ?? redact(String(failure.error)),
  });
}

export function sessionResolutionUnavailableError() {
  // `expected` + `errorCode` make the action route return this as a typed
  // answer instead of folding every 5xx into "Internal server error".
  return Object.assign(
    createError({
      statusCode: 503,
      statusMessage: "Service Unavailable",
      message: SESSION_UNAVAILABLE_MESSAGE,
      headers: { "Retry-After": "5" },
    }),
    { errorCode: SESSION_UNAVAILABLE_ERROR_CODE, expected: true },
  );
}
