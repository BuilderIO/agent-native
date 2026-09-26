
export interface UploadResponseEnvelope {
  error?: string;
  [key: string]: unknown;
}

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
