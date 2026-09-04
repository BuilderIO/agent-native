import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const isFeatureFlagEnabledMock = vi.hoisted(() => vi.fn());
const executeMock = vi.hoisted(() => vi.fn());
const createOrganizationMock = vi.hoisted(() => vi.fn());
const setActiveOrgIdMock = vi.hoisted(() => vi.fn());
const invalidateMemberOrgCachesMock = vi.hoisted(() => vi.fn());
const canonicalA2AAudienceMock = vi.hoisted(() => vi.fn());
const signA2ATokenMock = vi.hoisted(() => vi.fn());
const resolveIdentityHubUrlMock = vi.hoisted(() => vi.fn());
const resolveIdentitySsoAppIdMock = vi.hoisted(() => vi.fn());

vi.mock("../feature-flags/store.js", () => ({
  isFeatureFlagEnabled: isFeatureFlagEnabledMock,
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
vi.mock("./active-org.js", () => ({ setActiveOrgId: setActiveOrgIdMock }));
vi.mock("./context.js", () => ({
  createOrganization: createOrganizationMock,
}));
vi.mock("./request-org-cache.js", () => ({
  invalidateMemberOrgCaches: invalidateMemberOrgCachesMock,
}));

const { provisionFederatedOrganization, revokeFederatedOrganizationMember } =
  await import("./federation.js");

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
    isFeatureFlagEnabledMock.mockResolvedValue(true);
    canonicalA2AAudienceMock.mockReturnValue(
      "https://dispatch.agent-native.com",
    );
    resolveIdentityHubUrlMock.mockReturnValue(
      "https://dispatch.agent-native.com",
    );
    resolveIdentitySsoAppIdMock.mockReturnValue("slides");
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
      undefined,
      expect.objectContaining({
        preferGlobalSecret: true,
        extraClaims: expect.objectContaining({
          federation_operation: "remove-member",
          federation_member_email: "removed@example.test",
        }),
      }),
    );
  });
});
