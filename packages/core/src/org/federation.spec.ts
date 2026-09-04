import { beforeEach, describe, expect, it, vi } from "vitest";

const isFeatureFlagEnabledMock = vi.hoisted(() => vi.fn());
const executeMock = vi.hoisted(() => vi.fn());
const createOrganizationMock = vi.hoisted(() => vi.fn());
const setActiveOrgIdMock = vi.hoisted(() => vi.fn());
const invalidateMemberOrgCachesMock = vi.hoisted(() => vi.fn());

vi.mock("../feature-flags/store.js", () => ({
  isFeatureFlagEnabled: isFeatureFlagEnabledMock,
}));
vi.mock("../db/client.js", () => ({
  getDbExec: () => ({ execute: executeMock }),
}));
vi.mock("../a2a/index.js", () => ({
  canonicalA2AAudience: vi.fn(),
  signA2AToken: vi.fn(),
}));
vi.mock("../server/identity-sso.js", () => ({
  resolveIdentityHubUrl: vi.fn(),
  resolveIdentitySsoAppId: vi.fn(),
}));
vi.mock("./active-org.js", () => ({ setActiveOrgId: setActiveOrgIdMock }));
vi.mock("./context.js", () => ({
  createOrganization: createOrganizationMock,
}));
vi.mock("./request-org-cache.js", () => ({
  invalidateMemberOrgCaches: invalidateMemberOrgCachesMock,
}));

const { provisionFederatedOrganization } = await import("./federation.js");

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

  it("does not guess when an existing account has an unrelated local org", async () => {
    await expect(provisionFederatedOrganization(identity)).resolves.toBe(
      "unlinked",
    );
    expect(createOrganizationMock).not.toHaveBeenCalled();
    expect(setActiveOrgIdMock).not.toHaveBeenCalled();
  });
});
