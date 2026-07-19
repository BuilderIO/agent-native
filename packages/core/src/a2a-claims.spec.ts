import * as jose from "jose";
import { beforeEach, describe, expect, it, vi } from "vitest";

const verifyA2ATokenMock = vi.hoisted(() => vi.fn());

vi.mock("./a2a/server.js", () => ({
  verifyA2AToken: (...args: unknown[]) => verifyA2ATokenMock(...args),
}));

import { verifyA2ATokenWithClaims } from "./a2a-claims.js";

async function token(claims: Record<string, unknown>) {
  return new jose.SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("operator@example.com")
    .setExpirationTime("2m")
    .sign(new TextEncoder().encode("test-secret"));
}

describe("verifyA2ATokenWithClaims", () => {
  beforeEach(() => {
    verifyA2ATokenMock.mockReset();
    verifyA2ATokenMock.mockResolvedValue({
      email: "operator@example.com",
      orgDomain: null,
    });
  });

  it("rejects privileged delegation without an audience", async () => {
    expect(
      await verifyA2ATokenWithClaims(
        await token({
          org_id: "org-1",
          jti: "call-1",
          scope: "flags:write",
        }),
      ),
    ).toBeNull();
  });

  it("returns scoped claims only when an audience is present", async () => {
    expect(
      await verifyA2ATokenWithClaims(
        await token({
          aud: "https://content.example.com",
          iss: "https://analytics.example.com",
          org_id: "org-1",
          jti: "call-1",
          scope: "flags:write",
        }),
      ),
    ).toEqual({
      email: "operator@example.com",
      orgId: "org-1",
      jti: "call-1",
      issuer: "https://analytics.example.com",
      scope: ["flags:write"],
    });
  });
});
