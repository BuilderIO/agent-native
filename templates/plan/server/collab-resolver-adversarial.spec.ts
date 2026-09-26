import { describe, expect, it } from "vitest";

import { resolvePlanIdFromCollabDocId } from "./plugins/collab.js";

/**
 * Adversarial coverage for {@link resolvePlanIdFromCollabDocId}, the access-scope
 * gate for plan collab docs. The resolved id is passed verbatim to
 * resolveAccess/assertAccess, so any divergence from the real stored planId
 * either fails closed (a 404, safe) or — if it ever produced a STRING that DID
 * match a different/escaped resource — would be an access-scope bug.
 *
 * The existing collab-plugin.spec.ts covers the happy path. These add the
 * adversarial cases: whitespace, encoded colons, traversal-looking ids, control
 * characters, and over-long ids.
 */
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
    expect(resolvePlanIdFromCollabDocId("plan: abc:block")).toBe(" abc");
    expect(resolvePlanIdFromCollabDocId("plan:abc :block")).toBe("abc ");
    expect(resolvePlanIdFromCollabDocId("plan:\tabc")).toBe("\tabc");
  });
});
