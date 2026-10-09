import { parseBase64DataUrl } from "../shared/data-url.js";
import {
  normalizeImageMediaType,
  reconcileImageBytes,
} from "./attachment-bytes.js";
import {
  formatBase64CharBudget,
  MAX_INLINE_IMAGE_BASE64_CHARS,
} from "./inline-attachment-limits.js";
import { findFileUploadProviderOwningUrl } from "./registry.js";

export type OwnedImageReadFailureCode =
  | "invalid-url"
  | "ownership-check-failed"
  | "unowned-url"
  | "fetch-failed"
  | "redirect-rejected"
  | "response-rejected"
  | "image-too-large"
  | "empty-response"
  | "invalid-image";

export type OwnedImageHydrationResult =
  | { kind: "hydrated"; dataUrl: string; mediaType: string; provider: string }
  | { kind: "failed"; code: Exclude<OwnedImageReadFailureCode, "unowned-url"> }
  | { kind: "unowned"; code: "unowned-url" };

export const MAX_OWNED_INLINE_IMAGE_BYTES = Math.floor(
  (MAX_INLINE_IMAGE_BASE64_CHARS * 3) / 4,
);

const OWNED_IMAGE_FETCH_TIMEOUT_MS = 15_000;

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

async function readResponseBytes(response: Response): Promise<Uint8Array> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    const declaredLength = Number(contentLength);
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > MAX_OWNED_INLINE_IMAGE_BYTES
    ) {
      await response.body?.cancel().catch(() => {});
      throw Object.assign(
        new Error("Image response exceeds the inline limit"),
        {
          code: "image-too-large" as const,
        },
      );
    }
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("Image response has no body");
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_OWNED_INLINE_IMAGE_BYTES) {
        await reader.cancel().catch(() => {});
        throw Object.assign(
          new Error("Image response exceeds the inline limit"),
          {
            code: "image-too-large" as const,
          },
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (totalBytes === 0) throw new Error("Image response is empty");

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * Hydrate only HTTPS URLs positively claimed by configured upload storage.
 * A public URL is still untrusted input: never follow redirects or send caller
 * credentials, and bound the streamed response before it reaches a model.
 */
export async function hydrateOwnedImageUrl(
  value: string,
  declaredMediaType?: string,
): Promise<OwnedImageHydrationResult> {
  const url = parseOwnedHttpsUrl(value);
  if (!url) return { kind: "failed", code: "invalid-url" };

  let provider;
  try {
    provider = await findFileUploadProviderOwningUrl(url.href);
  } catch {
    return { kind: "failed", code: "ownership-check-failed" };
  }
  if (!provider) return { kind: "unowned", code: "unowned-url" };

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: { Accept: "image/jpeg, image/png, image/gif, image/webp" },
      credentials: "omit",
      redirect: "manual",
      signal: AbortSignal.timeout(OWNED_IMAGE_FETCH_TIMEOUT_MS),
    });
  } catch {
    return { kind: "failed", code: "fetch-failed" };
  }

  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel().catch(() => {});
    return { kind: "failed", code: "redirect-rejected" };
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    return { kind: "failed", code: "response-rejected" };
  }

  let bytes: Uint8Array;
  try {
    bytes = await readResponseBytes(response);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "image-too-large"
    ) {
      return { kind: "failed", code: "image-too-large" };
    }
    if (error instanceof Error && error.message === "Image response is empty") {
      return { kind: "failed", code: "empty-response" };
    }
    return { kind: "failed", code: "fetch-failed" };
  }

  const base64 = Buffer.from(bytes).toString("base64");
  const responseMediaType = normalizeImageMediaType(
    response.headers.get("content-type") ?? undefined,
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
    provider: provider.id,
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
    case "empty-response":
      return "the storage provider returned an empty image";
    case "invalid-image":
      return "the stored bytes were not a complete JPEG, PNG, GIF, or WebP image";
  }
}
