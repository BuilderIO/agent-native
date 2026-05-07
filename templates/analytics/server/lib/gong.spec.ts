import { describe, expect, it } from "vitest";
import {
  DEFAULT_GONG_CALL_LIMIT,
  limitGongCalls,
  normalizeGongCallLimit,
  type GongCallLike,
} from "./gong-limits";

function call(id: string, started: string): GongCallLike {
  return { id, started };
}

describe("Gong call limits", () => {
  it("defaults to a small analysis batch", () => {
    expect(normalizeGongCallLimit(undefined)).toBe(DEFAULT_GONG_CALL_LIMIT);
    expect(normalizeGongCallLimit(Number.NaN)).toBe(DEFAULT_GONG_CALL_LIMIT);
  });

  it("clamps explicit limits to the supported range", () => {
    expect(normalizeGongCallLimit(0)).toBe(1);
    expect(normalizeGongCallLimit(100)).toBe(25);
    expect(normalizeGongCallLimit(7.9)).toBe(7);
  });

  it("returns the newest calls first and reports truncation", () => {
    const result = limitGongCalls(
      [
        call("old", "2026-05-01T10:00:00Z"),
        call("new", "2026-05-03T10:00:00Z"),
        call("middle", "2026-05-02T10:00:00Z"),
      ],
      2,
    );

    expect(result.calls.map((c) => c.id)).toEqual(["new", "middle"]);
    expect(result.limit).toBe(2);
    expect(result.truncated).toBe(true);
  });
});
