import { beforeEach, describe, expect, it, vi } from "vitest";

const getOrgRoleForEmail = vi.fn();

vi.mock("../mcp/actions/service-token-access.js", () => ({
  getOrgRoleForEmail: (...args: unknown[]) => getOrgRoleForEmail(...args),
}));

vi.mock("../org/permissions.js", () => ({
  canManageOrg: (role: unknown) => role === "admin" || role === "owner",
}));

const { requireFeatureFlagManager } = await import("./permissions.js");

describe("feature flag manager permissions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("authorizes an organization admin through the shared role lookup", async () => {
    getOrgRoleForEmail.mockResolvedValue("admin");

    await expect(
      requireFeatureFlagManager({
        userEmail: "ADMIN@example.com",
        orgId: "org-1",
      }),
    ).resolves.toEqual({ email: "admin@example.com", orgId: "org-1" });
    expect(getOrgRoleForEmail).toHaveBeenCalledWith(
      "org-1",
      "admin@example.com",
    );
  });

  it("rejects an organization member", async () => {
    getOrgRoleForEmail.mockResolvedValue("member");

    await expect(
      requireFeatureFlagManager({
        userEmail: "member@example.com",
        orgId: "org-1",
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});
