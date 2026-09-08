import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const evaluateFeatureFlagStrictMock = vi.hoisted(() => vi.fn());
const executeMock = vi.hoisted(() => vi.fn());
const createOrganizationMock = vi.hoisted(() => vi.fn());
const setActiveOrgIdMock = vi.hoisted(() => vi.fn());
const invalidateMemberOrgCachesMock = vi.hoisted(() => vi.fn());
const canonicalA2AAudienceMock = vi.hoisted(() => vi.fn());
const signA2ATokenMock = vi.hoisted(() => vi.fn());
const resolveIdentityHubUrlMock = vi.hoisted(() => vi.fn());
const resolveIdentitySsoAppIdMock = vi.hoisted(() => vi.fn());
const getOriginMock = vi.hoisted(() => vi.fn());
const readDeployCredentialEnvMock = vi.hoisted(() => vi.fn());

vi.mock("../feature-flags/store.js", () => ({
  evaluateFeatureFlagStrict: evaluateFeatureFlagStrictMock,
}));
vi.mock("../db/client.js", () => ({
  getDbExec: () => ({ execute: executeMock }),
}));
vi.mock("../a2a/index.js", () => ({
  canonicalA2AAudience: canonicalA2AAudienceMock,
  signA2AToken: signA2ATokenMock,
}));
vi.mock("../server/identity-sso.js", () => ({
  resolveIdentityHubUrl: resolveIdentityHubUrlMock,
  resolveIdentitySsoAppId: resolveIdentitySsoAppIdMock,
}));
vi.mock("../server/credential-provider.js", () => ({
  readDeployCredentialEnv: readDeployCredentialEnvMock,
}));
vi.mock("../server/google-oauth.js", () => ({ getOrigin: getOriginMock }));
vi.mock("./active-org.js", () => ({ setActiveOrgId: setActiveOrgIdMock }));
vi.mock("./context.js", () => ({
  createOrganization: createOrganizationMock,
}));
vi.mock("./request-org-cache.js", () => ({
  invalidateMemberOrgCaches: invalidateMemberOrgCachesMock,
}));

const {
  addFederatedOrganizationMember,
  provisionFederatedOrganization,
  revokeFederatedOrganizationMember,
  syncOrganizationToIdentityHub,
  updateFederatedOrganizationMemberRole,
  validateFederatedOrganizationMembership,
} = await import("./federation.js");

const identity = {
  authority: "https://dispatch.agent-native.com",
  id: "dispatch-org-1",
  name: "Example Org",
  role: "owner" as const,
  email: "owner@example.test",
};

describe("cross-app organization federation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    evaluateFeatureFlagStrictMock.mockResolvedValue(true);
    canonicalA2AAudienceMock.mockReturnValue(
      "https://dispatch.agent-native.com",
    );
    resolveIdentityHubUrlMock.mockReturnValue(
      "https://dispatch.agent-native.com",
    );
    getOriginMock.mockReturnValue("https://slides.agent-native.com");
    resolveIdentitySsoAppIdMock.mockReturnValue("slides");
    readDeployCredentialEnvMock.mockReturnValue("test-federation-credential");
    signA2ATokenMock.mockResolvedValue("signed-assertion");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
      ),
    );
    executeMock.mockImplementation(async (input) => {
      const sql = (typeof input === "string" ? input : input.sql).trim();
      if (/identity_authority = \?/i.test(sql)) return { rows: [] };
      if (/SELECT org_id FROM org_members/i.test(sql)) {
        return { rows: [{ org_id: "existing-local-org" }] };
      }
      if (/WHERE id = \?/i.test(sql)) return { rows: [] };
      throw new Error(`unexpected SQL in test: ${sql}`);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not guess when an existing account has an unrelated local org", async () => {
    await expect(provisionFederatedOrganization(identity)).resolves.toBe(
      "unlinked",
    );
    expect(createOrganizationMock).not.toHaveBeenCalled();
    expect(setActiveOrgIdMock).not.toHaveBeenCalled();
  });

  it("activates the mapped organization even when another membership exists", async () => {
    executeMock.mockImplementation(async (input) => {
      const sql = (typeof input === "string" ? input : input.sql).trim();
      if (/WHERE identity_authority = \?/i.test(sql)) {
        return { rows: [{ id: "local-org" }] };
      }
      if (/SELECT org_id FROM org_members/i.test(sql)) {
        return { rows: [{ org_id: "unrelated-local-org" }] };
      }
      if (/INSERT INTO org_members|UPDATE org_members/i.test(sql)) {
        return { rows: [] };
      }
      throw new Error(`unexpected SQL in test: ${sql}`);
    });

    await expect(provisionFederatedOrganization(identity)).resolves.toBe(
      "linked",
    );
    expect(setActiveOrgIdMock).toHaveBeenCalledWith(
      identity.email,
      "local-org",
      "signed cross-app organization context",
    );
  });

  it("does not create a target organization from a first non-owner assertion", async () => {
    executeMock.mockImplementation(async (input) => {
      const sql = (typeof input === "string" ? input : input.sql).trim();
      if (/SELECT org_id FROM org_members/i.test(sql)) return { rows: [] };
      if (/FROM organizations/i.test(sql)) return { rows: [] };
      throw new Error(`unexpected SQL in test: ${sql}`);
    });

    await expect(
      provisionFederatedOrganization({ ...identity, role: "member" }),
    ).resolves.toBe("unlinked");
    expect(createOrganizationMock).not.toHaveBeenCalled();
  });

  it("does not persist a mapping when the identity authority is unavailable", async () => {
    resolveIdentityHubUrlMock.mockReturnValue(undefined);
    executeMock.mockResolvedValueOnce({
      rows: [{ identity_authority: null, identity_id: null }],
    });

    await expect(
      syncOrganizationToIdentityHub({} as any, {
        id: identity.id,
        name: identity.name,
        role: identity.role,
        email: identity.email,
      }),
    ).resolves.toBe(false);
    expect(executeMock).toHaveBeenCalledTimes(1);
  });

  it("does not fall back to the shared A2A secret for federation signing", async () => {
    readDeployCredentialEnvMock.mockReturnValue(undefined);
    executeMock.mockImplementation(async (input) => {
      const sql = (typeof input === "string" ? input : input.sql).trim();
      if (/SELECT identity_authority, identity_id/i.test(sql)) {
        return {
          rows: [
            {
              identity_authority: null,
              identity_id: null,
              federation_roster_initialized_at: Date.now(),
            },
          ],
        };
      }
      throw new Error(`unexpected SQL in test: ${sql}`);
    });

    await expect(
      syncOrganizationToIdentityHub({} as any, {
        id: identity.id,
        name: identity.name,
        role: identity.role,
        email: identity.email,
      }),
    ).rejects.toThrow("missing its deployment credential");
    expect(signA2ATokenMock).not.toHaveBeenCalled();
  });

  it("sends the current owner roster during the one-time registration", async () => {
    executeMock.mockImplementation(async (input) => {
      const sql = (typeof input === "string" ? input : input.sql).trim();
      if (/SELECT identity_authority, identity_id/i.test(sql)) {
        return {
          rows: [
            {
              identity_authority: null,
              identity_id: null,
              federation_roster_initialized_at: null,
            },
          ],
        };
      }
      if (/SELECT email, role FROM org_members/i.test(sql)) {
        return {
          rows: [
            { email: "admin@example.test", role: "admin" },
            { email: "member@example.test", role: "member" },
            { email: "owner@example.test", role: "owner" },
          ],
        };
      }
      if (/UPDATE organizations/i.test(sql)) return { rows: [] };
      throw new Error(`unexpected SQL in test: ${sql}`);
    });
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect(JSON.parse(String(init.body))).toEqual({
        members: [
          { email: "admin@example.test", role: "admin" },
          { email: "member@example.test", role: "member" },
          { email: "owner@example.test", role: "owner" },
        ],
      });
      return new Response(
        JSON.stringify({
          orgId: identity.id,
          name: identity.name,
          rosterInitialized: true,
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      syncOrganizationToIdentityHub({} as any, {
        id: identity.id,
        name: identity.name,
        role: identity.role,
        email: identity.email,
      }),
    ).resolves.toBe(true);
    expect(signA2ATokenMock).toHaveBeenCalledWith(
      identity.email,
      undefined,
      "test-federation-credential",
      expect.objectContaining({
        extraClaims: expect.objectContaining({
          federation_roster_hash: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
        }),
      }),
    );
    expect(executeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sql: expect.stringContaining(
          "SET federation_roster_initialized_at = ?",
        ),
      }),
    );
  });

  it("sends a signed revocation before a local member is removed", async () => {
    executeMock.mockImplementation(async (input) => {
      const sql = (typeof input === "string" ? input : input.sql).trim();
      if (/FROM organizations/i.test(sql)) {
        return {
          rows: [
            {
              id: "dispatch-org-1",
              name: "Example Org",
              identity_authority: "https://dispatch.agent-native.com",
              identity_id: "dispatch-org-1",
            },
          ],
        };
      }
      throw new Error(`unexpected SQL in test: ${sql}`);
    });

    await expect(
      revokeFederatedOrganizationMember({} as any, {
        orgId: "dispatch-org-1",
        actorEmail: "owner@example.test",
        actorRole: "owner",
        memberEmail: "removed@example.test",
      }),
    ).resolves.toBe(true);
    expect(signA2ATokenMock).toHaveBeenCalledWith(
      "owner@example.test",
      undefined,
      "test-federation-credential",
      expect.objectContaining({
        extraClaims: expect.objectContaining({
          federation_operation: "remove-member",
          federation_member_email: "removed@example.test",
        }),
      }),
    );
  });

  it("accepts the canonical identity id returned for a mapped local organization", async () => {
    executeMock.mockImplementation(async (input) => {
      const sql = (typeof input === "string" ? input : input.sql).trim();
      if (/SELECT identity_authority, identity_id/i.test(sql)) {
        return {
          rows: [
            {
              identity_authority: "https://dispatch.agent-native.com",
              identity_id: "canonical-org",
              federation_roster_initialized_at: Date.now(),
            },
          ],
        };
      }
      throw new Error(`unexpected SQL in test: ${sql}`);
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              orgId: "canonical-org",
              name: identity.name,
            }),
            { status: 200 },
          ),
      ),
    );

    await expect(
      syncOrganizationToIdentityHub({} as any, {
        id: "local-org",
        name: identity.name,
        role: identity.role,
        email: identity.email,
      }),
    ).resolves.toBe(true);
  });

  it("sends explicit add and role operations with the actor assertion", async () => {
    executeMock.mockImplementation(async (input) => {
      const sql = (typeof input === "string" ? input : input.sql).trim();
      if (/FROM organizations/i.test(sql)) {
        return {
          rows: [
            {
              id: "dispatch-org-1",
              name: "Example Org",
              identity_authority: "https://dispatch.agent-native.com",
              identity_id: "dispatch-org-1",
            },
          ],
        };
      }
      throw new Error(`unexpected SQL in test: ${sql}`);
    });

    await expect(
      addFederatedOrganizationMember({} as any, {
        orgId: "dispatch-org-1",
        actorEmail: "owner@example.test",
        actorRole: "owner",
        memberEmail: "member@example.test",
        memberRole: "member",
      }),
    ).resolves.toBe(true);
    await expect(
      updateFederatedOrganizationMemberRole({} as any, {
        orgId: "dispatch-org-1",
        actorEmail: "owner@example.test",
        actorRole: "owner",
        memberEmail: "member@example.test",
        memberRole: "admin",
      }),
    ).resolves.toBe(true);
    expect(signA2ATokenMock).toHaveBeenLastCalledWith(
      "owner@example.test",
      undefined,
      "test-federation-credential",
      expect.objectContaining({
        extraClaims: expect.objectContaining({
          federation_operation: "update-member-role",
          federation_member_email: "member@example.test",
          federation_member_role: "admin",
        }),
      }),
    );
  });

  it("uses the canonical identity id for a mapped local organization", async () => {
    executeMock.mockImplementation(async (input) => {
      const sql = (typeof input === "string" ? input : input.sql).trim();
      if (/FROM organizations/i.test(sql)) {
        return {
          rows: [
            {
              id: "local-org",
              name: "Example Org",
              identity_authority: "https://dispatch.agent-native.com",
              identity_id: "canonical-org",
            },
          ],
        };
      }
      throw new Error(`unexpected SQL in test: ${sql}`);
    });

    await expect(
      addFederatedOrganizationMember({} as any, {
        orgId: "local-org",
        actorEmail: "owner@example.test",
        actorRole: "owner",
        memberEmail: "member@example.test",
        memberRole: "member",
      }),
    ).resolves.toBe(true);
    expect(signA2ATokenMock).toHaveBeenCalledWith(
      "owner@example.test",
      undefined,
      "test-federation-credential",
      expect.objectContaining({
        extraClaims: expect.objectContaining({ org_id: "canonical-org" }),
      }),
    );
  });

  it("fails linked member mutations closed when the rollout store is unavailable", async () => {
    evaluateFeatureFlagStrictMock.mockRejectedValue(
      new Error("flag store down"),
    );
    executeMock.mockImplementation(async (input) => {
      const sql = (typeof input === "string" ? input : input.sql).trim();
      if (/FROM organizations/i.test(sql)) {
        return {
          rows: [
            {
              id: "dispatch-org-1",
              name: "Example Org",
              identity_authority: "https://dispatch.agent-native.com",
              identity_id: "dispatch-org-1",
            },
          ],
        };
      }
      throw new Error(`unexpected SQL in test: ${sql}`);
    });

    await expect(
      addFederatedOrganizationMember({} as any, {
        orgId: "dispatch-org-1",
        actorEmail: "owner@example.test",
        actorRole: "owner",
        memberEmail: "member@example.test",
        memberRole: "member",
      }),
    ).rejects.toThrow("rollout is unavailable");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects invalid actor identity before sending a member operation", async () => {
    await expect(
      addFederatedOrganizationMember({} as any, {
        orgId: "dispatch-org-1",
        actorEmail: "not-an-email",
        actorRole: "owner",
        memberEmail: "member@example.test",
        memberRole: "member",
      }),
    ).rejects.toThrow("Invalid federated member email");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("removes a satellite membership when the authority no longer has it", async () => {
    executeMock.mockImplementation(async (input) => {
      const sql = (typeof input === "string" ? input : input.sql).trim();
      if (/SELECT name, identity_authority/i.test(sql)) {
        return {
          rows: [
            {
              name: "Example Org",
              identity_authority: identity.authority,
              identity_id: identity.id,
            },
          ],
        };
      }
      if (/SELECT role, federation_removal_pending_at/i.test(sql)) {
        return { rows: [{ role: "member" }] };
      }
      if (/SET federation_removal_pending_at/i.test(sql)) return { rows: [] };
      if (/DELETE FROM org_members/i.test(sql)) return { rows: [] };
      throw new Error(`unexpected SQL in test: ${sql}`);
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              orgId: identity.id,
              memberEmail: identity.email,
              memberPresent: false,
            }),
            { status: 200 },
          ),
      ),
    );

    await expect(
      validateFederatedOrganizationMembership({} as any, {
        orgId: identity.id,
        email: identity.email,
      }),
    ).resolves.toEqual({ active: false, role: null });
    expect(executeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sql: expect.stringContaining("DELETE FROM org_members"),
      }),
    );
  });

  it("refreshes a satellite membership role from the authority", async () => {
    executeMock.mockImplementation(async (input) => {
      const sql = (typeof input === "string" ? input : input.sql).trim();
      if (/SELECT name, identity_authority/i.test(sql)) {
        return {
          rows: [
            {
              name: "Example Org",
              identity_authority: identity.authority,
              identity_id: identity.id,
            },
          ],
        };
      }
      if (/SELECT role, federation_removal_pending_at/i.test(sql)) {
        return { rows: [{ role: "member" }] };
      }
      if (/SET role = \?/i.test(sql)) return { rows: [] };
      throw new Error(`unexpected SQL in test: ${sql}`);
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              orgId: identity.id,
              memberEmail: identity.email,
              memberPresent: true,
              memberRole: "admin",
            }),
            { status: 200 },
          ),
      ),
    );

    await expect(
      validateFederatedOrganizationMembership({} as any, {
        orgId: identity.id,
        email: identity.email,
      }),
    ).resolves.toEqual({ active: true, role: "admin" });
  });
});
