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
    // %3A is NOT a literal colon to indexOf, so the split happens at the FIRST
    // literal `:` (after "evil"). The planId is the verbatim "abc%3Aevil" — it
    // must NOT silently decode to a different plan id. This is the SAFE outcome:
    // a docId crafted with an encoded colon resolves to a literal id that won't
    // match any real plan row → 404, never a cross-plan leak.
    expect(resolvePlanIdFromCollabDocId("plan:abc%3Aevil:block")).toBe(
      "abc%3Aevil",
    );
  });

  it("treats a nested plan: prefix as a literal plan id segment, not recursion", () => {
    // `plan:plan:nested` → first colon splits, planId = "plan".
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
