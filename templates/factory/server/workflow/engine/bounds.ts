import { utf8ByteLength } from "../items.js";

export const EVENT_SUMMARY_BYTES = 2048;

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const CUT_MARKER = "…[cut]";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Cuts at a character boundary and says so, so a bounded text never reads as the whole. */
export function fitText(text: string, maxBytes: number): string {
  if (utf8ByteLength(text) <= maxBytes) return text;
  const bytes = encoder.encode(text);
  let end = Math.max(0, maxBytes - utf8ByteLength(CUT_MARKER));
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end -= 1;
  return decoder.decode(bytes.slice(0, end)) + CUT_MARKER;
}

/** JSON text for a summary line; `undefined` has no JSON form and is said so. */
export function describeJson(value: unknown, maxBytes: number): string {
  const json = JSON.stringify(value);
  return fitText(json === undefined ? "(no value)" : json, maxBytes);
}

/**
 * Not cryptographic. Gives an id that is the same for the same text on every
 * run, so a synthetic item keeps its identity from one tick to the next.
 */
export function stableHash(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 =
    Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
    Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 =
    Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
    Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((entry, index) => deepEqual(entry, b[index]))
    );
  }
  if (isRecord(a) && isRecord(b)) {
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length &&
      keys.every(
        (key) =>
          Object.prototype.hasOwnProperty.call(b, key) &&
          deepEqual(a[key], b[key]),
      )
    );
  }
  return false;
}
