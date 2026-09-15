/**
 * The byte and codec primitives the `.fig` decoder needs, on `Uint8Array` and
 * nothing else.
 *
 * The decoder used `Buffer`, `node:zlib` and `node:crypto`, which pinned it to
 * the server — so a `.fig` had to be uploaded before it could be read, and
 * Netlify caps a function request at ~6 MB while a real file runs to tens of
 * megabytes. Decoding in the browser removes that hop entirely, and keeping
 * these helpers isomorphic means the SAME decoder still runs under Node for the
 * API path and for the fidelity harness that measures it.
 *
 * `fflate` and `@noble/hashes` were chosen because both are synchronous: the
 * decoder is a synchronous tree walk, and the Web Crypto and DecompressionStream
 * equivalents are async, which would have made every caller async for no gain.
 * Both were verified byte-identical to `zlib.inflateRawSync`,
 * `zlib.inflateSync` and `crypto.createHash("sha1")`.
 */

import { sha1 as nobleSha1 } from "@noble/hashes/legacy.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { Inflate } from "fflate";

export function sha1Hex(bytes: Uint8Array): string {
  return bytesToHex(nobleSha1(bytes));
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function startsWith(bytes: Uint8Array, prefix: Uint8Array): boolean {
  return (
    bytes.length >= prefix.length &&
    bytesEqual(bytes.subarray(0, prefix.length), prefix)
  );
}

export function asciiBytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

export function readAscii(
  bytes: Uint8Array,
  start: number,
  end: number,
): string {
  let out = "";
  for (let i = start; i < end && i < bytes.length; i++) {
    out += String.fromCharCode(bytes[i]!);
  }
  return out;
}

const utf8Decoder = new TextDecoder("utf-8");
export function readUtf8(bytes: Uint8Array): string {
  return utf8Decoder.decode(bytes);
}

export function readU16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

export function readU32LE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset]! |
      (bytes[offset + 1]! << 8) |
      (bytes[offset + 2]! << 16) |
      (bytes[offset + 3]! << 24)) >>>
    0
  );
}

export function concatBytes(parts: Uint8Array[], total?: number): Uint8Array {
  const size = total ?? parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(size);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

export function indexOfBytes(
  haystack: Uint8Array,
  needle: Uint8Array,
  from = 0,
): number {
  outer: for (
    let i = Math.max(0, from);
    i <= haystack.length - needle.length;
    i++
  ) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

/**
 * Inflate with a hard output ceiling, streaming so the ceiling is enforced
 * BEFORE the memory is allocated. `fflate`'s one-shot form grows past a
 * pre-sized output buffer instead of refusing, which would let a crafted `.fig`
 * allocate gigabytes before any check could see it — the same reason the
 * Zstandard path is streamed.
 */
export function inflateCapped(
  bytes: Uint8Array,
  maxBytes: number,
  raw: boolean,
): Uint8Array {
  const parts: Uint8Array[] = [];
  let total = 0;
  const stream = new Inflate((chunk) => {
    total += chunk.length;
    if (total > maxBytes) {
      throw new Error("Decompressed .fig chunk is too large.");
    }
    parts.push(chunk);
  });
  // A zlib stream is a 2-byte header, the raw deflate body and a checksum;
  // fflate's Inflate reads raw deflate, so skip the header for the framed form.
  stream.push(raw ? bytes : bytes.subarray(2), true);
  return concatBytes(parts, total);
}

const utf8Encoder = new TextEncoder();
export function utf8ByteLength(text: string): number {
  return utf8Encoder.encode(text).length;
}

export function bytesToHexString(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

/**
 * Base64 without `Buffer`. Chunked because `String.fromCharCode(...bytes)`
 * blows the argument limit on anything megabyte-sized, which every embedded
 * `.fig` image is.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return typeof btoa === "function"
    ? btoa(binary)
    : Buffer.from(binary, "binary").toString("base64");
}

export function base64ToBytes(base64: string): Uint8Array {
  if (typeof atob !== "function")
    return new Uint8Array(Buffer.from(base64, "base64"));
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.length % 2 === 0 ? hex : hex.slice(0, hex.length - 1);
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function readU16BE(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset]! << 8) | bytes[offset + 1]!) >>> 0;
}

export function readU32BE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset]! << 24) |
      (bytes[offset + 1]! << 16) |
      (bytes[offset + 2]! << 8) |
      bytes[offset + 3]!) >>>
    0
  );
}

export function readF32LE(bytes: Uint8Array, offset: number): number {
  return new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ).getFloat32(offset, true);
}
