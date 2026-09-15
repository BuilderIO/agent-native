// R83 — safe fetch-response parsing for file upload flows.
//
// A failed upload can come back as a non-JSON body (an upstream proxy or
// platform crash page, a plaintext "Internal Error", etc.). Calling
// `response.json()` unconditionally on a body like that throws a raw
// `SyntaxError` ("Unexpected token 'I', "Internal E"... is not valid JSON"),
// which then surfaces verbatim in an import/upload toast instead of a clean
// message. Route every parse through this helper so a non-JSON body always
// degrades to a readable message instead of leaking a raw parser error.

export interface UploadResponseEnvelope {
  error?: string;
  [key: string]: unknown;
}

/** Minimal shape `parseUploadResponse` needs — a subset of the real `Response`. */
export interface JsonParsableResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

const MAX_TOAST_BODY_CHARS = 160;

function truncateForToast(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= MAX_TOAST_BODY_CHARS) return trimmed;
  return `${trimmed.slice(0, MAX_TOAST_BODY_CHARS)}…`;
}

/**
 * Parses a fetch `Response` as JSON only when it is actually JSON, and
 * always resolves rather than throwing a parse error for a failure
 * response — the fallback branch folds an unparsable failure body into the
 * same `{ error }` shape a well-behaved server route would have sent,
 * truncating an overlong body so a raw HTML/proxy error page doesn't blow up
 * the toast description.
 *
 * Success responses are still expected to be real JSON: a genuinely broken
 * 200 throws the underlying SyntaxError rather than silently returning `{}`,
 * so that failure mode stays loud instead of masquerading as an empty
 * successful import.
 */
export async function parseUploadResponse<
  T extends UploadResponseEnvelope = UploadResponseEnvelope,
>(response: JsonParsableResponse, fallbackErrorMessage: string): Promise<T> {
  const raw = await response.text();
  const looksJson = /^\s*[{[]/.test(raw);
  if (!looksJson) {
    if (response.ok) {
      throw new SyntaxError(
        `Expected a JSON response but received: ${truncateForToast(raw)}`,
      );
    }
    return {
      error: raw.trim()
        ? `${fallbackErrorMessage}: ${truncateForToast(raw)}`
        : fallbackErrorMessage,
    } as T;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    if (response.ok) {
      throw new SyntaxError(
        `Expected a JSON response but received: ${truncateForToast(raw)}`,
      );
    }
    return { error: fallbackErrorMessage } as T;
  }
}
