import { describe, expect, it } from "vitest";

import { buildLaunchDarklyContext } from "./context.js";

describe("buildLaunchDarklyContext", () => {
  it("builds an anonymous context when no identity is known", () => {
    expect(buildLaunchDarklyContext({})).toEqual({
      kind: "user",
      key: "anonymous",
      anonymous: true,
    });
  });

  it("builds an anonymous context for a null/blank email", () => {
    expect(buildLaunchDarklyContext({ userEmail: null })).toEqual({
      kind: "user",
      key: "anonymous",
      anonymous: true,
    });
    expect(buildLaunchDarklyContext({ userEmail: "   " })).toEqual({
      kind: "user",
      key: "anonymous",
      anonymous: true,
    });
  });

  it("keys a signed-in caller by normalized email", () => {
    expect(
      buildLaunchDarklyContext({ userEmail: "  Ada@Example.com  " }),
    ).toEqual({
      kind: "user",
      key: "ada@example.com",
      anonymous: false,
    });
  });

  it("carries orgId as a custom attribute when present", () => {
    expect(
      buildLaunchDarklyContext({
        userEmail: "ada@example.com",
        orgId: "org-1",
      }),
    ).toEqual({
      kind: "user",
      key: "ada@example.com",
      anonymous: false,
      orgId: "org-1",
    });
  });

  it("omits orgId when absent or null", () => {
    expect(
      buildLaunchDarklyContext({ userEmail: "ada@example.com", orgId: null }),
    ).toEqual({
      kind: "user",
      key: "ada@example.com",
      anonymous: false,
    });
  });
});
