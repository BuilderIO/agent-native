import type { ReadStream } from "node:fs";

import { readBody as _readBody, getHeader, setResponseStatus } from "h3";
import type { H3Event } from "h3";

export const DEFAULT_CHAT_MAX_BODY_BYTES = 25 * 1024 * 1024;

export const DEFAULT_UPLOAD_MAX_FILE_BYTES = 25 * 1024 * 1024;

export const MAX_CHAT_ATTACHMENTS_PER_MESSAGE = 20;

export const UPLOAD_ALLOWED_MIME_PREFIXES = [
  "image/",
  "video/",
  "audio/",
  "text/",
  "application/pdf",
  "application/json",
  "application/zip",
  "application/gzip",
  "application/x-tar",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument",
  "application/msword",
];

const UPLOAD_BLOCKED_MIME_TYPES = new Set([
  "application/x-msdownload",
  "application/x-executable",
  "application/x-sh",
  "application/x-bat",
  "application/x-msdos-program",
]);

export function isAllowedUploadMimeType(mimeType: string): boolean {
  const lower = (mimeType || "").toLowerCase().split(";")[0].trim();
  if (UPLOAD_BLOCKED_MIME_TYPES.has(lower)) return false;
  return UPLOAD_ALLOWED_MIME_PREFIXES.some((prefix) =>
    lower.startsWith(prefix),
  );
}

export async function readBody<T = any>(event: H3Event): Promise<T> {
  return ((await _readBody(event)) ?? {}) as T;
}

export async function readBodyWithSizeLimit<T = any>(
  event: H3Event,
  maxBytes: number = DEFAULT_CHAT_MAX_BODY_BYTES,
): Promise<T> {
  const clRaw = getHeader(event, "content-length");
  if (clRaw) {
    const declared = parseInt(clRaw, 10);
    if (!Number.isNaN(declared) && declared > maxBytes) {
      setResponseStatus(event, 413);
      throw Object.assign(
        new Error(`Request body too large (max ${maxBytes} bytes)`),
        {
          statusCode: 413,
        },
      );
    }
  }

  const body = await _readBody(event);

  if (body !== null && body !== undefined) {
    let actualBytes: number;
    if (typeof body === "string") {
      actualBytes = Buffer.byteLength(body, "utf8");
    } else {
      try {
        actualBytes = Buffer.byteLength(JSON.stringify(body), "utf8");
      } catch {
        actualBytes = 0;
      }
    }
    if (actualBytes > maxBytes) {
      setResponseStatus(event, 413);
      throw Object.assign(
        new Error(`Request body too large (max ${maxBytes} bytes)`),
        { statusCode: 413 },
      );
    }
  }

  return (body ?? {}) as T;
}

export function streamFile(stream: ReadStream): ReadableStream {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      stream.on("data", (chunk: string | Uint8Array) => {
        controller.enqueue(
          typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk,
        );
      });
      stream.on("end", () => controller.close());
      stream.on("error", (error) => controller.error(error));
    },
    cancel() {
      stream.destroy();
    },
  });
}
