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
  const tooLarge = () => {
    setResponseStatus(event, 413);
    return Object.assign(
      new Error(`Request body too large (max ${maxBytes} bytes)`),
      { statusCode: 413 },
    );
  };
  const clRaw = getHeader(event, "content-length");
  if (clRaw) {
    const declared = parseInt(clRaw, 10);
    if (!Number.isNaN(declared) && declared > maxBytes) {
      throw tooLarge();
    }
  }

  const bodyStream = (event as any).req?.body as
    | ReadableStream<Uint8Array>
    | null
    | undefined;
  if (bodyStream && typeof bodyStream.getReader === "function") {
    const reader = bodyStream.getReader();
    const chunks: Uint8Array[] = [];
    let actualBytes = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        actualBytes += value.byteLength;
        if (actualBytes > maxBytes) {
          const error = tooLarge();
          try {
            await reader.cancel();
          } catch (cancelError) {
            Object.assign(error, { cause: cancelError });
          }
          throw error;
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    if (actualBytes === 0) return {} as T;
    const bytes = new Uint8Array(actualBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  }

  const body = await _readBody(event);

  if (body !== null && body !== undefined) {
    let actualBytes: number;
    if (typeof body === "string") {
      actualBytes = Buffer.byteLength(body, "utf8");
    } else {
      actualBytes = Buffer.byteLength(JSON.stringify(body), "utf8");
    }
    if (actualBytes > maxBytes) {
      throw tooLarge();
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
