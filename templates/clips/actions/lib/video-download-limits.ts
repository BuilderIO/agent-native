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

export interface ReadResponseBytesPacing {
  /** Fail when no chunk arrives for this long. */
  idleMs: number;
  /** Fail when an idle window delivers fewer bytes than this (or than what is
   * left of a known Content-Length): a trickle that keeps resetting the idle
   * timer is still a stalled download. Checked as the next chunk lands. */
  minBytesPerIdleWindow?: number;
  /** Fail when the whole body takes longer than this. */
  maxTotalMs?: number;
}

export async function readResponseBytesWithLimit(
  response: Response,
  maxBytes = MAX_UPLOAD_BYTES,
  pacing?: ReadResponseBytesPacing,
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
  const startedAt = Date.now();
  let windowStart = startedAt;
  let windowStartBytes = 0;

  // One timer for the whole read, refreshed as each chunk lands. It rejects
  // before cancelling the reader: cancel settles the pending read as done,
  // and a race that saw that first would hand back a truncated body as whole.
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let totalTimer: ReturnType<typeof setTimeout> | undefined;
  const failed = new Promise<never>((_, reject) => {
    const fail = (message: string) => {
      const error = new Error(message);
      reject(error);
      reader.cancel(error).catch(() => undefined);
    };
    if (pacing) {
      idleTimer = setTimeout(
        () => fail(`Download stalled: no data for ${pacing.idleMs}ms`),
        pacing.idleMs,
      );
      if (pacing.maxTotalMs) {
        totalTimer = setTimeout(
          () => fail(`Download took longer than ${pacing.maxTotalMs}ms`),
          pacing.maxTotalMs,
        );
      }
    }
  });
  // A rejection nobody is racing against yet must not be unhandled.
  failed.catch(() => undefined);

  try {
    while (true) {
      const { done, value } = pacing
        ? await Promise.race([reader.read(), failed])
        : await reader.read();
      if (done) break;
      if (!value) continue;
      idleTimer?.refresh();

      totalBytes += value.byteLength;
      assertUploadSize(totalBytes, maxBytes);
      chunks.push(
        Buffer.from(value.buffer, value.byteOffset, value.byteLength),
      );

      if (pacing?.minBytesPerIdleWindow) {
        const now = Date.now();
        const elapsed = now - windowStart;
        if (elapsed >= pacing.idleMs) {
          const windowBytes = totalBytes - windowStartBytes;
          const needed =
            contentLength === null
              ? pacing.minBytesPerIdleWindow
              : Math.min(
                  pacing.minBytesPerIdleWindow,
                  contentLength - windowStartBytes,
                );
          if (windowBytes < needed) {
            throw new Error(
              `Download too slow: ${formatBytes(windowBytes)} in ${elapsed}ms`,
            );
          }
          windowStart = now;
          windowStartBytes = totalBytes;
        }
      }
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
    if (totalTimer) clearTimeout(totalTimer);
    reader.releaseLock();
  }

  const buffer = Buffer.concat(chunks, totalBytes);
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}
