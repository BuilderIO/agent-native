import type { H3Event } from "h3";
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
  resolveFederatedOrganizationForA2A,
  revokeFederatedOrganizationMember,
  syncOrganizationToIdentityHub,
  updateFederatedOrganizationMemberRole,
  validateFederatedOrganizationMembership,
  validateFederatedOrganizationMembershipForCurrentRequest,
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

    // The SSO handoff passes the signing-in browser's request, so its next
    // requests read the linked organization on every instance.
    const handoff = { context: {} } as any;
    await expect(
      provisionFederatedOrganization(identity, { event: handoff }),
    ).resolves.toBe("linked");
    expect(setActiveOrgIdMock).toHaveBeenCalledWith(
      identity.email,
      "local-org",
      "signed cross-app organization context",
      handoff,
    );
  });

  it("hands the SSO request to the organization it creates for a first owner", async () => {
    executeMock.mockImplementation(async (input) => {
      const sql = (typeof input === "string" ? input : input.sql).trim();
      if (/SELECT org_id FROM org_members/i.test(sql)) return { rows: [] };
      if (/FROM organizations/i.test(sql)) return { rows: [] };
      if (/UPDATE organizations/i.test(sql)) return { rows: [] };
      throw new Error(`unexpected SQL in test: ${sql}`);
    });
    const handoff = { context: {} } as any;

    await expect(
      provisionFederatedOrganization(identity, { event: handoff }),
    ).resolves.toBe("created");
    expect(createOrganizationMock).toHaveBeenCalledWith(
      identity.name,
      identity.email,
      identity.role,
      expect.objectContaining({ id: identity.id, event: handoff }),
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

  it("distinguishes a stale icon revision from a transient hub failure", async () => {
    const canonical = {
      version: 1 as const,
      kind: "emoji" as const,
      emoji: "📚",
    };
    executeMock.mockImplementation(async (input) => {
      const sql = (typeof input === "string" ? input : input.sql).trim();
      if (/SELECT identity_authority, identity_id/i.test(sql)) {
        return {
          rows: [
            {
              identity_authority: "https://dispatch.agent-native.com",
              identity_id: identity.id,
              icon_json: JSON.stringify(canonical),
              icon_revision: 2,
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
              code: "icon-revision-conflict",
              icon: canonical,
              iconRevision: 5,
            }),
            { status: 409 },
          ),
      ),
    );

    await expect(
      syncOrganizationToIdentityHub({} as any, {
        id: identity.id,
        name: identity.name,
        role: identity.role,
        email: identity.email,
      }),
    ).rejects.toMatchObject({
      name: "FederatedIconConflictError",
      icon: canonical,
      iconRevision: 5,
    });
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

  it("validates a local organization for CLI callers without a request origin", async () => {
    executeMock.mockImplementation(async (input) => {
      const sql = (typeof input === "string" ? input : input.sql).trim();
      if (/SELECT name, identity_authority/i.test(sql)) {
        return {
          rows: [
            {
              name: "Example Org",
              identity_authority: null,
              identity_id: null,
            },
          ],
        };
      }
      if (/SELECT role, federation_removal_pending_at/i.test(sql)) {
        return { rows: [{ role: "admin" }] };
      }
      throw new Error(`unexpected SQL in test: ${sql}`);
    });

    await expect(
      validateFederatedOrganizationMembershipForCurrentRequest({
        orgId: "local-org-1",
        email: "admin@example.test",
      }),
    ).resolves.toEqual({ active: true, role: "admin" });
    expect(getOriginMock).not.toHaveBeenCalled();
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

  describe("resolveFederatedOrganizationForA2A", () => {
    const authority = "https://dispatch.agent-native.com";
    const hubOrgId = "dispatch-org-1";
    const memberEmail = "member@example.test";
    const localOrg = {
      id: "local-org-1",
      name: "Example Org",
      allowed_domain: null,
      identity_authority: authority,
      identity_id: hubOrgId,
    };
    const presentBody = {
      orgId: hubOrgId,
      memberEmail,
      memberPresent: true,
      memberRole: "member",
    };
    const absentBody = { orgId: hubOrgId, memberEmail, memberPresent: false };
    const claim = { authority, id: hubOrgId, email: memberEmail };
    const event = {} as H3Event;

    function stubLocalRows(rows: {
      org?: Record<string, unknown>;
      member?: Record<string, unknown>;
    }) {
      executeMock.mockImplementation(async (input) => {
        const sql = (typeof input === "string" ? input : input.sql).trim();
        if (/SELECT id, name, allowed_domain FROM organizations/i.test(sql)) {
          return { rows: rows.org ? [rows.org] : [] };
        }
        if (/SELECT name, identity_authority, identity_id/i.test(sql)) {
          return { rows: rows.org ? [rows.org] : [] };
        }
        if (
          /SELECT federation_removal_pending_at FROM org_members/i.test(sql)
        ) {
          return { rows: rows.member ? [rows.member] : [] };
        }
        if (
          /SELECT role, federation_removal_pending_at FROM org_members/i.test(
            sql,
          )
        ) {
          return { rows: rows.member ? [rows.member] : [] };
        }
        if (
          /^(INSERT INTO org_members|UPDATE org_members|DELETE FROM org_members)/i.test(
            sql,
          )
        ) {
          return { rows: [] };
        }
        throw new Error(`unexpected SQL in test: ${sql}`);
      });
    }

    function stubHubResponse(body: Record<string, unknown>) {
      const fetchMock = vi.fn(
        async () => new Response(JSON.stringify(body), { status: 200 }),
      );
      vi.stubGlobal("fetch", fetchMock);
      return fetchMock;
    }

    // raw-sql-ok: asserts on the arguments of a mocked execute call; no SQL is composed or run
    const localWriteMatcher = expect.objectContaining({
      sql: expect.stringMatching(
        /^(INSERT INTO|UPDATE|DELETE FROM) org_members/,
      ),
    });

    it("returns null without a hub call when no local organization is mapped to the pair", async () => {
      stubLocalRows({});
      const fetchMock = stubHubResponse(presentBody);

      await expect(
        resolveFederatedOrganizationForA2A(event, claim),
      ).resolves.toBeNull();
      expect(evaluateFeatureFlagStrictMock).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("matches the mapped pair after normalizing the claimed authority", async () => {
      stubLocalRows({ org: localOrg });
      const fetchMock = stubHubResponse(presentBody);

      await expect(
        resolveFederatedOrganizationForA2A(event, {
          authority: "HTTPS://Dispatch.Agent-Native.com/",
          id: hubOrgId,
          email: memberEmail,
        }),
      ).resolves.toEqual({ orgId: "local-org-1", orgDomain: null });
      expect(executeMock).toHaveBeenCalledWith(
        expect.objectContaining({ args: [authority, hubOrgId] }),
      );
      expect(fetchMock).toHaveBeenCalledWith(
        `${authority}/_agent-native/identity/organization`,
        expect.anything(),
      );
    });

    it("rejects an identity id outside the shared identifier pattern", async () => {
      stubLocalRows({ org: localOrg });
      const fetchMock = stubHubResponse(presentBody);

      await expect(
        resolveFederatedOrganizationForA2A(event, {
          ...claim,
          id: "dispatch org/1",
        }),
      ).resolves.toBeNull();
      expect(executeMock).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("rejects a non-https identity authority", async () => {
      stubLocalRows({ org: localOrg });
      const fetchMock = stubHubResponse(presentBody);

      await expect(
        resolveFederatedOrganizationForA2A(event, {
          ...claim,
          authority: "http://dispatch.agent-native.com",
        }),
      ).resolves.toBeNull();
      expect(executeMock).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("returns null and contacts no hub when the federation flag is disabled", async () => {
      evaluateFeatureFlagStrictMock.mockResolvedValue(false);
      stubLocalRows({ org: localOrg });
      const fetchMock = stubHubResponse(presentBody);

      await expect(
        resolveFederatedOrganizationForA2A(event, claim),
      ).resolves.toBeNull();
      expect(executeMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("rejects when the federation flag cannot be evaluated", async () => {
      evaluateFeatureFlagStrictMock.mockRejectedValue(
        new Error("flag store down"),
      );
      stubLocalRows({ org: localOrg });
      const fetchMock = stubHubResponse(presentBody);

      await expect(
        resolveFederatedOrganizationForA2A(event, claim),
      ).rejects.toThrow(
        "Cross-app organization federation rollout is unavailable.",
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("returns an existing local member when the hub confirms membership", async () => {
      stubLocalRows({
        org: localOrg,
        member: { federation_removal_pending_at: null, role: "member" },
      });
      const fetchMock = stubHubResponse(presentBody);

      await expect(
        resolveFederatedOrganizationForA2A(event, claim),
      ).resolves.toEqual({ orgId: "local-org-1", orgDomain: null });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      // raw-sql-ok: asserts on the arguments of a mocked execute call; no SQL is composed or run
      expect(executeMock).not.toHaveBeenCalledWith(
        expect.objectContaining({
          sql: expect.stringMatching(/^INSERT INTO org_members/),
        }),
      );
    });

    it("removes an existing local member the hub no longer lists", async () => {
      stubLocalRows({
        org: localOrg,
        member: { federation_removal_pending_at: null, role: "member" },
      });
      stubHubResponse(absentBody);

      await expect(
        resolveFederatedOrganizationForA2A(event, claim),
      ).resolves.toBeNull();
      // raw-sql-ok: asserts on the arguments of a mocked execute call; no SQL is composed or run
      expect(executeMock).toHaveBeenCalledWith(
        expect.objectContaining({
          sql: expect.stringContaining("DELETE FROM org_members"),
        }),
      );
    });

    it("records a hub-confirmed member locally with the hub role", async () => {
      stubLocalRows({ org: localOrg });
      const fetchMock = stubHubResponse(presentBody);

      await expect(
        resolveFederatedOrganizationForA2A(event, claim),
      ).resolves.toEqual({ orgId: "local-org-1", orgDomain: null });
      // raw-sql-ok: asserts on the arguments of a mocked execute call; no SQL is composed or run
      expect(executeMock).toHaveBeenCalledWith(
        expect.objectContaining({
          sql: expect.stringContaining("INSERT INTO org_members"),
          args: expect.arrayContaining(["local-org-1", memberEmail, "member"]),
        }),
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(signA2ATokenMock.mock.calls.map(([subject]) => subject)).toEqual([
        memberEmail,
      ]);
      expect(signA2ATokenMock).toHaveBeenCalledWith(
        memberEmail,
        undefined,
        "test-federation-credential",
        expect.objectContaining({
          extraClaims: expect.objectContaining({
            federation_operation: "check-member",
            federation_member_email: memberEmail,
          }),
        }),
      );
    });

    it("returns null and records nothing when the hub does not list the member", async () => {
      stubLocalRows({ org: localOrg });
      stubHubResponse(absentBody);

      await expect(
        resolveFederatedOrganizationForA2A(event, claim),
      ).resolves.toBeNull();
      expect(executeMock).not.toHaveBeenCalledWith(localWriteMatcher);
    });

    it("rejects without recording a member when the hub check fails", async () => {
      stubLocalRows({ org: localOrg });
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response("unavailable", { status: 500 })),
      );

      await expect(
        resolveFederatedOrganizationForA2A(event, claim),
      ).rejects.toThrow("Identity authority membership check failed (500).");
      expect(executeMock).not.toHaveBeenCalledWith(localWriteMatcher);
    });

    it("rejects a member lookup that has no request origin", async () => {
      stubLocalRows({ org: localOrg });
      const fetchMock = stubHubResponse(presentBody);

      await expect(
        resolveFederatedOrganizationForA2A(undefined, claim),
      ).rejects.toThrow(
        "Federated membership validation requires a request origin.",
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("returns null when this app is the identity hub for the claimed authority", async () => {
      getOriginMock.mockReturnValue(authority);
      stubLocalRows({ org: localOrg });
      const fetchMock = stubHubResponse(presentBody);

      await expect(
        resolveFederatedOrganizationForA2A(event, claim),
      ).resolves.toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(executeMock).not.toHaveBeenCalledWith(localWriteMatcher);
    });

    it("rejects when the hub resolved for this app is not the claimed authority", async () => {
      resolveIdentityHubUrlMock.mockReturnValue(
        "https://other.agent-native.com",
      );
      stubLocalRows({ org: localOrg });
      const fetchMock = stubHubResponse(presentBody);

      await expect(
        resolveFederatedOrganizationForA2A(event, claim),
      ).rejects.toThrow(
        "Organization is linked to an unavailable identity authority.",
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("refuses a pending-removal member without asking the hub, even if the hub still lists them", async () => {
      stubLocalRows({
        org: localOrg,
        member: {
          federation_removal_pending_at: 1_700_000_000_000,
          role: "member",
        },
      });
      const fetchMock = stubHubResponse(presentBody);

      await expect(
        resolveFederatedOrganizationForA2A(event, claim),
      ).resolves.toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(executeMock).not.toHaveBeenCalledWith(localWriteMatcher);
    });

    it("lowercases the allowed domain returned for the organization", async () => {
      stubLocalRows({
        org: { ...localOrg, allowed_domain: "Example.TEST" },
      });
      stubHubResponse(presentBody);

      await expect(
        resolveFederatedOrganizationForA2A(event, claim),
      ).resolves.toEqual({ orgId: "local-org-1", orgDomain: "example.test" });
    });

    it("returns a null orgDomain when the organization has no allowed domain", async () => {
      stubLocalRows({ org: localOrg });
      stubHubResponse(presentBody);

      await expect(
        resolveFederatedOrganizationForA2A(event, claim),
      ).resolves.toEqual({ orgId: "local-org-1", orgDomain: null });
    });
  });
});
