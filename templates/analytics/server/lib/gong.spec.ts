import { describe, expect, it } from "vitest";

import {
  buildGongSearchResult,
  gongSearchVariants,
  matchesGongCallQuery,
  type GongCall,
} from "./gong";
import {
  DEFAULT_GONG_CALL_LIMIT,
  MAX_GONG_CALL_LIMIT,
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
    expect(normalizeGongCallLimit(100)).toBe(100);
    expect(normalizeGongCallLimit(MAX_GONG_CALL_LIMIT + 1)).toBe(
      MAX_GONG_CALL_LIMIT,
    );
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

describe("Gong call search matching", () => {
  it("generates Fusion-style account variants from deal names and domains", () => {
    expect(gongSearchVariants("The Knot Worldwide - New Deal")).toEqual(
      expect.arrayContaining(["the knot worldwide", "the knot", "@the."]),
    );
    expect(gongSearchVariants("theknotww.com")).toEqual(
      expect.arrayContaining(["theknotww.com", "@theknotww.com"]),
    );
  });

  it("matches company queries across title, participant email, and stop-word-light terms", () => {
    const call = {
      id: "call-1",
      started: "2026-05-03T10:00:00Z",
      title: "Renewal with Knot Worldwide",
      parties: [
        {
          name: "Jane Buyer",
          emailAddress: "jane@theknot.com",
          affiliation: "External",
        },
      ],
    } satisfies GongCall;

    expect(matchesGongCallQuery(call, "The Knot")).toBe(true);
    expect(matchesGongCallQuery(call, "theknot.com")).toBe(true);
    expect(matchesGongCallQuery(call, "Jane Buyer")).toBe(true);
    expect(matchesGongCallQuery(call, "Unrelated Account")).toBe(false);
  });
});

describe("buildGongSearchResult", () => {
  const matched = [
    { id: "a", started: "2026-05-01T10:00:00Z" },
    { id: "b", started: "2026-05-03T10:00:00Z" },
    { id: "c", started: "2026-05-02T10:00:00Z" },
  ] as (GongCall & { matchedQueries?: string[] })[];

  it("caps to the newest `limit` and flags truncation when not exhaustive", () => {
    const result = buildGongSearchResult(matched, 2, {
      searchedCallCount: 50,
      queryCount: 1,
      cursor: "next-page",
      exhaustive: false,
    });

    expect(result.calls.map((c) => c.id)).toEqual(["b", "c"]);
    expect(result.truncated).toBe(true);
    expect(result.coverageTruncated).toBe(true);
    expect(result.matchedCallCount).toBe(3);
  });

  it("returns every match newest-first and untruncated when exhaustive", () => {
    const result = buildGongSearchResult(matched, 2, {
      searchedCallCount: 50,
      queryCount: 1,
      cursor: "next-page",
      exhaustive: true,
    });

    // All three returned despite limit=2 and a remaining cursor.
    expect(result.calls.map((c) => c.id)).toEqual(["b", "c", "a"]);
    expect(result.calls).toHaveLength(3);
    expect(result.limit).toBe(3);
    expect(result.truncated).toBe(false);
    expect(result.coverageTruncated).toBe(false);
    expect(result.matchedCallCount).toBe(3);
  });
});
