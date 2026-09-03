import { beforeEach, describe, expect, it, vi } from "vitest";

const getOrgRoleForEmail = vi.fn();

vi.mock("../mcp/actions/service-token-access.js", () => ({
  getOrgRoleForEmail: (...args: unknown[]) => getOrgRoleForEmail(...args),
}));

vi.mock("../org/permissions.js", () => ({
  canManageOrg: (role: unknown) => role === "admin" || role === "owner",
}));

const { isFeatureFlagAdminEmail, requireFeatureFlagManager } =
  await import("./permissions.js");

describe("feature flag manager permissions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.AGENT_NATIVE_FEATURE_FLAG_ADMIN_EMAILS;
  });

  it("normalizes emails against the explicit no-org administrator allowlist", () => {
    process.env.AGENT_NATIVE_FEATURE_FLAG_ADMIN_EMAILS =
      "admin@example.com, other@example.com";

    expect(isFeatureFlagAdminEmail(" ADMIN@example.com ")).toBe(true);
    expect(isFeatureFlagAdminEmail("member@example.com")).toBe(false);
    expect(isFeatureFlagAdminEmail(undefined)).toBe(false);
  });

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
