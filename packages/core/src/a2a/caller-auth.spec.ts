import * as jose from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runWithRequestContext } from "../server/request-context.js";
import { resolveA2ACallerAuth } from "./caller-auth.js";

const getOrgDomainMock = vi.hoisted(() => vi.fn());
const getOrgA2ASecretMock = vi.hoisted(() => vi.fn());
const listOAuthAccountsByOwnerMock = vi.hoisted(() => vi.fn());

vi.mock("../org/context.js", () => ({
  getOrgDomain: getOrgDomainMock,
  getOrgA2ASecret: getOrgA2ASecretMock,
}));

vi.mock("../oauth-tokens/store.js", () => ({
  listOAuthAccountsByOwner: listOAuthAccountsByOwnerMock,
}));

describe("resolveA2ACallerAuth", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
    getOrgDomainMock.mockResolvedValue("builder.io");
    getOrgA2ASecretMock.mockResolvedValue("org-a2a-secret");
    listOAuthAccountsByOwnerMock.mockResolvedValue([
      { tokens: { access_token: "google-access-token" } },
    ]);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("signs production A2A calls with the shared secret when a caller email is available", async () => {
    process.env.A2A_SECRET = "global-a2a-secret";

    await runWithRequestContext(
      { userEmail: "alice+qa@agent-native.test" },
      async () => {
        const auth = await resolveA2ACallerAuth();

        expect(auth.metadata).toEqual({
          userEmail: "alice+qa@agent-native.test",
        });
        expect(auth.apiKey).toBeTruthy();
        await expect(
          jose.jwtVerify(
            auth.apiKey!,
            new TextEncoder().encode("global-a2a-secret"),
          ),
        ).resolves.toMatchObject({
          payload: { sub: "alice+qa@agent-native.test" },
        });
      },
    );
  });

  it("prefers the org A2A secret and includes the verified org domain hint", async () => {
    process.env.A2A_SECRET = "global-a2a-secret";

    await runWithRequestContext(
      { userEmail: "alice+qa@agent-native.test", orgId: "org-qa" },
      async () => {
        const auth = await resolveA2ACallerAuth();

        expect(auth.orgDomain).toBe("builder.io");
        expect(auth.orgSecret).toBe("org-a2a-secret");
        expect(auth.metadata).toEqual({
          userEmail: "alice+qa@agent-native.test",
          orgDomain: "builder.io",
        });
        await expect(
          jose.jwtVerify(
            auth.apiKey!,
            new TextEncoder().encode("org-a2a-secret"),
          ),
        ).resolves.toMatchObject({
          payload: {
            sub: "alice+qa@agent-native.test",
            org_domain: "builder.io",
          },
        });
        await expect(
          jose.jwtVerify(
            auth.apiKey!,
            new TextEncoder().encode("global-a2a-secret"),
          ),
        ).rejects.toThrow();
      },
    );
  });

  it("can attach a Google token for older receiver identity fallback", async () => {
    process.env.NODE_ENV = "production";
    process.env.A2A_SECRET = "global-a2a-secret";

    await runWithRequestContext(
      { userEmail: "alice+qa@agent-native.test" },
      async () => {
        const auth = await resolveA2ACallerAuth({
          includeGoogleToken: true,
        });

        expect(listOAuthAccountsByOwnerMock).toHaveBeenCalledWith(
          "google",
          "alice+qa@agent-native.test",
        );
        expect(auth.metadata.googleToken).toBe("google-access-token");
      },
    );
  });

  it("does not mint a bearer token without a request user", async () => {
    process.env.A2A_SECRET = "global-a2a-secret";

    await runWithRequestContext({}, async () => {
      const auth = await resolveA2ACallerAuth();

      expect(auth.apiKey).toBeUndefined();
      expect(auth.metadata).toEqual({});
    });
  });
});
