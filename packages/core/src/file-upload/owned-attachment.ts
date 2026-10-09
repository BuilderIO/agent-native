import { parseBase64DataUrl } from "../shared/data-url.js";
import {
  normalizeImageMediaType,
  reconcileImageBytes,
  reconcilePdfBytes,
} from "./attachment-bytes.js";
import {
  formatBase64CharBudget,
  isInlineReadableDocumentType,
  MAX_INLINE_FILE_BASE64_CHARS,
  MAX_INLINE_IMAGE_BASE64_CHARS,
} from "./inline-attachment-limits.js";
import { findFileUploadProviderOwningUrl } from "./registry.js";

type OwnedUrlReadFailureCode =
  | "invalid-url"
  | "ownership-check-failed"
  | "unowned-url"
  | "fetch-failed"
  | "redirect-rejected"
  | "response-rejected"
  | "request-candidate-limit"
  | "request-byte-limit"
  | "request-time-limit"
  | "empty-response";

export type OwnedImageReadFailureCode =
  | OwnedUrlReadFailureCode
  | "image-too-large"
  | "invalid-image";

export type OwnedFileReadFailureCode =
  | OwnedUrlReadFailureCode
  | "file-too-large"
  | "invalid-file";

export type OwnedAttachmentReadFailureCode =
  | OwnedImageReadFailureCode
  | OwnedFileReadFailureCode;

export type OwnedAttachmentReadFailure =
  | {
      name: string;
      code: OwnedImageReadFailureCode;
      attachmentType: "image";
    }
  | {
      name: string;
      code: OwnedFileReadFailureCode;
      attachmentType: "file";
    };

export type OwnedImageHydrationResult =
  | {
      kind: "hydrated";
      dataUrl: string;
      mediaType: string;
      provider: string;
    }
  | { kind: "failed"; code: Exclude<OwnedImageReadFailureCode, "unowned-url"> }
  | { kind: "unowned"; code: "unowned-url" };

export type OwnedFileHydrationResult =
  | {
      kind: "hydrated";
      dataUrl: string;
      mediaType: string;
      provider: string;
    }
  | { kind: "failed"; code: Exclude<OwnedFileReadFailureCode, "unowned-url"> }
  | { kind: "unowned"; code: "unowned-url" };

export const MAX_OWNED_INLINE_IMAGE_BYTES = Math.floor(
  (MAX_INLINE_IMAGE_BASE64_CHARS * 3) / 4,
);
export const MAX_OWNED_INLINE_FILE_BYTES = Math.floor(
  (MAX_INLINE_FILE_BASE64_CHARS * 3) / 4,
);

export const MAX_OWNED_ATTACHMENT_HYDRATION_CANDIDATES = 6;
export const MAX_OWNED_IMAGE_HYDRATION_CANDIDATES =
  MAX_OWNED_ATTACHMENT_HYDRATION_CANDIDATES;
export const MAX_OWNED_ATTACHMENT_HYDRATION_BYTES = 8 * 1024 * 1024;
export const MAX_OWNED_IMAGE_HYDRATION_BYTES =
  MAX_OWNED_ATTACHMENT_HYDRATION_BYTES;
export const OWNED_ATTACHMENT_HYDRATION_TIMEOUT_MS = 20_000;
export const OWNED_IMAGE_HYDRATION_TIMEOUT_MS =
  OWNED_ATTACHMENT_HYDRATION_TIMEOUT_MS;

export interface OwnedAttachmentHydrationBudget {
  deadlineAt: number;
  remainingBytes: number;
}

export type OwnedImageHydrationBudget = OwnedAttachmentHydrationBudget;

export function createOwnedAttachmentHydrationBudget(
  now = Date.now(),
): OwnedAttachmentHydrationBudget {
  return {
    deadlineAt: now + OWNED_ATTACHMENT_HYDRATION_TIMEOUT_MS,
    remainingBytes: MAX_OWNED_ATTACHMENT_HYDRATION_BYTES,
  };
}

export const createOwnedImageHydrationBudget =
  createOwnedAttachmentHydrationBudget;

class RequestDeadlineError extends Error {}

function raceWithDeadline<T>(
  value: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) return Promise.reject(new RequestDeadlineError());

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new RequestDeadlineError());
    signal.addEventListener("abort", onAbort, { once: true });
    value.then(
      (result) => {
        signal.removeEventListener("abort", onAbort);
        resolve(result);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function parseOwnedHttpsUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.hash) {
      return null;
    }
    return url;
  } catch (error) {
    if (error instanceof TypeError) return null;
    throw error;
  }
}

async function readResponseBytes(
  response: Response,
  budget: OwnedAttachmentHydrationBudget,
  signal: AbortSignal,
  maxInlineBytes: number,
  oversizedCode: "image-too-large" | "file-too-large",
): Promise<Uint8Array> {
  const requestBytesAtStart = budget.remainingBytes;
  const maxBytes = Math.min(maxInlineBytes, requestBytesAtStart);
  const limitCode =
    requestBytesAtStart < maxInlineBytes
      ? ("request-byte-limit" as const)
      : oversizedCode;

  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    const declaredLength = Number(contentLength);
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      await response.body?.cancel().catch(() => {});
      throw Object.assign(
        new Error("Image response exceeds its hydration byte limit"),
        {
          code: limitCode,
        },
      );
    }
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("Image response has no body");
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  const cancelOnAbort = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", cancelOnAbort, { once: true });
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const nextTotalBytes = totalBytes + value.byteLength;
      if (nextTotalBytes > maxBytes) {
        budget.remainingBytes = Math.max(
          0,
          requestBytesAtStart - nextTotalBytes,
        );
        await reader.cancel().catch(() => {});
        throw Object.assign(
          new Error("Image response exceeds its hydration byte limit"),
          {
            code: limitCode,
          },
        );
      }
      totalBytes = nextTotalBytes;
      budget.remainingBytes = Math.max(0, requestBytesAtStart - totalBytes);
      chunks.push(value);
    }
  } finally {
    signal.removeEventListener("abort", cancelOnAbort);
    reader.releaseLock();
  }
  if (totalBytes === 0) throw new Error("Attachment response is empty");

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

type OwnedUrlReadResult<
  TooLargeCode extends "image-too-large" | "file-too-large",
> =
  | {
      kind: "read";
      bytes: Uint8Array;
      provider: string;
      responseContentType: string | null;
    }
  | {
      kind: "failed";
      code: Exclude<OwnedUrlReadFailureCode, "unowned-url"> | TooLargeCode;
    }
  | { kind: "unowned"; code: "unowned-url" };

async function readOwnedUrlBytes<
  TooLargeCode extends "image-too-large" | "file-too-large",
>(args: {
  value: string;
  budget: OwnedAttachmentHydrationBudget;
  maxInlineBytes: number;
  oversizedCode: TooLargeCode;
  accept: string;
}): Promise<OwnedUrlReadResult<TooLargeCode>> {
  const url = parseOwnedHttpsUrl(args.value);
  if (!url) return { kind: "failed", code: "invalid-url" };
  if (args.budget.remainingBytes <= 0) {
    return { kind: "failed", code: "request-byte-limit" };
  }

  const remainingMs = args.budget.deadlineAt - Date.now();
  if (remainingMs <= 0) {
    return { kind: "failed", code: "request-time-limit" };
  }
  const ownershipController = new AbortController();
  const ownershipTimeout = setTimeout(
    () => ownershipController.abort(),
    remainingMs,
  );

  let provider;
  try {
    provider = await raceWithDeadline(
      Promise.resolve().then(() => findFileUploadProviderOwningUrl(url.href)),
      ownershipController.signal,
    );
  } catch (error) {
    return {
      kind: "failed",
      code:
        error instanceof RequestDeadlineError
          ? "request-time-limit"
          : "ownership-check-failed",
    };
  } finally {
    clearTimeout(ownershipTimeout);
  }
  if (!provider) return { kind: "unowned", code: "unowned-url" };

  const fetchRemainingMs = args.budget.deadlineAt - Date.now();
  if (fetchRemainingMs <= 0) {
    return { kind: "failed", code: "request-time-limit" };
  }
  const fetchController = new AbortController();
  const fetchTimeout = setTimeout(
    () => fetchController.abort(),
    fetchRemainingMs,
  );

  let response: Response;
  try {
    response = await raceWithDeadline(
      fetch(url, {
        method: "GET",
        headers: { Accept: args.accept },
        credentials: "omit",
        redirect: "manual",
        signal: fetchController.signal,
      }),
      fetchController.signal,
    );
  } catch (error) {
    return {
      kind: "failed",
      code:
        error instanceof RequestDeadlineError
          ? "request-time-limit"
          : "fetch-failed",
    };
  } finally {
    clearTimeout(fetchTimeout);
  }

  if (response.status >= 300 && response.status < 400) {
    void response.body?.cancel().catch(() => {});
    return { kind: "failed", code: "redirect-rejected" };
  }
  if (!response.ok) {
    void response.body?.cancel().catch(() => {});
    return { kind: "failed", code: "response-rejected" };
  }

  let bytes: Uint8Array;
  const bodyController = new AbortController();
  const bodyTimeout = setTimeout(
    () => bodyController.abort(),
    Math.max(0, args.budget.deadlineAt - Date.now()),
  );
  try {
    bytes = await raceWithDeadline(
      readResponseBytes(
        response,
        args.budget,
        bodyController.signal,
        args.maxInlineBytes,
        args.oversizedCode,
      ),
      bodyController.signal,
    );
  } catch (error) {
    if (error instanceof RequestDeadlineError) {
      void response.body?.cancel().catch(() => {});
      return { kind: "failed", code: "request-time-limit" };
    }
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error.code === args.oversizedCode || error.code === "request-byte-limit")
    ) {
      return {
        kind: "failed",
        code: error.code as TooLargeCode | "request-byte-limit",
      };
    }
    if (
      error instanceof Error &&
      error.message === "Attachment response is empty"
    ) {
      return { kind: "failed", code: "empty-response" };
    }
    return { kind: "failed", code: "fetch-failed" };
  } finally {
    clearTimeout(bodyTimeout);
  }
  if (Date.now() >= args.budget.deadlineAt) {
    return { kind: "failed", code: "request-time-limit" };
  }

  return {
    kind: "read",
    bytes,
    provider: provider.id,
    responseContentType: response.headers.get("content-type"),
  };
}

/**
 * Hydrate only HTTPS URLs positively claimed by configured upload storage.
 * A public URL is still untrusted input: never follow redirects or send caller
 * credentials, and bound the streamed response before it reaches a model.
 */
export async function hydrateOwnedImageUrl(
  value: string,
  declaredMediaType?: string,
  budget?: OwnedAttachmentHydrationBudget,
): Promise<OwnedImageHydrationResult> {
  const hydrationBudget = budget ?? createOwnedAttachmentHydrationBudget();
  const result = await readOwnedUrlBytes({
    value,
    budget: hydrationBudget,
    maxInlineBytes: MAX_OWNED_INLINE_IMAGE_BYTES,
    oversizedCode: "image-too-large",
    accept: "image/jpeg, image/png, image/gif, image/webp",
  });
  if (result.kind !== "read") return result;

  const base64 = Buffer.from(result.bytes).toString("base64");
  const responseMediaType = normalizeImageMediaType(
    result.responseContentType ?? undefined,
  );
  const fallbackMediaType = normalizeImageMediaType(declaredMediaType);
  const declared = responseMediaType ?? fallbackMediaType ?? "unknown";
  const verdict = reconcileImageBytes({ base64, declared });
  if (verdict.kind !== "ok") {
    return { kind: "failed", code: "invalid-image" };
  }

  const parsed = parseBase64DataUrl(
    `data:${verdict.mediaType};base64,${base64}`,
  );
  if (!parsed) return { kind: "failed", code: "invalid-image" };

  return {
    kind: "hydrated",
    dataUrl: `data:${verdict.mediaType};base64,${parsed.data}`,
    mediaType: verdict.mediaType,
    provider: result.provider,
  };
}

export async function hydrateOwnedFileUrl(
  value: string,
  declaredMediaType: string | undefined,
  fileName: string | undefined,
  budget?: OwnedAttachmentHydrationBudget,
): Promise<OwnedFileHydrationResult> {
  const hydrationBudget = budget ?? createOwnedAttachmentHydrationBudget();
  const result = await readOwnedUrlBytes({
    value,
    budget: hydrationBudget,
    maxInlineBytes: MAX_OWNED_INLINE_FILE_BYTES,
    oversizedCode: "file-too-large",
    accept:
      "application/pdf, text/*, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel",
  });
  if (result.kind !== "read") return result;

  const responseMediaType =
    result.responseContentType?.split(";", 1)[0]?.trim().toLowerCase() ||
    undefined;
  const declared = declaredMediaType?.split(";", 1)[0]?.trim().toLowerCase();
  const mediaType =
    responseMediaType === "application/octet-stream"
      ? declared
      : (responseMediaType ?? declared);
  if (!mediaType || !isInlineReadableDocumentType(mediaType, fileName)) {
    return { kind: "failed", code: "invalid-file" };
  }

  const base64 = Buffer.from(result.bytes).toString("base64");
  if (
    mediaType === "application/pdf" &&
    reconcilePdfBytes({ base64, declared: mediaType }).kind !== "ok"
  ) {
    return { kind: "failed", code: "invalid-file" };
  }

  return {
    kind: "hydrated",
    dataUrl: `data:${mediaType};base64,${base64}`,
    mediaType,
    provider: result.provider,
  };
}

export function describeOwnedImageReadFailure(
  code: OwnedImageReadFailureCode,
): string {
  switch (code) {
    case "invalid-url":
      return "the storage URL was not a valid HTTPS URL";
    case "ownership-check-failed":
      return "the configured storage provider could not verify the URL";
    case "unowned-url":
      return "the URL does not belong to a configured upload provider";
    case "fetch-failed":
      return "the storage provider did not return readable image bytes";
    case "redirect-rejected":
      return "the storage provider redirected the image request";
    case "response-rejected":
      return "the storage provider rejected the image request";
    case "image-too-large":
      return `the image exceeds the ${formatBase64CharBudget(MAX_INLINE_IMAGE_BASE64_CHARS)} vision input limit`;
    case "request-candidate-limit":
      return "the request reached its limit for checking image attachments";
    case "request-byte-limit":
      return "the request reached its total downloaded image byte limit";
    case "request-time-limit":
      return "the shared image-reading time limit for this request expired";
    case "empty-response":
      return "the storage provider returned an empty image";
    case "invalid-image":
      return "the stored bytes were not a complete JPEG, PNG, GIF, or WebP image";
  }
}

export function describeOwnedFileReadFailure(
  code: OwnedFileReadFailureCode,
): string {
  switch (code) {
    case "invalid-url":
      return "the storage URL was not a valid HTTPS URL";
    case "ownership-check-failed":
      return "the configured storage provider could not verify the URL";
    case "unowned-url":
      return "the URL does not belong to a configured upload provider";
    case "fetch-failed":
      return "the storage provider did not return readable file bytes";
    case "redirect-rejected":
      return "the storage provider redirected the file request";
    case "response-rejected":
      return "the storage provider rejected the file request";
    case "file-too-large":
      return `the file exceeds the ${formatBase64CharBudget(MAX_INLINE_FILE_BASE64_CHARS)} inline reading limit`;
    case "request-candidate-limit":
      return "the request reached its limit for checking attachment storage URLs";
    case "request-byte-limit":
      return "the request reached its total downloaded attachment byte limit";
    case "request-time-limit":
      return "the shared attachment-reading time limit for this request expired";
    case "empty-response":
      return "the storage provider returned an empty file";
    case "invalid-file":
      return "the stored bytes were not a supported readable document";
  }
}
