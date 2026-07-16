import type { PrivateBlobHandle } from "@agent-native/core/private-blob";

export const DOCUMENT_MEDIA_MAX_BYTES = 25 * 1024 * 1024;
export const DOCUMENT_MEDIA_PATH = "/api/document-media";

const MEDIA_TYPE_PREFIXES = ["image/", "video/", "audio/"];

export function isSupportedDocumentMediaType(mimeType: string): boolean {
  return MEDIA_TYPE_PREFIXES.some((prefix) => mimeType.startsWith(prefix));
}

export function safeDocumentMediaFilename(value: string | undefined): string {
  const name = (value ?? "media").replace(/[\\/\0\r\n]/g, "_").trim();
  return (name || "media").slice(0, 200);
}

export function documentMediaUrl(id: string, basePath = ""): string {
  return `${basePath}${DOCUMENT_MEDIA_PATH}/${encodeURIComponent(id)}`;
}

export function serializePrivateBlobHandle(handle: PrivateBlobHandle): string {
  return JSON.stringify(handle);
}

export function parsePrivateBlobHandle(
  value: string,
): PrivateBlobHandle | null {
  try {
    const handle = JSON.parse(value) as PrivateBlobHandle;
    return handle?.opaque === true && typeof handle.provider === "string"
      ? handle
      : null;
  } catch {
    return null;
  }
}
