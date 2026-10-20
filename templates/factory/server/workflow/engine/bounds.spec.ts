import { describe, expect, it } from "vitest";

import { utf8ByteLength } from "../items.js";
import { deepEqual, describeJson, fitText, stableHash } from "./bounds.js";

describe("fitText", () => {
  it("leaves text that fits alone", () => {
    expect(fitText("short", 100)).toBe("short");
  });

  it("cuts to the byte limit and marks the cut", () => {
    const cut = fitText("x".repeat(500), 100);
    expect(utf8ByteLength(cut)).toBeLessThanOrEqual(100);
    expect(cut.endsWith("…[cut]")).toBe(true);
  });

  it("never cuts inside a multi-byte character", () => {
    const cut = fitText("é".repeat(200), 101);
    expect(utf8ByteLength(cut)).toBeLessThanOrEqual(101);
    expect(cut).not.toContain("�");
  });
});

describe("describeJson", () => {
  it("writes JSON, bounded, and names a value with no JSON form", () => {
    expect(describeJson({ a: 1 }, 100)).toBe('{"a":1}');
    expect(describeJson(undefined, 100)).toBe("(no value)");
    expect(
      utf8ByteLength(describeJson({ a: "y".repeat(500) }, 50)),
    ).toBeLessThanOrEqual(50);
  });
});

describe("stableHash", () => {
  it("is the same for the same text and different for different text", () => {
    expect(stableHash("task-1")).toBe(stableHash("task-1"));
    expect(stableHash("task-1")).not.toBe(stableHash("task-2"));
    expect(stableHash("")).toMatch(/^[0-9a-f]+$/);
  });
});

describe("deepEqual", () => {
  it("compares JSON by value", () => {
    expect(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(deepEqual([1, 2], [1, 2, 3])).toBe(false);
    expect(deepEqual([], {})).toBe(false);
    expect(deepEqual(null, {})).toBe(false);
    expect(deepEqual(1, "1")).toBe(false);
  });
});
