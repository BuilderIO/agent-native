/**
 * An error raised for the caller carries a numeric statusCode and a message
 * written to be returned. Any other error is unexpected, and its message can
 * quote internal database details, so it is logged and the caller gets a
 * generic reply.
 */
export function requestError(
  message: string,
  statusCode: number,
): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode });
}

export function parseJsonBody(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw requestError("Request body is not valid JSON", 400);
  }
}

export function errorReply(
  error: unknown,
  logPrefix: string,
): { statusCode: number; error: string } {
  const statusCode = (error as { statusCode?: unknown } | null)?.statusCode;
  if (error instanceof Error && typeof statusCode === "number") {
    return { statusCode, error: error.message };
  }
  console.error(`${logPrefix} Unexpected request failure:`, error);
  return { statusCode: 500, error: "Internal server error" };
}
