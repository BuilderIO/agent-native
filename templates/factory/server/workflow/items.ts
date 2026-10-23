import { z } from "zod";

import { WorkflowError, threadRefSchema } from "./contract.js";

export const MAX_INLINE_ITEMS = 100;
export const MAX_STEP_OUTPUT_BYTES = 64 * 1024;
export const MAX_ITEM_CONTEXT_BYTES = 8 * 1024;
/** What one row's `extras` may hold in all, recorded values included. */
export const MAX_ROW_EXTRAS_BYTES = 8 * 1024;

const ITEM_KINDS = [
  "message",
  "issue",
  "pull_request",
  "commit",
  "call",
  "lead",
  "ticket",
  "alert",
  "error",
  "spike",
] as const;
export const itemKindSchema = z.enum(ITEM_KINDS);
export type ItemKind = z.infer<typeof itemKindSchema>;

function isHttpUrl(value: string): boolean {
  if (!URL.canParse(value)) return false;
  const { protocol } = new URL(value);
  return protocol === "http:" || protocol === "https:";
}

export const normalizedItemSchema = z.strictObject({
  id: z.string().min(1).max(200),
  externalId: z.string().min(1).max(200),
  kind: itemKindSchema,
  provider: z.string().min(1).max(60),
  title: z.string().min(1).max(1000),
  text: z.string().optional(),
  textTruncated: z.boolean().optional(),
  // Handle to a large body kept in blob storage, never the body itself.
  textRef: z.string().min(1).max(500).optional(),
  url: z.string().max(2048).refine(isHttpUrl, "use an http(s) URL").optional(),
  author: z.string().min(1).max(200).optional(),
  occurredAt: z.iso.datetime({ offset: true }),
  thread: threadRefSchema.optional(),
  extras: z.record(z.string(), z.unknown()).default({}),
  payload: z.unknown().optional(),
  payloadTruncated: z.boolean().optional(),
});
export type NormalizedItem = z.infer<typeof normalizedItemSchema>;

interface ItemLimits {
  maxTextBytes: number;
  maxPayloadBytes: number;
}

export const DEFAULT_ITEM_LIMITS: ItemLimits = {
  maxTextBytes: 2048,
  maxPayloadBytes: 2048,
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function utf8ByteLength(text: string): number {
  return encoder.encode(text).length;
}

export function jsonByteLength(value: unknown): number {
  const json = JSON.stringify(value);
  if (json === undefined) {
    throw new TypeError("Value has no JSON form, so it has no byte size.");
  }
  return utf8ByteLength(json);
}

export function stepOutputBytes(items: readonly unknown[]): number {
  return jsonByteLength(items);
}

/** Cuts at a character boundary, never inside a multi-byte sequence. */
function truncateUtf8(text: string, maxBytes: number): string {
  const bytes = encoder.encode(text);
  if (bytes.length <= maxBytes) return text;
  let end = Math.max(0, maxBytes);
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end -= 1;
  return decoder.decode(bytes.slice(0, end));
}

function fitString(value: string, maxBytes: number): string {
  let budget = maxBytes - 2;
  let candidate = truncateUtf8(value, budget);
  while (budget > 0 && jsonByteLength(candidate) > maxBytes) {
    budget -= jsonByteLength(candidate) - maxBytes;
    candidate = truncateUtf8(value, Math.max(0, budget));
  }
  return candidate;
}

function jsonSize(value: unknown): number {
  return jsonByteLength(value === undefined ? null : value);
}

/**
 * Keeps whatever fits whole: leading array elements, or the object keys that
 * fit in order. Returns `undefined` when not even an empty container fits.
 */
function trimJson(value: unknown, maxBytes: number): unknown {
  if (maxBytes < 2) return undefined;
  if (typeof value === "string") return fitString(value, maxBytes);
  if (Array.isArray(value)) {
    const kept: unknown[] = [];
    let used = 2;
    for (const element of value) {
      const cost = jsonSize(element) + (kept.length > 0 ? 1 : 0);
      if (used + cost > maxBytes) break;
      kept.push(element);
      used += cost;
    }
    return kept;
  }
  if (typeof value === "object" && value !== null) {
    const kept: Record<string, unknown> = {};
    let used = 2;
    let count = 0;
    for (const [key, entry] of Object.entries(value)) {
      if (entry === undefined) continue;
      const cost = jsonSize(key) + 1 + jsonSize(entry) + (count > 0 ? 1 : 0);
      if (used + cost > maxBytes) continue;
      kept[key] = entry;
      used += cost;
      count += 1;
    }
    return kept;
  }
  return jsonByteLength(value) <= maxBytes ? value : undefined;
}

/**
 * Bounds `text` and `payload` and says so: `textTruncated` and
 * `payloadTruncated` are set whenever either field is present, true when
 * anything was cut or was already cut upstream.
 */
export function boundItem(
  item: NormalizedItem,
  limits: ItemLimits = DEFAULT_ITEM_LIMITS,
): NormalizedItem {
  const bounded: NormalizedItem = { ...item };
  if (item.text !== undefined) {
    const text = truncateUtf8(item.text, limits.maxTextBytes);
    bounded.text = text;
    bounded.textTruncated =
      item.textTruncated === true || text.length < item.text.length;
  }
  if (item.payload !== undefined) {
    const overLimit = jsonByteLength(item.payload) > limits.maxPayloadBytes;
    if (overLimit)
      bounded.payload = trimJson(item.payload, limits.maxPayloadBytes);
    bounded.payloadTruncated = item.payloadTruncated === true || overLimit;
  }
  return bounded;
}

/** The recorded way to take fewer items than a source had: the caller keeps `truncated` and `totalAvailable` on the step. */
export function capInlineItems<T>(
  items: readonly T[],
  max: number = MAX_INLINE_ITEMS,
): { items: T[]; truncated: boolean; totalAvailable: number } {
  return {
    items: items.slice(0, max),
    truncated: items.length > max,
    totalAvailable: items.length,
  };
}

/** Fails the step instead of dropping items or bytes to fit. */
export function assertWithinStepCap(
  items: readonly unknown[],
  caps: { maxItems?: number; maxBytes?: number } = {},
): void {
  const maxItems = caps.maxItems ?? MAX_INLINE_ITEMS;
  const maxBytes = caps.maxBytes ?? MAX_STEP_OUTPUT_BYTES;
  const bytes = stepOutputBytes(items);
  if (items.length > maxItems || bytes > maxBytes) {
    throw new WorkflowError(
      "output_over_cap",
      `Step output is ${items.length} items and ${bytes} bytes; the cap is ${maxItems} items and ${maxBytes} bytes.`,
      { items: items.length, bytes, maxItems, maxBytes },
    );
  }
}
