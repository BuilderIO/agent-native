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

const NUL = /\u0000/g;
const LONE_SURROGATE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/**
 * Postgres rejects U+0000 in text and jsonb, and a lone surrogate in jsonb;
 * stored JSON is read back with ::jsonb, and row ids encode values with
 * encodeURIComponent, which throws on a lone surrogate. One such character
 * would fail its write on every retry, or every query over it later, so an
 * ingest body has every string and key cleaned once, as it is parsed.
 */
export function parseIngestBody(raw: unknown): unknown {
  return postgresSafe(
    typeof raw === "string" && raw.trim() ? parseJsonBody(raw) : raw,
  );
}

function postgresSafe(value: unknown): unknown {
  if (typeof value === "string") return postgresSafeString(value);
  if (Array.isArray(value)) return value.map(postgresSafe);
  if (value && typeof value === "object") {
    const entries = Object.entries(value).map(([key, entry]) => [
      postgresSafeString(key),
      postgresSafe(entry),
    ]);
    // Two keys that clean to one would silently keep only one value.
    if (new Set(entries.map(([key]) => key)).size < entries.length) {
      throw requestError(
        "Request body has keys that differ only by characters Postgres cannot store",
        400,
      );
    }
    return Object.fromEntries(entries);
  }
  return value;
}

function postgresSafeString(value: string): string {
  return value.replace(NUL, "").replace(LONE_SURROGATE, "�");
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
