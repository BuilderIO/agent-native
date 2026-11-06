import * as jose from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runWithRequestContext } from "../server/request-context.js";
import { resolveA2ACallerAuth } from "./caller-auth.js";
import { A2A_ORG_MEMBER_DELEGATION_TYPE } from "./organization-identity.js";

const getOrgDomainMock = vi.hoisted(() => vi.fn());
const getOrgA2ASecretMock = vi.hoisted(() => vi.fn());
const getOrgFederatedIdentityMock = vi.hoisted(() => vi.fn());
const evaluateFeatureFlagStrictMock = vi.hoisted(() => vi.fn());
const listOAuthAccountsByOwnerMock = vi.hoisted(() => vi.fn());

vi.mock("../org/context.js", () => ({
  getOrgDomain: getOrgDomainMock,
  getOrgA2ASecret: getOrgA2ASecretMock,
  getOrgFederatedIdentity: getOrgFederatedIdentityMock,
}));

vi.mock("../feature-flags/store.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../feature-flags/store.js")>()),
  evaluateFeatureFlagStrict: evaluateFeatureFlagStrictMock,
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
    getOrgFederatedIdentityMock.mockResolvedValue(null);
    evaluateFeatureFlagStrictMock.mockResolvedValue(false);
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
        const auth = await resolveA2ACallerAuth({
          audience: "https://peer.example.test",
        });

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
          payload: {
            sub: "alice+qa@agent-native.test",
            aud: "https://peer.example.test",
          },
        });
      },
    );
  });

  it("uses the org secret for an organization-principal fallback", async () => {
    process.env.A2A_SECRET = "global-a2a-secret";

    await runWithRequestContext(
      { userEmail: "alice+qa@agent-native.test", orgId: "org-qa" },
      async () => {
        const auth = await resolveA2ACallerAuth({
          audience: "https://peer.example.test",
        });

        expect(auth.orgDomain).toBe("builder.io");
        expect(auth.orgSecret).toBe("org-a2a-secret");
        expect(auth.metadata).toEqual({
          userEmail: "alice+qa@agent-native.test",
          orgDomain: "builder.io",
        });
        await expect(
          jose.jwtVerify(
            auth.apiKey!,
            new TextEncoder().encode("global-a2a-secret"),
          ),
        ).resolves.toMatchObject({
          payload: {
            sub: "alice+qa@agent-native.test",
            org_domain: "builder.io",
            aud: "https://peer.example.test",
          },
        });
        await expect(
          jose.jwtVerify(
            auth.apiKey!,
            new TextEncoder().encode("org-a2a-secret"),
          ),
        ).rejects.toThrow();
        expect(auth.apiKeyFallbacks).toHaveLength(2);
        const { payload: memberDelegation } = await jose.jwtVerify(
          auth.apiKeyFallbacks![0],
          new TextEncoder().encode("org-a2a-secret"),
        );
        expect(memberDelegation).toMatchObject({
          typ: A2A_ORG_MEMBER_DELEGATION_TYPE,
          sub: "alice+qa@agent-native.test",
          org_domain: "builder.io",
          aud: "https://peer.example.test",
        });
        expect(memberDelegation.iat).toEqual(expect.any(Number));
        expect(memberDelegation.exp).toEqual(expect.any(Number));
        expect(memberDelegation.jti).toEqual(expect.any(String));
        expect(
          memberDelegation.exp! - memberDelegation.iat!,
        ).toBeLessThanOrEqual(5 * 60);
        expect(memberDelegation.exp! - memberDelegation.iat!).toBeGreaterThan(
          0,
        );
        expect(memberDelegation).not.toHaveProperty("email");
        expect(memberDelegation).not.toHaveProperty("org_id");
        await expect(
          jose.jwtVerify(
            auth.apiKeyFallbacks![0],
            new TextEncoder().encode("global-a2a-secret"),
          ),
        ).rejects.toThrow();

        const { payload: orgPrincipal } = await jose.jwtVerify(
          auth.apiKeyFallbacks![1],
          new TextEncoder().encode("org-a2a-secret"),
        );
        expect(orgPrincipal).toMatchObject({
          org_domain: "builder.io",
          aud: "https://peer.example.test",
        });
        expect(orgPrincipal).not.toHaveProperty("org_id");
        expect(orgPrincipal).not.toHaveProperty("sub");
        await expect(
          jose.jwtVerify(
            auth.apiKeyFallbacks![1],
            new TextEncoder().encode("global-a2a-secret"),
          ),
        ).rejects.toThrow();
      },
    );
  });

  it("does not upgrade an org-member delegation to a deployment-signed user assertion", async () => {
    process.env.A2A_SECRET = "global-a2a-secret";

    await runWithRequestContext(
      {
        userEmail: "alice+qa@agent-native.test",
        orgId: "org-qa",
        a2aIdentityAssurance: "org-member",
      },
      async () => {
        const auth = await resolveA2ACallerAuth({
          audience: "https://peer.example.test",
        });

        expect(auth.apiKey).toBeTruthy();
        await expect(
          jose.jwtVerify(
            auth.apiKey!,
            new TextEncoder().encode("org-a2a-secret"),
          ),
        ).resolves.toMatchObject({
          payload: {
            typ: A2A_ORG_MEMBER_DELEGATION_TYPE,
            sub: "alice+qa@agent-native.test",
            org_domain: "builder.io",
            aud: "https://peer.example.test",
          },
        });
        await expect(
          jose.jwtVerify(
            auth.apiKey!,
            new TextEncoder().encode("global-a2a-secret"),
          ),
        ).rejects.toThrow();

        expect(auth.apiKeyFallbacks).toHaveLength(1);
        const { payload } = await jose.jwtVerify(
          auth.apiKeyFallbacks![0],
          new TextEncoder().encode("org-a2a-secret"),
        );
        expect(payload).not.toHaveProperty("sub");
      },
    );
  });

  it("only signs a user identity when requested", async () => {
    process.env.A2A_SECRET = "global-a2a-secret";

    await runWithRequestContext(
      { userEmail: "alice+qa@agent-native.test", orgId: "org-qa" },
      async () => {
        const auth = await resolveA2ACallerAuth({
          audience: "https://peer.example.test",
          userIdentityOnly: true,
        });

        expect(auth.apiKey).toBeTruthy();
        expect(auth.apiKeyFallbacks).toBeUndefined();
        await expect(
          jose.jwtVerify(
            auth.apiKey!,
            new TextEncoder().encode("global-a2a-secret"),
          ),
        ).resolves.toMatchObject({
          payload: {
            sub: "alice+qa@agent-native.test",
            org_id: "org-qa",
            aud: "https://peer.example.test",
          },
        });
        const { payload } = await jose.jwtVerify(
          auth.apiKey!,
          new TextEncoder().encode("global-a2a-secret"),
        );
        expect(payload).not.toHaveProperty("org_domain");
        expect(payload).not.toHaveProperty("typ");

        delete process.env.A2A_SECRET;
        const orgSecretOnly = await resolveA2ACallerAuth({
          audience: "https://peer.example.test",
          userIdentityOnly: true,
        });

        expect(orgSecretOnly.apiKey).toBeUndefined();
        expect(orgSecretOnly.apiKeyFallbacks).toBeUndefined();
      },
    );
  });

  it("does not mint an unscoped user token when the active org has no domain", async () => {
    process.env.A2A_SECRET = "global-a2a-secret";
    getOrgDomainMock.mockResolvedValueOnce(null);

    await runWithRequestContext(
      { userEmail: "alice+qa@agent-native.test", orgId: "org-qa" },
      async () => {
        const auth = await resolveA2ACallerAuth({
          audience: "https://peer.example.test",
        });

        expect(auth.apiKey).toBeUndefined();
        expect(auth.apiKeyFallbacks).toBeUndefined();
      },
    );
  });

  it("scopes identity-only tokens to domainless organizations by id", async () => {
    process.env.A2A_SECRET = "global-a2a-secret";
    getOrgDomainMock.mockResolvedValueOnce(null);

    await runWithRequestContext(
      { userEmail: "alice+qa@agent-native.test", orgId: "org-qa" },
      async () => {
        const auth = await resolveA2ACallerAuth({
          audience: "https://peer.example.test",
          userIdentityOnly: true,
        });

        expect(auth.apiKey).toBeTruthy();
        expect(auth.apiKeyFallbacks).toBeUndefined();
        const { payload } = await jose.jwtVerify(
          auth.apiKey!,
          new TextEncoder().encode("global-a2a-secret"),
        );
        expect(payload).toMatchObject({
          sub: "alice+qa@agent-native.test",
          org_id: "org-qa",
          aud: "https://peer.example.test",
        });
        expect(payload).not.toHaveProperty("org_domain");
      },
    );
  });

  it("preserves workspace identity lookup failures instead of omitting auth", async () => {
    getOrgDomainMock.mockRejectedValueOnce(
      new Error("organization lookup unavailable"),
    );

    await runWithRequestContext(
      { userEmail: "alice+qa@agent-native.test", orgId: "org-qa" },
      async () => {
        await expect(
          resolveA2ACallerAuth({ audience: "https://peer.example.test" }),
        ).rejects.toThrow("organization lookup unavailable");
      },
    );
    expect(getOrgA2ASecretMock).not.toHaveBeenCalled();
  });

  it("falls back to the org A2A secret when no shared secret is configured", async () => {
    delete process.env.A2A_SECRET;

    await runWithRequestContext(
      { userEmail: "alice+qa@agent-native.test", orgId: "org-qa" },
      async () => {
        const auth = await resolveA2ACallerAuth({
          audience: "https://peer.example.test",
        });

        expect(auth.orgDomain).toBe("builder.io");
        expect(auth.orgSecret).toBe("org-a2a-secret");
        const { payload: memberDelegation } = await jose.jwtVerify(
          auth.apiKey!,
          new TextEncoder().encode("org-a2a-secret"),
        );
        expect(memberDelegation).toMatchObject({
          typ: A2A_ORG_MEMBER_DELEGATION_TYPE,
          sub: "alice+qa@agent-native.test",
          org_domain: "builder.io",
          aud: "https://peer.example.test",
        });
        expect(auth.apiKeyFallbacks).toHaveLength(1);
        const { payload: orgPrincipal } = await jose.jwtVerify(
          auth.apiKeyFallbacks![0],
          new TextEncoder().encode("org-a2a-secret"),
        );
        expect(orgPrincipal).toMatchObject({
          org_domain: "builder.io",
          aud: "https://peer.example.test",
        });
        expect(orgPrincipal).not.toHaveProperty("sub");
      },
    );
  });

  it("uses only a plain organization token when the org has no A2A secret", async () => {
    process.env.A2A_SECRET = "global-a2a-secret";
    getOrgA2ASecretMock.mockResolvedValueOnce(null);

    await runWithRequestContext(
      { userEmail: "alice+qa@agent-native.test", orgId: "org-qa" },
      async () => {
        const auth = await resolveA2ACallerAuth({
          audience: "https://peer.example.test",
        });

        expect(auth.apiKeyFallbacks).toHaveLength(1);
        const { payload: organizationToken } = await jose.jwtVerify(
          auth.apiKeyFallbacks![0],
          new TextEncoder().encode("global-a2a-secret"),
        );
        expect(organizationToken).toMatchObject({
          org_domain: "builder.io",
          aud: "https://peer.example.test",
        });
        expect(organizationToken).not.toHaveProperty("sub");
        expect(organizationToken).not.toHaveProperty("typ");
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

  it("signs a linked domainless organization with its federated identity claims", async () => {
    process.env.A2A_SECRET = "global-a2a-secret";
    getOrgDomainMock.mockResolvedValueOnce(null);
    getOrgFederatedIdentityMock.mockResolvedValue({
      authority: "identity-hub.test",
      id: "org-hub-1",
    });
    evaluateFeatureFlagStrictMock.mockResolvedValue(true);

    await runWithRequestContext(
      { userEmail: "alice+qa@agent-native.test", orgId: "org-qa" },
      async () => {
        const auth = await resolveA2ACallerAuth({
          audience: "https://peer.example.test",
        });

        expect(auth.orgBinding).toEqual({
          kind: "federated",
          authority: "identity-hub.test",
          id: "org-hub-1",
        });
        expect(auth.apiKey).toBeTruthy();
        const apiKey = String(auth.apiKey);
        const { payload } = await jose.jwtVerify(
          apiKey,
          new TextEncoder().encode("global-a2a-secret"),
        );
        expect(payload).toMatchObject({
          sub: "alice+qa@agent-native.test",
          org_identity_authority: "identity-hub.test",
          org_identity_id: "org-hub-1",
          typ: "agent-native-org-federation",
          aud: "https://peer.example.test",
        });
        expect(payload).not.toHaveProperty("org_domain");
        expect(payload).not.toHaveProperty("org_id");
      },
    );
  });

  it("does not mint a token for a linked domainless organization when the federation flag is off", async () => {
    process.env.A2A_SECRET = "global-a2a-secret";
    getOrgDomainMock.mockResolvedValueOnce(null);
    getOrgFederatedIdentityMock.mockResolvedValue({
      authority: "identity-hub.test",
      id: "org-hub-1",
    });
    evaluateFeatureFlagStrictMock.mockResolvedValue(false);

    await runWithRequestContext(
      { userEmail: "alice+qa@agent-native.test", orgId: "org-qa" },
      async () => {
        const auth = await resolveA2ACallerAuth({
          audience: "https://peer.example.test",
        });

        expect(auth.orgBinding).toEqual({ kind: "unlinked" });
        expect(auth.apiKey).toBeUndefined();
        expect(auth.apiKeyFallbacks).toBeUndefined();
      },
    );
  });

  it("uses the org domain and omits federation claims when the org has both", async () => {
    process.env.A2A_SECRET = "global-a2a-secret";
    getOrgFederatedIdentityMock.mockResolvedValue({
      authority: "identity-hub.test",
      id: "org-hub-1",
    });
    evaluateFeatureFlagStrictMock.mockResolvedValue(true);

    await runWithRequestContext(
      { userEmail: "alice+qa@agent-native.test", orgId: "org-qa" },
      async () => {
        const auth = await resolveA2ACallerAuth({
          audience: "https://peer.example.test",
        });

        expect(auth.orgBinding).toEqual({
          kind: "domain",
          orgDomain: "builder.io",
        });
        expect(getOrgFederatedIdentityMock).not.toHaveBeenCalled();
        expect(auth.apiKey).toBeTruthy();
        const apiKey = String(auth.apiKey);
        const { payload } = await jose.jwtVerify(
          apiKey,
          new TextEncoder().encode("global-a2a-secret"),
        );
        expect(payload).toMatchObject({
          sub: "alice+qa@agent-native.test",
          org_domain: "builder.io",
          aud: "https://peer.example.test",
        });
        expect(payload).not.toHaveProperty("org_identity_authority");
        expect(payload).not.toHaveProperty("org_identity_id");
        expect(payload).not.toHaveProperty("typ");
      },
    );
  });

  it("rejects when the organization federated identity lookup fails", async () => {
    process.env.A2A_SECRET = "global-a2a-secret";
    getOrgDomainMock.mockResolvedValueOnce(null);
    getOrgFederatedIdentityMock.mockRejectedValueOnce(
      new Error("organization identity lookup unavailable"),
    );

    await runWithRequestContext(
      { userEmail: "alice+qa@agent-native.test", orgId: "org-qa" },
      async () => {
        await expect(
          resolveA2ACallerAuth({ audience: "https://peer.example.test" }),
        ).rejects.toThrow("organization identity lookup unavailable");
      },
    );
  });

  it("keeps org_id and omits federation claims for identity-only tokens even when the org is linked", async () => {
    process.env.A2A_SECRET = "global-a2a-secret";
    getOrgFederatedIdentityMock.mockResolvedValue({
      authority: "identity-hub.test",
      id: "org-hub-1",
    });
    evaluateFeatureFlagStrictMock.mockResolvedValue(true);

    await runWithRequestContext(
      { userEmail: "alice+qa@agent-native.test", orgId: "org-qa" },
      async () => {
        const auth = await resolveA2ACallerAuth({
          audience: "https://peer.example.test",
          userIdentityOnly: true,
        });

        expect(auth.apiKey).toBeTruthy();
        const apiKey = String(auth.apiKey);
        const { payload } = await jose.jwtVerify(
          apiKey,
          new TextEncoder().encode("global-a2a-secret"),
        );
        expect(payload).toMatchObject({
          sub: "alice+qa@agent-native.test",
          org_id: "org-qa",
          aud: "https://peer.example.test",
        });
        expect(payload).not.toHaveProperty("org_identity_authority");
        expect(payload).not.toHaveProperty("org_identity_id");
        expect(payload).not.toHaveProperty("org_domain");
        expect(payload).not.toHaveProperty("typ");
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
