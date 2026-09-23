import { describe, expect, it } from "vitest";

import { buildLaunchDarklyContext } from "./context.js";

describe("buildLaunchDarklyContext", () => {
  it("falls back to one shared anonymous bucket when no identity is known", () => {
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

  it("keys an unauthenticated caller by its own anonymousId when given one", () => {
    expect(buildLaunchDarklyContext({ anonymousId: "device-123" })).toEqual({
      kind: "user",
      key: "device-123",
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
