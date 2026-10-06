export interface UploadResponseEnvelope {
  error?: string;
  errorCode?: string;
  [key: string]: unknown;
}

export interface JsonParsableResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

/**
 * The upload or import service answered with something that is not its own
 * JSON: a gateway timeout, a platform error page, a captive portal. The body
 * says nothing the user can act on, so it is never shown; the code is what the
 * UI branches on, and the remedy is to retry.
 */
export const UPLOAD_SERVICE_UNAVAILABLE_CODE = "upload_service_unavailable";

const GATEWAY_STATUSES: ReadonlySet<number> = new Set([408, 502, 503, 504]);

export function isUploadGatewayStatus(status: number): boolean {
  return GATEWAY_STATUSES.has(status);
}

/**
 * True when `text` carries a document rather than a sentence. Also applied to
 * error messages, because the action client builds one from the first 200
 * characters of whatever body it received.
 */
export function looksLikeMarkup(text: string): boolean {
  return /<(?:!doctype|html|head|body|\?xml)\b/i.test(text);
}

export function uploadServiceUnavailableError(status: number): Error {
  return Object.assign(new Error("The upload service is unavailable"), {
    code: UPLOAD_SERVICE_UNAVAILABLE_CODE,
    status,
  });
}

/**
 * The error for a non-OK import response whose body was already parsed into an
 * envelope. The typed code, status and details travel on the error so callers
 * branch on them instead of the message.
 */
export function promptImportResponseError(
  status: number,
  body: { error?: string; errorCode?: string; details?: unknown },
  fallbackMessage: string,
): Error {
  return Object.assign(new Error(body.error || fallbackMessage), {
    status,
    ...(typeof body.errorCode === "string"
      ? { errorCode: body.errorCode }
      : {}),
    ...(body.details && typeof body.details === "object"
      ? { details: body.details }
      : {}),
  });
}

const MAX_TOAST_BODY_CHARS = 160;

function truncateForToast(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= MAX_TOAST_BODY_CHARS) return trimmed;
  return `${trimmed.slice(0, MAX_TOAST_BODY_CHARS)}…`;
}

export async function parseUploadResponse<
  T extends UploadResponseEnvelope = UploadResponseEnvelope,
>(response: JsonParsableResponse, fallbackErrorMessage: string): Promise<T> {
  const raw = await response.text();
  const looksJson = /^\s*[{[]/.test(raw);
  if (!looksJson) {
    const markup = looksLikeMarkup(raw);
    if (response.ok) {
      if (markup) throw uploadServiceUnavailableError(response.status);
      throw new SyntaxError(
        `Expected a JSON response but received: ${truncateForToast(raw)}`,
      );
    }
    if (markup || isUploadGatewayStatus(response.status)) {
      return {
        error: fallbackErrorMessage,
        errorCode: UPLOAD_SERVICE_UNAVAILABLE_CODE,
      } as T;
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
