import { describe, expect, it } from "vitest";

import { applySuggestedEdit, assertSuggestedEditTarget, suggestedEditDigest } from "./suggested-edits.js";

describe("Content suggested edit adapter", () => {
  it("keeps exact-base application canonical and digestable", () => {
    const body = "Hello world";
    const result = applySuggestedEdit({ body, source: "canonical" }, { operation: "replace", before: "world", after: "Content" }, suggestedEditDigest(body));
    expect(result).toEqual({ state: "applied", body: "Hello Content" });
  });

  it("rebases only unique context and reports stale/conflict otherwise", () => {
    const edit = { operation: "replace" as const, before: "world", after: "Content" };
    expect(applySuggestedEdit({ body: "Hello world" }, edit, "old").state).toBe("applied");
    expect(applySuggestedEdit({ body: "Hello there" }, edit, "old").state).toBe("stale");
    expect(applySuggestedEdit({ body: "world and world" }, edit, "old").state).toBe("conflict");
  });

  it("fails closed for source-owned, locked, or unsupported targets", () => {
    expect(() => assertSuggestedEditTarget({ body: "x", source: "local-file" })).toThrow();
    expect(() => assertSuggestedEditTarget({ body: "x", locked: true })).toThrow();
    expect(() => assertSuggestedEditTarget({ body: "x", unsupported: true })).toThrow();
  });
});
