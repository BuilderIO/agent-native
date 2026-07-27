/**
 * Unit tests for pure logic extracted from GradientEditor (IP21):
 *
 *  1. `parseStopPositionDraft` — the stop-position input buffers a draft and
 *     only commits a valid, clamped 0–100 number; empty/invalid drafts
 *     signal a revert instead of silently committing 0/NaN.
 *  2. `nearestStopId` — after deleting a stop, selection should jump to the
 *     nearest remaining neighbor by position, not always the leftmost stop.
 */

import { describe, expect, it } from "vitest";

import {
  type GradientStopValue,
  nearestStopId,
  parseStopPositionDraft,
} from "./GradientEditor";

describe("parseStopPositionDraft", () => {
  it("parses ordinary numeric drafts and clamps to 0-100", () => {
    expect(parseStopPositionDraft("50")).toBe(50);
    expect(parseStopPositionDraft("150")).toBe(100);
    expect(parseStopPositionDraft("-10")).toBe(0);
  });

  it("returns null (revert) for an emptied draft", () => {
    expect(parseStopPositionDraft("")).toBeNull();
    expect(parseStopPositionDraft("   ")).toBeNull();
  });

  it("returns null for non-numeric drafts", () => {
    expect(parseStopPositionDraft("abc")).toBeNull();
  });

  it("returns 0 only when the draft explicitly says 0", () => {
    expect(parseStopPositionDraft("0")).toBe(0);
  });
});

describe("nearestStopId", () => {
  const stops: GradientStopValue[] = [
    { id: "left", color: "#000", position: 0 },
    { id: "mid", color: "#888", position: 50 },
    { id: "right", color: "#fff", position: 100 },
  ];

  it("selects the nearest remaining stop to the removed position, not the leftmost", () => {
    // Deleting the rightmost stop should select "mid" (nearest), not "left"
    // (the old, buggy leftmost-always behavior).
    const remaining = stops.filter((s) => s.id !== "right");
    expect(nearestStopId(remaining, 100)).toBe("mid");
  });

  it("selects the nearest stop when deleting a middle stop between two others", () => {
    const remaining = stops.filter((s) => s.id !== "mid");
    // Removed position 50 is equidistant (50) from both "left" (0) and
    // "right" (100); ties break to the first matching stop in array order.
    expect(nearestStopId(remaining, 50)).toBe("left");
  });

  it("picks whichever neighbor is closer when distances differ", () => {
    const custom: GradientStopValue[] = [
      { id: "a", color: "#000", position: 10 },
      { id: "b", color: "#fff", position: 90 },
    ];
    // Removed stop was at position 80 — "b" (90) is closer than "a" (10).
    expect(nearestStopId(custom, 80)).toBe("b");
  });

  it("returns null when no stops remain", () => {
    expect(nearestStopId([], 50)).toBeNull();
  });

  it("falls back to the leftmost stop when no removed position is known", () => {
    const remaining = stops.filter((s) => s.id !== "mid");
    expect(nearestStopId(remaining, undefined)).toBe("left");
  });
});
