import { describe, expect, it } from "vitest";

import { declaresFeatureFlagDelegation } from "./a2a-action-route.js";

function unsignedJwt(payload: Record<string, unknown>): string {
  const encode = (value: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none" })}.${encode(payload)}.signature`;
}

describe("declaresFeatureFlagDelegation", () => {
  it("owns only tokens that declare a feature-flag scope", () => {
    expect(
      declaresFeatureFlagDelegation(
        unsignedJwt({ scope: "openid flags:read profile" }),
      ),
    ).toBe(true);
    expect(
      declaresFeatureFlagDelegation(unsignedJwt({ scope: ["flags:write"] })),
    ).toBe(true);
  });

  it("leaves ordinary JWT identity claims to the normal auth chain", () => {
    expect(
      declaresFeatureFlagDelegation(
        unsignedJwt({ org_id: "org-1", jti: "session-1", scope: "openid" }),
      ),
    ).toBe(false);
  });

  it("does not claim opaque bearer tokens", () => {
    expect(declaresFeatureFlagDelegation("opaque-token")).toBe(false);
  });
});
