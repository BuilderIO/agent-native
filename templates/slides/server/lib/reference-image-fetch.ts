import { ssrfSafeFetch } from "@agent-native/core/extensions/url-safety";
import pLimit from "p-limit";

export const MAX_REFERENCE_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_REFERENCE_IMAGE_TOTAL_BYTES = 10 * 1024 * 1024;
export const MAX_REFERENCE_IMAGE_COUNT = 8;
export const MAX_REFERENCE_IMAGE_INPUT_COUNT = 32;

const SUPPORTED_REFERENCE_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

export interface ReferenceImage {
  data: string;
  mimeType: string;
  byteLength: number;
}

export type ReferenceImageFailure =
  | { code: "fetch_failed"; errorName: string }
  | { code: "http_error"; status: number }
  | { code: "missing_content_type" }
  | { code: "unsupported_content_type"; contentType: string }
  | { code: "response_too_large"; maxBytes: number }
  | { code: "aggregate_limit_exceeded"; maxBytes: number }
  | { code: "empty_body" }
  | { code: "body_read_failed"; errorName: string };

export type ReferenceImageFetchResult =
  | { ok: true; image: ReferenceImage }
  | { ok: false; reason: ReferenceImageFailure };

interface ReferenceImageFetchOptions {
  timeoutMs?: number;
  budget?: {
    reserve: (bytes: number) => boolean;
    release: (bytes: number) => void;
  };
}

export interface ReferenceImageBatchResult {
  requested: number;
  attempted: number;
  loaded: number;
  failed: number;
  skipped: number;
  totalBytes: number;
  images: ReferenceImage[];
  failures: Array<{ index: number; reason: ReferenceImageFailure }>;
  skippedReasons: Array<
    | {
        code: "reference_count_limit";
        count: number;
        maxReferences: number;
      }
    | {
        code: "aggregate_limit_exceeded";
        count: number;
        maxBytes: number;
      }
  >;
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

  const declaredMimeType =
    contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  const mimeType =
    declaredMimeType === "image/jpg" ? "image/jpeg" : declaredMimeType;
  if (!SUPPORTED_REFERENCE_IMAGE_TYPES.has(mimeType)) {
    await cancelBody(response.body);
    return {
      ok: false,
      reason: {
        code: "unsupported_content_type",
        contentType: declaredMimeType,
      },
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
  let reservedBytes = 0;
  let succeeded = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (totalBytes + value.byteLength > MAX_REFERENCE_IMAGE_BYTES) {
        await reader.cancel().catch(() => undefined);
        return {
          ok: false,
          reason: {
            code: "response_too_large",
            maxBytes: MAX_REFERENCE_IMAGE_BYTES,
          },
        };
      }
      if (options.budget && !options.budget.reserve(value.byteLength)) {
        await reader.cancel().catch(() => undefined);
        return {
          ok: false,
          reason: {
            code: "aggregate_limit_exceeded",
            maxBytes: MAX_REFERENCE_IMAGE_TOTAL_BYTES,
          },
        };
      }
      reservedBytes += options.budget ? value.byteLength : 0;
      totalBytes += value.byteLength;
      chunks.push(Buffer.from(value));
    }

    if (totalBytes === 0) {
      return { ok: false, reason: { code: "empty_body" } };
    }

    const image: ReferenceImage = {
      data: Buffer.concat(chunks, totalBytes).toString("base64"),
      mimeType,
      byteLength: totalBytes,
    };
    succeeded = true;
    return { ok: true, image };
  } catch (error) {
    return {
      ok: false,
      reason: { code: "body_read_failed", errorName: errorName(error) },
    };
  } finally {
    if (!succeeded) options.budget?.release(reservedBytes);
    reader.releaseLock();
  }
}

export async function fetchReferenceImages(
  urls: string[],
  options: Omit<ReferenceImageFetchOptions, "budget"> = {},
): Promise<ReferenceImageBatchResult> {
  const requested = urls.length;
  const limitedUrls = urls.slice(0, MAX_REFERENCE_IMAGE_COUNT);
  const countSkipped = requested - limitedUrls.length;
  let totalBytes = 0;
  let attempted = 0;
  let aggregateSkipped = 0;
  const failures: ReferenceImageBatchResult["failures"] = [];
  const imagesByIndex: Array<{ index: number; image: ReferenceImage }> = [];
  const aggregateSkippedUrls: Array<{ index: number; url: string }> = [];
  const budget = {
    reserve(bytes: number) {
      if (totalBytes + bytes > MAX_REFERENCE_IMAGE_TOTAL_BYTES) return false;
      totalBytes += bytes;
      return true;
    },
    release(bytes: number) {
      totalBytes -= bytes;
    },
  };
  const limit = pLimit(4);

  await Promise.all(
    limitedUrls.map((url, index) =>
      limit(async () => {
        attempted++;
        const result = await fetchReferenceImage(url, {
          ...options,
          budget,
        });
        if (result.ok) {
          imagesByIndex.push({ index, image: result.image });
        } else if (result.reason.code === "aggregate_limit_exceeded") {
          aggregateSkippedUrls.push({ index, url });
        } else {
          failures.push({ index: index + 1, reason: result.reason });
        }
      }),
    ),
  );

  for (const { index, url } of aggregateSkippedUrls) {
    attempted++;
    const result = await fetchReferenceImage(url, { ...options, budget });
    if (result.ok) {
      imagesByIndex.push({ index, image: result.image });
    } else if (result.reason.code === "aggregate_limit_exceeded") {
      aggregateSkipped++;
    } else {
      failures.push({ index: index + 1, reason: result.reason });
    }
  }

  const images = imagesByIndex
    .sort((a, b) => a.index - b.index)
    .map(({ image }) => image);
  const loaded = images.length;
  const skipped = countSkipped + aggregateSkipped;
  const skippedReasons: ReferenceImageBatchResult["skippedReasons"] = [];
  if (countSkipped > 0) {
    skippedReasons.push({
      code: "reference_count_limit",
      count: countSkipped,
      maxReferences: MAX_REFERENCE_IMAGE_COUNT,
    });
  }
  if (aggregateSkipped > 0) {
    skippedReasons.push({
      code: "aggregate_limit_exceeded",
      count: aggregateSkipped,
      maxBytes: MAX_REFERENCE_IMAGE_TOTAL_BYTES,
    });
  }

  return {
    requested,
    attempted,
    loaded,
    failed: failures.length,
    skipped,
    totalBytes,
    images,
    failures,
    skippedReasons,
  };
}
