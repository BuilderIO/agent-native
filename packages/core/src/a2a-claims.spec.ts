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
      orgDomain: "builder.io",
      orgId: "org-1",
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
          org_domain: "builder.io",
          jti: "call-1",
          scope: "flags:write",
        }),
      ),
    ).toEqual({
      email: "operator@example.com",
      orgId: "org-1",
      orgDomain: "builder.io",
      jti: "call-1",
      issuer: "https://analytics.example.com",
      scope: ["flags:write"],
    });
  });

  it("rejects privileged delegation without a verified organization domain", async () => {
    verifyA2ATokenMock.mockResolvedValue({
      email: "operator@example.com",
      orgDomain: null,
    });
    expect(
      await verifyA2ATokenWithClaims(
        await token({
          aud: "https://content.example.com",
          org_id: "org-1",
          jti: "call-1",
          scope: "flags:write",
        }),
      ),
    ).toBeNull();
  });

  it("rejects an ID-only organization claim even when local metadata resolves it", async () => {
    expect(
      await verifyA2ATokenWithClaims(
        await token({
          aud: "https://content.example.com",
          org_id: "org-1",
          jti: "call-1",
          scope: "flags:write",
        }),
      ),
    ).toBeNull();
  });

  it("does not create action claims when the shared verifier rejects the subject", async () => {
    verifyA2ATokenMock.mockResolvedValue({ email: null, orgDomain: null });
    expect(
      await verifyA2ATokenWithClaims(
        await token({
          aud: "https://content.example.com",
          org_id: "org-x",
          jti: "call-1",
          scope: "flags:write",
        }),
      ),
    ).toBeNull();
  });

  it("preserves unreadable identity evidence as a failed verification", async () => {
    verifyA2ATokenMock.mockRejectedValue(
      new Error("A2A identity verification is temporarily unavailable"),
    );
    await expect(
      verifyA2ATokenWithClaims(
        await token({
          aud: "https://content.example.com",
          org_id: "org-x",
          jti: "call-1",
          scope: "flags:write",
        }),
      ),
    ).rejects.toThrow("A2A identity verification is temporarily unavailable");
  });

  it("does not trust a token org_id different from the verified org id", async () => {
    verifyA2ATokenMock.mockResolvedValue({
      email: "operator@example.com",
      orgDomain: "builder.io",
      orgId: "org-evil",
    });
    expect(
      await verifyA2ATokenWithClaims(
        await token({
          aud: "https://content.example.com",
          org_id: "org-1",
          jti: "call-1",
          scope: "flags:write",
        }),
      ),
    ).toBeNull();
  });
});
