import { describe, expect, it } from "vitest";

import { resolvePlanIdFromCollabDocId } from "./plugins/collab.js";

describe("resolvePlanIdFromCollabDocId — adversarial", () => {
  it("rejects a non-plan prefix and a bare id (fails closed → 404)", () => {
    expect(resolvePlanIdFromCollabDocId("")).toBeNull();
    expect(resolvePlanIdFromCollabDocId("plan")).toBeNull();
    expect(resolvePlanIdFromCollabDocId("planx:abc")).toBeNull();
    expect(resolvePlanIdFromCollabDocId("Plan:abc")).toBeNull();
    expect(resolvePlanIdFromCollabDocId(":abc")).toBeNull();
  });

  it("rejects an all-whitespace plan segment", () => {
    expect(resolvePlanIdFromCollabDocId("plan: :block")).toBeNull();
    expect(resolvePlanIdFromCollabDocId("plan:\t\n :block")).toBeNull();
    expect(resolvePlanIdFromCollabDocId("plan:   ")).toBeNull();
  });

  it("does not decode a percent-encoded colon (no id collapsing)", () => {
    expect(resolvePlanIdFromCollabDocId("plan:abc%3Aevil:block")).toBe(
      "abc%3Aevil",
    );
  });

  it("treats a nested plan: prefix as a literal plan id segment, not recursion", () => {
    expect(resolvePlanIdFromCollabDocId("plan:plan:nested:block")).toBe("plan");
  });

  it("returns a whitespace-padded plan id VERBATIM (fails closed, never widens access)", () => {
    // Documents a minor contract divergence: the resolver guards on
    // `planId.trim()` being truthy but RETURNS the UN-trimmed segment. Per the
    // `plan:${planId}:${blockId}` contract the planId never carries whitespace
    // (ids are generated, the docId is built from a loaded plan), so this is
    // effectively unreachable. Critically it can only fail CLOSED: a padded id
    // like " abc" won't match the real "abc" row → resolveAccess returns null →
    // 404. It can never collapse to or match a DIFFERENT plan, so it is not an
    // access-scope leak. Asserting the actual behavior so a future change that
    // makes it trim (or, worse, decode) is caught.
    expect(resolvePlanIdFromCollabDocId("plan: abc:block")).toBe(" abc");
    expect(resolvePlanIdFromCollabDocId("plan:abc :block")).toBe("abc ");
    expect(resolvePlanIdFromCollabDocId("plan:\tabc")).toBe("\tabc");
  });
});
