import { describe, expect, it } from "vitest";

import { resolvePlanIdFromCollabDocId } from "./plugins/collab.js";

describe("resolvePlanIdFromCollabDocId", () => {
  it("extracts the plan id from a per-block collab doc id", () => {
    expect(resolvePlanIdFromCollabDocId("plan:plan-abc:block-123")).toBe(
      "plan-abc",
    );
  });

  it("ignores extra colons in the block id segment", () => {
    expect(
      resolvePlanIdFromCollabDocId("plan:plan-abc:block:with:colons"),
    ).toBe("plan-abc");
  });

  it("supports a plan-level doc id with no block segment", () => {
    expect(resolvePlanIdFromCollabDocId("plan:plan-abc")).toBe("plan-abc");
  });

  it("keeps legacy underscore plan ids valid", () => {
    expect(resolvePlanIdFromCollabDocId("plan:plan_abc:block_123")).toBe(
      "plan_abc",
    );
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
