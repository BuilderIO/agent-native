import type { ReadStream } from "node:fs";

/**
 * Small helpers around h3 v2 that polish ergonomics for templates.
 *
 * `readBody` — wraps h3's `readBody` so the result is typed `any` by default
 * (h3 v2 infers `unknown`, which forces `as` casts at every call site).
 *
 * `readBodyWithSizeLimit` — like `readBody` but rejects with a 413 response
 * when the `content-length` header (or the buffered body size) exceeds the
 * given threshold. Use this on any route whose payload can include inline
 * base64 attachments (chat POST, upload routes).
 *
 * `streamFile` — converts a Node `ReadStream` to a web `ReadableStream` so
 * route handlers can return file content without importing `node:stream`
 * inline. h3 v2 expects web streams everywhere.
 */
import { readBody as _readBody, getHeader, setResponseStatus } from "h3";
import type { H3Event } from "h3";

/**
 * Default maximum chat-POST body size (25 MB uncompressed). The agent chat
 * body carries base64-encoded attachments so a 25 MB cap is generous while
 * still protecting against runaway payloads. Override per-route by passing a
 * different `maxBytes` value to `readBodyWithSizeLimit`.
 */
export const DEFAULT_CHAT_MAX_BODY_BYTES = 25 * 1024 * 1024;

/**
 * Maximum file size for upload routes (25 MB). Mirrors Whisper's hard limit
 * so audio, image, and document uploads share a consistent ceiling.
 */
export const DEFAULT_UPLOAD_MAX_FILE_BYTES = 25 * 1024 * 1024;

/**
 * Maximum number of attachments per chat message. Guards against pathological
 * requests that would fan out into hundreds of parallel model content-parts.
 */
export const MAX_CHAT_ATTACHMENTS_PER_MESSAGE = 20;

/**
 * MIME types allowed on the file-upload routes. Executables and scripts are
 * explicitly excluded; everything else is allowed at the default tier.
 * Pass `allowedMimeTypes` to `assertAllowedMimeType` to enforce on a route.
 */
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

/** Mime types that are always rejected even if a prefix matches. */
const UPLOAD_BLOCKED_MIME_TYPES = new Set([
  "application/x-msdownload",
  "application/x-executable",
  "application/x-sh",
  "application/x-bat",
  "application/x-msdos-program",
]);

/**
 * Returns true when the given MIME type is acceptable for uploads.
 * Blocks executables and scripts; allows everything else in the allow-prefix list.
 */
export function isAllowedUploadMimeType(mimeType: string): boolean {
  const lower = (mimeType || "").toLowerCase().split(";")[0].trim();
  if (UPLOAD_BLOCKED_MIME_TYPES.has(lower)) return false;
  return UPLOAD_ALLOWED_MIME_PREFIXES.some((prefix) =>
    lower.startsWith(prefix),
  );
}

/**
 * Parse a JSON request body. Returns `{}` if the body is empty or absent
 * so callers don't have to null-check before destructuring.
 *
 * Defaults T to `any` for ergonomic field access. Pass an explicit type
 * argument when you want a typed result:
 *
 *   const { email, password } = await readBody<LoginRequest>(event);
 */
export async function readBody<T = any>(event: H3Event): Promise<T> {
  return ((await _readBody(event)) ?? {}) as T;
}

/**
 * Like `readBody` but rejects with a 413 response when the declared
 * `content-length` (or the actual buffered body) exceeds `maxBytes`.
 *
 * @param event - H3 event
 * @param maxBytes - Maximum allowed body size in bytes (default: 25 MB)
 * @returns Parsed body or `{}` when absent
 * @throws Never — on over-size it sets status 413 and throws an object with
 *   `{ statusCode: 413, message }` so the h3 handler can propagate it.
 */
export async function readBodyWithSizeLimit<T = any>(
  event: H3Event,
  maxBytes: number = DEFAULT_CHAT_MAX_BODY_BYTES,
): Promise<T> {
  // Fast-path: check Content-Length before buffering the body.
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

  // Also check the actual serialised size for chunked requests that omit C-L.
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

/**
 * Convert a Node `ReadStream` (e.g. from `fs.createReadStream`) into a web
 * `ReadableStream`, suitable for returning directly from an h3 v2 handler.
 *
 *   import { streamFile } from "@agent-native/core/server";
 *   import fs from "node:fs";
 *
 *   return streamFile(fs.createReadStream(filePath));
 */
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
