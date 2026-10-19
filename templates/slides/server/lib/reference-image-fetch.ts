import { ssrfSafeFetch } from "@agent-native/core/extensions/url-safety";

export const MAX_REFERENCE_IMAGE_BYTES = 5 * 1024 * 1024;

export interface ReferenceImage {
  data: string;
  mimeType: string;
}

export type ReferenceImageFailure =
  | { code: "fetch_failed"; errorName: string }
  | { code: "http_error"; status: number }
  | { code: "missing_content_type" }
  | { code: "unsupported_content_type"; contentType: string }
  | { code: "response_too_large"; maxBytes: number }
  | { code: "empty_body" }
  | { code: "body_read_failed"; errorName: string };

export type ReferenceImageFetchResult =
  | { ok: true; image: ReferenceImage }
  | { ok: false; reason: ReferenceImageFailure };

interface ReferenceImageFetchOptions {
  timeoutMs?: number;
}

async function cancelBody(body: ReadableStream<Uint8Array> | null) {
  await body?.cancel().catch(() => undefined);
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}

export async function fetchReferenceImage(
  url: string,
  options: ReferenceImageFetchOptions = {},
): Promise<ReferenceImageFetchResult> {
  let response: Response;
  try {
    response = await ssrfSafeFetch(
      url,
      { signal: AbortSignal.timeout(options.timeoutMs ?? 15_000) },
      { httpsOnly: true, maxRedirects: 2 },
    );
  } catch (error) {
    return {
      ok: false,
      reason: { code: "fetch_failed", errorName: errorName(error) },
    };
  }

  if (!response.ok) {
    await cancelBody(response.body);
    return {
      ok: false,
      reason: { code: "http_error", status: response.status },
    };
  }

  const contentType = response.headers.get("content-type");
  if (!contentType) {
    await cancelBody(response.body);
    return { ok: false, reason: { code: "missing_content_type" } };
  }

  const mimeType = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!/^image\/[a-z0-9][a-z0-9.+-]*$/u.test(mimeType)) {
    await cancelBody(response.body);
    return {
      ok: false,
      reason: { code: "unsupported_content_type", contentType: mimeType },
    };
  }

  const declaredLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_REFERENCE_IMAGE_BYTES
  ) {
    await cancelBody(response.body);
    return {
      ok: false,
      reason: {
        code: "response_too_large",
        maxBytes: MAX_REFERENCE_IMAGE_BYTES,
      },
    };
  }

  const reader = response.body?.getReader();
  if (!reader) {
    return { ok: false, reason: { code: "empty_body" } };
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_REFERENCE_IMAGE_BYTES) {
        await reader.cancel().catch(() => undefined);
        return {
          ok: false,
          reason: {
            code: "response_too_large",
            maxBytes: MAX_REFERENCE_IMAGE_BYTES,
          },
        };
      }
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    return {
      ok: false,
      reason: { code: "body_read_failed", errorName: errorName(error) },
    };
  } finally {
    reader.releaseLock();
  }

  if (totalBytes === 0) {
    return { ok: false, reason: { code: "empty_body" } };
  }

  return {
    ok: true,
    image: {
      data: Buffer.concat(chunks, totalBytes).toString("base64"),
      mimeType,
    },
  };
}
