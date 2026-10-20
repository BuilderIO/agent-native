import { describe, expect, it } from "vitest";

import { WorkflowError } from "./contract.js";
import {
  DEFAULT_ITEM_LIMITS,
  MAX_INLINE_ITEMS,
  MAX_STEP_OUTPUT_BYTES,
  assertWithinStepCap,
  boundItem,
  capInlineItems,
  jsonByteLength,
  normalizedItemSchema,
  stepOutputBytes,
  utf8ByteLength,
  type NormalizedItem,
} from "./items.js";

function item(overrides: Partial<NormalizedItem> = {}): NormalizedItem {
  return normalizedItemSchema.parse({
    id: "item-1",
    externalId: "1700000000.123",
    kind: "message",
    provider: "slack",
    title: "Export button does nothing",
    occurredAt: "2026-10-18T10:00:00Z",
    ...overrides,
  });
}

describe("normalizedItemSchema", () => {
  it("accepts a minimal item and defaults extras to an empty map", () => {
    expect(item().extras).toEqual({});
  });

  it("accepts a full item", () => {
    const full = normalizedItemSchema.safeParse({
      id: "item-2",
      externalId: "abc",
      kind: "pull_request",
      provider: "github",
      title: "Fix export",
      text: "Body",
      textRef: "blob:transcripts/abc",
      url: "https://example.test/pull/7",
      author: "someone@example.test",
      occurredAt: "2026-10-18T10:00:00+02:00",
      thread: { repo: "example-org/example-repo", number: 7 },
      extras: { labels: ["bug"] },
      payload: { number: 7 },
      payloadTruncated: false,
    });
    expect(full.success).toBe(true);
  });

  it("rejects what a downstream node could not trust", () => {
    const bad = (overrides: Record<string, unknown>) =>
      normalizedItemSchema.safeParse({
        id: "i",
        externalId: "e",
        kind: "message",
        provider: "slack",
        title: "t",
        occurredAt: "2026-10-18T10:00:00Z",
        ...overrides,
      }).success;
    expect(bad({})).toBe(true);
    expect(bad({ kind: "invoice" })).toBe(false);
    expect(bad({ title: "" })).toBe(false);
    expect(bad({ externalId: "" })).toBe(false);
    expect(bad({ occurredAt: "yesterday" })).toBe(false);
    expect(bad({ url: "javascript:alert(1)" })).toBe(false);
    expect(bad({ url: "not a url" })).toBe(false);
    expect(bad({ url: "http://example.test/a" })).toBe(true);
    expect(bad({ thread: { number: 1.5 } })).toBe(false);
    expect(bad({ surprise: true })).toBe(false);
  });
});

describe("byte helpers", () => {
  it("counts UTF-8 bytes, not characters", () => {
    expect(utf8ByteLength("abc")).toBe(3);
    expect(utf8ByteLength("é")).toBe(2);
    expect(utf8ByteLength("中")).toBe(3);
    expect(utf8ByteLength("\u{1F600}")).toBe(4);
  });

  it("sizes a value by its JSON form", () => {
    expect(jsonByteLength({ a: 1 })).toBe(7);
    expect(jsonByteLength("é")).toBe(4);
    expect(stepOutputBytes([{ a: 1 }, { a: 2 }])).toBe(
      jsonByteLength([{ a: 1 }, { a: 2 }]),
    );
  });

  it("refuses to size a value that has no JSON form", () => {
    expect(() => jsonByteLength(undefined)).toThrow(TypeError);
    expect(() => jsonByteLength(() => 1)).toThrow(TypeError);
    expect(() => jsonByteLength({ big: 10n })).toThrow(TypeError);
  });
});

describe("boundItem", () => {
  const limits = { maxTextBytes: 20, maxPayloadBytes: 60 };

  it("leaves a small item as it was and says nothing was cut", () => {
    const small = item({ text: "short", payload: { a: 1 } });
    const bounded = boundItem(small, limits);
    expect(bounded.text).toBe("short");
    expect(bounded.payload).toEqual({ a: 1 });
    expect(bounded.textTruncated).toBe(false);
    expect(bounded.payloadTruncated).toBe(false);
  });

  it("sets no flag for a field the item does not have", () => {
    const bounded = boundItem(item(), limits);
    expect(bounded.textTruncated).toBeUndefined();
    expect(bounded.payloadTruncated).toBeUndefined();
    expect("text" in bounded).toBe(false);
    expect("payload" in bounded).toBe(false);
  });

  it("trims long text to the byte limit and flags it", () => {
    const bounded = boundItem(item({ text: "x".repeat(100) }), limits);
    expect(bounded.text).toBe("x".repeat(20));
    expect(bounded.textTruncated).toBe(true);
  });

  it("never cuts inside a multi-byte character", () => {
    const text = "中".repeat(10);
    const bounded = boundItem(item({ text }), { ...limits, maxTextBytes: 10 });
    expect(bounded.text).toBe("中".repeat(3));
    expect(utf8ByteLength(bounded.text ?? "")).toBeLessThanOrEqual(10);
    expect(bounded.textTruncated).toBe(true);
    const emoji = boundItem(item({ text: "\u{1F600}".repeat(5) }), {
      ...limits,
      maxTextBytes: 6,
    });
    expect(emoji.text).toBe("\u{1F600}");
  });

  it("flags payloadTruncated explicitly when the payload is over its limit", () => {
    const payload = {
      first: "a".repeat(10),
      second: "b".repeat(200),
      third: 3,
    };
    const bounded = boundItem(item({ payload }), limits);
    expect(bounded.payloadTruncated).toBe(true);
    expect(jsonByteLength(bounded.payload)).toBeLessThanOrEqual(60);
  });

  it("keeps the keys that fit whole, in order, and drops the rest", () => {
    const payload = {
      first: "a".repeat(10),
      second: "b".repeat(200),
      third: 3,
    };
    const bounded = boundItem(item({ payload }), limits);
    expect(bounded.payload).toEqual({ first: "a".repeat(10), third: 3 });
  });

  it("keeps the leading elements of an array payload that fit", () => {
    const payload = Array.from({ length: 50 }, (_, index) => `entry-${index}`);
    const bounded = boundItem(item({ payload }), limits);
    const kept = bounded.payload as string[];
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.length).toBeLessThan(50);
    expect(kept).toEqual(payload.slice(0, kept.length));
    expect(jsonByteLength(kept)).toBeLessThanOrEqual(60);
    expect(bounded.payloadTruncated).toBe(true);
  });

  it("shortens a string payload so its JSON form fits, escapes included", () => {
    const payload = '"'.repeat(100);
    const bounded = boundItem(item({ payload }), limits);
    expect(typeof bounded.payload).toBe("string");
    expect(jsonByteLength(bounded.payload)).toBeLessThanOrEqual(60);
    expect(bounded.payloadTruncated).toBe(true);
  });

  it("drops the payload, and says so, when not even an empty container fits", () => {
    const bounded = boundItem(item({ payload: { a: "b".repeat(50) } }), {
      ...limits,
      maxPayloadBytes: 1,
    });
    expect(bounded.payload).toBeUndefined();
    expect(bounded.payloadTruncated).toBe(true);
  });

  it("keeps a flag that an earlier step already set", () => {
    const bounded = boundItem(
      item({
        text: "short",
        textTruncated: true,
        payload: { a: 1 },
        payloadTruncated: true,
      }),
      limits,
    );
    expect(bounded.textTruncated).toBe(true);
    expect(bounded.payloadTruncated).toBe(true);
  });

  it("returns a new item and leaves the input alone", () => {
    const original = item({
      text: "x".repeat(100),
      payload: { a: "b".repeat(200) },
    });
    const snapshot = JSON.stringify(original);
    const bounded = boundItem(original, limits);
    expect(bounded).not.toBe(original);
    expect(JSON.stringify(original)).toBe(snapshot);
  });

  it("applies defaults when no limits are given", () => {
    const bounded = boundItem(
      item({ text: "x".repeat(DEFAULT_ITEM_LIMITS.maxTextBytes + 1) }),
    );
    expect(utf8ByteLength(bounded.text ?? "")).toBe(
      DEFAULT_ITEM_LIMITS.maxTextBytes,
    );
    expect(bounded.textTruncated).toBe(true);
  });
});

describe("capInlineItems", () => {
  it("returns everything when there are no more than the cap", () => {
    const result = capInlineItems([1, 2, 3], 3);
    expect(result).toEqual({
      items: [1, 2, 3],
      truncated: false,
      totalAvailable: 3,
    });
  });

  it("returns the first items and records that it cut and how many existed", () => {
    const all = Array.from({ length: 340 }, (_, index) => index);
    const result = capInlineItems(all);
    expect(result.items).toHaveLength(MAX_INLINE_ITEMS);
    expect(result.items[0]).toBe(0);
    expect(result.truncated).toBe(true);
    expect(result.totalAvailable).toBe(340);
  });
});

describe("assertWithinStepCap", () => {
  it("passes at the limits", () => {
    expect(() =>
      assertWithinStepCap(Array.from({ length: MAX_INLINE_ITEMS }, () => 1)),
    ).not.toThrow();
    expect(() => assertWithinStepCap([])).not.toThrow();
  });

  it("throws output_over_cap for too many items", () => {
    const items = Array.from({ length: MAX_INLINE_ITEMS + 1 }, () => 1);
    let caught: unknown;
    try {
      assertWithinStepCap(items);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(WorkflowError);
    expect(caught).toMatchObject({
      code: "output_over_cap",
      details: { items: MAX_INLINE_ITEMS + 1, maxItems: MAX_INLINE_ITEMS },
    });
  });

  it("throws output_over_cap for too many bytes", () => {
    const items = [{ blob: "x".repeat(MAX_STEP_OUTPUT_BYTES) }];
    let caught: unknown;
    try {
      assertWithinStepCap(items);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(WorkflowError);
    expect((caught as WorkflowError).code).toBe("output_over_cap");
    expect((caught as WorkflowError).details?.bytes).toBe(
      stepOutputBytes(items),
    );
  });

  it("accepts exactly the byte cap and rejects one byte more", () => {
    const overhead = stepOutputBytes([{ blob: "" }]);
    const exact = [{ blob: "x".repeat(MAX_STEP_OUTPUT_BYTES - overhead) }];
    expect(stepOutputBytes(exact)).toBe(MAX_STEP_OUTPUT_BYTES);
    expect(() => assertWithinStepCap(exact)).not.toThrow();
    const over = [{ blob: "x".repeat(MAX_STEP_OUTPUT_BYTES - overhead + 1) }];
    expect(() => assertWithinStepCap(over)).toThrow(WorkflowError);
  });

  it("measures bytes, so multi-byte text counts for what it weighs", () => {
    const items = [{ blob: "中".repeat(MAX_STEP_OUTPUT_BYTES / 3) }];
    expect(() => assertWithinStepCap(items)).toThrow(WorkflowError);
  });

  it("honours caps passed in, and never changes the list", () => {
    const items = [1, 2, 3];
    expect(() => assertWithinStepCap(items, { maxItems: 2 })).toThrow(
      WorkflowError,
    );
    expect(() => assertWithinStepCap(items, { maxBytes: 4 })).toThrow(
      WorkflowError,
    );
    expect(() =>
      assertWithinStepCap(items, { maxItems: 3, maxBytes: 7 }),
    ).not.toThrow();
    expect(items).toEqual([1, 2, 3]);
  });
});
