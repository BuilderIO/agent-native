import { describe, expect, it } from "vitest";

import { privateActionScopeMatches } from "./private-action-scope.js";
const actual = {
  email: "actor@example.test",
  orgId: "org-test",
  authUserId: "auth-test",
};
const expected = { ...actual };
describe("private action scope input", () => {
  it.each([
    "{",
    "null",
    "[]",
    "{}",
    JSON.stringify({ ...expected, orgId: undefined }),
    JSON.stringify({ ...expected, authUserId: "" }),
    JSON.stringify({ ...expected, extra: "test-value" }),
    " ".repeat(4097),
  ])("refuses malformed or unknown scope %s", (header) => {
    expect(privateActionScopeMatches(header, actual)).toBe(false);
  });
  it("matches normalized identity without granting missing authority", () => {
    const header = JSON.stringify({
      email: " Actor@Example.Test ",
      orgId: " org-test ",
      authUserId: " auth-test ",
    });
    expect(privateActionScopeMatches(header, actual)).toBe(true);
    expect(
      privateActionScopeMatches(header, { ...actual, authUserId: undefined }),
    ).toBe(false);
  });
  it("requires confirmed personal authority, not an unresolved organization", () => {
    const header = JSON.stringify({ ...expected, orgId: null });
    expect(
      privateActionScopeMatches(header, { ...actual, orgId: undefined }),
    ).toBe(false);
    expect(privateActionScopeMatches(header, { ...actual, orgId: null })).toBe(
      true,
    );
  });
  it("limits even valid JSON that would otherwise match authority", () => {
    const scope = { ...actual, email: "a".repeat(4096) + "@example.test" };
    expect(privateActionScopeMatches(JSON.stringify(scope), scope)).toBe(false);
  });
});
