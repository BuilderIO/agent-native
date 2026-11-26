import { describe, expect, it, vi } from "vitest";

vi.mock("../action.js", () => ({
  fail: (message: string, options?: { statusCode?: number }) => {
    throw Object.assign(new Error(message), options);
  },
}));

const { labsCaller } = await import("./caller.js");

describe("labsCaller", () => {
  it("returns the user and scopes to their org", () => {
    expect(labsCaller({ userEmail: "a@example.com", orgId: "org-1" })).toEqual({
      email: "a@example.com",
      scope: { orgId: "org-1" },
    });
  });

  it("omits the org when there is none", () => {
    expect(labsCaller({ userEmail: "a@example.com", orgId: null })).toEqual({
      email: "a@example.com",
      scope: {},
    });
  });

  it.each([undefined, null, {}, { userEmail: null }])(
    "refuses %j with 401",
    (ctx) => {
      expect(() => labsCaller(ctx)).toThrow("Not authenticated.");
    },
  );
});
