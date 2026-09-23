import { describe, expect, it } from "vitest";

import { buildLaunchDarklyContext } from "./context.js";

describe("buildLaunchDarklyContext", () => {
  it("builds an anonymous context when no identity is known", () => {
    expect(buildLaunchDarklyContext({})).toEqual({
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

  it("keys a signed-in caller by normalized email and carries orgId", () => {
    expect(
      buildLaunchDarklyContext({ userEmail: "  Ada@Example.com  " }),
    ).toEqual({
      kind: "user",
      key: "ada@example.com",
      anonymous: false,
    });
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
});
