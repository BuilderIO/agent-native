/**
 * Small helpers around h3 v2 that polish ergonomics for templates.
 *
 * `readBody` — wraps h3's `readBody` so the result is typed `any` by default
 * (h3 v2 infers `unknown`, which forces `as` casts at every call site).
 *
 * `streamFile` — converts a Node `ReadStream` to a web `ReadableStream` so
 * route handlers can return file content without importing `node:stream`
 * inline. h3 v2 expects web streams everywhere.
 */
import { readBody as _readBody } from "h3";
import type { H3Event } from "h3";
import { Readable } from "node:stream";
import type { ReadStream } from "node:fs";

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
 * Convert a Node `ReadStream` (e.g. from `fs.createReadStream`) into a web
 * `ReadableStream`, suitable for returning directly from an h3 v2 handler.
 *
 *   import { streamFile } from "@agent-native/core/server";
 *   import fs from "node:fs";
 *
 *   return streamFile(fs.createReadStream(filePath));
 */
export function streamFile(stream: ReadStream): ReadableStream {
  return Readable.toWeb(stream) as ReadableStream;
}
