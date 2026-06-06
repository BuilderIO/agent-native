import { describe, expect, it } from "vitest";
import { resolvePlanIdFromCollabDocId } from "./plugins/collab.js";

/**
 * Plan collab docs are keyed `plan:${planId}:${blockId}`. The collab plugin
 * enforces access at the parent plan level, so the resolver must recover the
 * planId from the docId and reject anything that isn't a plan collab doc — a
 * bad id resolves to null → 404, never leaking across plans.
 */
describe("resolvePlanIdFromCollabDocId", () => {
  it("extracts the plan id from a per-block collab doc id", () => {
    expect(resolvePlanIdFromCollabDocId("plan:plan_abc:block_123")).toBe(
      "plan_abc",
    );
  });

  it("ignores extra colons in the block id segment", () => {
    expect(
      resolvePlanIdFromCollabDocId("plan:plan_abc:block:with:colons"),
    ).toBe("plan_abc");
  });

  it("supports a plan-level doc id with no block segment", () => {
    expect(resolvePlanIdFromCollabDocId("plan:plan_abc")).toBe("plan_abc");
  });

  it("returns null for a doc id missing the plan prefix", () => {
    expect(resolvePlanIdFromCollabDocId("document:abc:block")).toBeNull();
    expect(resolvePlanIdFromCollabDocId("plan_abc:block")).toBeNull();
  });

  it("returns null when the plan id segment is empty", () => {
    expect(resolvePlanIdFromCollabDocId("plan::block")).toBeNull();
    expect(resolvePlanIdFromCollabDocId("plan:")).toBeNull();
  });
});
