import { MAX_UPLOAD_BYTES } from "@shared/upload-limits.js";

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} bytes`;
}

export class VideoDownloadTooLargeError extends Error {
  constructor(
    readonly sizeBytes: number,
    readonly maxBytes: number,
  ) {
    super(
      `Video is too large to import (${formatBytes(sizeBytes)}, max ${formatBytes(maxBytes)}). Download a shorter or compressed copy and upload it directly.`,
    );
    this.name = "VideoDownloadTooLargeError";
  }
}

export function assertUploadSize(
  sizeBytes: number | null | undefined,
  maxBytes = MAX_UPLOAD_BYTES,
): void {
  if (!Number.isFinite(sizeBytes ?? NaN) || (sizeBytes ?? 0) <= 0) return;
  if ((sizeBytes ?? 0) > maxBytes) {
    throw new VideoDownloadTooLargeError(sizeBytes ?? 0, maxBytes);
  }
}

function parseContentLength(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}

export async function readResponseBytesWithLimit(
  response: Response,
  maxBytes = MAX_UPLOAD_BYTES,
): Promise<Uint8Array> {
  const contentLength = parseContentLength(
    response.headers.get("content-length"),
  );
  try {
    assertUploadSize(contentLength, maxBytes);
  } catch (error) {
    await response.body?.cancel().catch(() => undefined);
    throw error;
  }

  if (!response.body) {
    const arrayBuffer = await response.arrayBuffer();
    assertUploadSize(arrayBuffer.byteLength, maxBytes);
    return new Uint8Array(arrayBuffer);
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      totalBytes += value.byteLength;
      assertUploadSize(totalBytes, maxBytes);
      chunks.push(
        Buffer.from(value.buffer, value.byteOffset, value.byteLength),
      );
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }

  const buffer = Buffer.concat(chunks, totalBytes);
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}
