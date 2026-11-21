import { describe, expect, it } from "vitest";

import { decide } from "./merge-main-into-pr.ts";

const state = (mergeable: string, mergeStateStatus: string) => ({
  mergeable,
  mergeStateStatus,
  headRefOid: "abc",
});

describe("merge-main-into-pr decide", () => {
  it("allows a conflicting PR", () => {
    expect(decide(state("CONFLICTING", "DIRTY"))).toEqual({ allowed: true });
  });

  it("allows a dirty merge state", () => {
    expect(decide(state("MERGEABLE", "DIRTY"))).toEqual({ allowed: true });
  });

  it("refuses a PR that is only behind main", () => {
    const d = decide(state("MERGEABLE", "BEHIND"));
    expect(d.allowed).toBe(false);
  });

  it("refuses a green or blocked PR with no conflict", () => {
    expect(decide(state("MERGEABLE", "CLEAN")).allowed).toBe(false);
    expect(decide(state("MERGEABLE", "BLOCKED")).allowed).toBe(false);
  });

  it("refuses while mergeability is unknown instead of guessing", () => {
    const d = decide(state("UNKNOWN", "UNKNOWN"));
    expect(d).toMatchObject({ allowed: false });
    expect(d.allowed === false && d.reason).toMatch(/UNKNOWN/);
  });
});
