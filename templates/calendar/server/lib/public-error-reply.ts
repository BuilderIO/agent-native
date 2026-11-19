import { captureError } from "@agent-native/core/server";
import { isError, setResponseStatus, type H3Event } from "h3";
import { nanoid } from "nanoid";

/**
 * Reply for a failed public booking request. An h3 error was raised for the
 * caller and carries a message written to be returned. Any other error is
 * unexpected, and a database error's message quotes the failed SQL and its
 * bound values, so the caller gets a fixed message and an id that finds the
 * redacted report.
 */
export function publicErrorReply(
  event: H3Event,
  error: unknown,
  route: string,
): { error: string; errorId?: string } {
  if (isError(error)) {
    setResponseStatus(event, error.statusCode);
    return { error: error.message };
  }
  const errorId = nanoid(10);
  captureError(error, {
    route,
    tags: { source: "calendar-public-booking" },
    extra: { errorId },
  });
  setResponseStatus(event, 500);
  return { error: "Internal server error", errorId };
}
