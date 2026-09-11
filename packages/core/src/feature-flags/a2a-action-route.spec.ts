import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("h3", () => ({
  getHeader: (_event: unknown, name: string) =>
    name === "authorization"
      ? "Bearer eyJhbGciOiJub25lIn0.eyJzY29wZSI6ImZsYWdzOndyaXRlIn0.signature"
      : undefined,
}));

const verifyA2ATokenWithClaimsMock = vi.fn();
vi.mock("../a2a-claims.js", () => ({
  verifyA2ATokenWithClaims: (...args: unknown[]) =>
    verifyA2ATokenWithClaimsMock(...args),
}));
const resolveOrgByDomainMock = vi.fn();
vi.mock("../org/context.js", () => ({
  resolveOrgByDomain: (...args: unknown[]) => resolveOrgByDomainMock(...args),
}));
const consumeOneTimeJtiMock = vi.fn();
vi.mock("../server/identity-sso-store.js", () => ({
  consumeOneTimeJti: (...args: unknown[]) => consumeOneTimeJtiMock(...args),
}));

import {
  createFeatureFlagA2AActionRouteAuth,
  declaresFeatureFlagDelegation,
} from "./a2a-action-route.js";

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.AGENT_NATIVE_FEATURE_FLAG_ADMIN_EMAILS;
  verifyA2ATokenWithClaimsMock.mockResolvedValue({
    email: "admin@example.com",
    orgDomain: "builder.io",
    scope: ["flags:write"],
    jti: "mutation-1",
    issuer: "analytics",
  });
  resolveOrgByDomainMock.mockResolvedValue({ orgId: "org-local" });
  consumeOneTimeJtiMock.mockResolvedValue(false);
});

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

describe("feature flag mutation replay protection", () => {
  const event = {} as any;

  it("consumes the delegated mutation jti before authorizing", async () => {
    const auth = createFeatureFlagA2AActionRouteAuth("set-feature-flag");

    await expect(auth.resolveCaller(event)).resolves.toEqual(
      expect.objectContaining({
        orgId: "org-local",
        delegationJti: "mutation-1",
      }),
    );
    expect(consumeOneTimeJtiMock).toHaveBeenCalledWith("mutation-1");
  });

  it("rejects a replayed delegated mutation jti", async () => {
    consumeOneTimeJtiMock.mockResolvedValue(true);
    const auth = createFeatureFlagA2AActionRouteAuth("set-feature-flag");

    await expect(auth.resolveCaller(event)).rejects.toThrow(
      "Invalid feature flag delegation",
    );
  });

  it("does not consume read-only delegation tokens", async () => {
    verifyA2ATokenWithClaimsMock.mockResolvedValue({
      email: "admin@example.com",
      orgDomain: "builder.io",
      scope: ["flags:read"],
      jti: "read-1",
      issuer: "analytics",
    });
    const auth = createFeatureFlagA2AActionRouteAuth("list-feature-flags");

    await expect(auth.resolveCaller(event)).resolves.toBeTruthy();
    expect(consumeOneTimeJtiMock).not.toHaveBeenCalled();
  });

  it.each([
    ["list-feature-flags", "flags:read"],
    ["set-feature-flag", "flags:write"],
  ] as const)(
    "allows an explicitly allowlisted no-org %s delegation",
    async (actionName, scope) => {
      process.env.AGENT_NATIVE_FEATURE_FLAG_ADMIN_EMAILS = "admin@example.com";
      resolveOrgByDomainMock.mockResolvedValue(null);
      verifyA2ATokenWithClaimsMock.mockResolvedValue({
        email: " ADMIN@example.com ",
        orgDomain: "builder.io",
        scope: [scope],
        jti: `${actionName}-1`,
        issuer: "analytics",
      });

      const auth = createFeatureFlagA2AActionRouteAuth(actionName);

      await expect(auth.resolveCaller(event)).resolves.toEqual(
        expect.objectContaining({
          owner: " ADMIN@example.com ",
          orgId: null,
        }),
      );
    },
  );

  it("rejects a no-org delegation from an email outside the allowlist", async () => {
    resolveOrgByDomainMock.mockResolvedValue(null);
    await expect(
      createFeatureFlagA2AActionRouteAuth("list-feature-flags").resolveCaller(
        event,
      ),
    ).rejects.toThrow("Invalid feature flag delegation");
  });
});
