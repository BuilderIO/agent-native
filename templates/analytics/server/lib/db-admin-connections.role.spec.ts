import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  role: null as string | null,
  readError: false,
  requestContext: undefined as
    | { userEmail?: string; orgId?: string; a2aIdentityAssurance?: string }
    | undefined,
  readOrgMemberRole: vi.fn(),
}));

vi.mock("@agent-native/core/org", () => ({
  getOrgContext: async () => null,
}));

vi.mock("@agent-native/core/secrets", () => ({
  deleteAppSecret: vi.fn(),
  getAppSecretMeta: vi.fn(),
  readAppSecret: vi.fn(),
  writeAppSecret: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestOrgId: () => "org-1",
  getRequestUserEmail: () => "owner@example.com",
  getRequestContext: () => state.requestContext,
  readOrgMemberRole: state.readOrgMemberRole,
  getSession: async () => null,
  runWithRequestContext: async (_ctx: unknown, fn: () => unknown) => fn(),
}));

state.readOrgMemberRole.mockImplementation(async () => {
  if (state.readError) throw new Error("connection terminated");
  return state.role;
});

const { requireAnalyticsAdminContext } = await import("./db-admin-connections");
const { resolveCredentialSaveScope } = await import("./credential-save-scope");

describe("requireAnalyticsAdminContext", () => {
  it("reports an unreadable role lookup as unavailable, not as a denial", async () => {
    state.readError = true;
    await expect(requireAnalyticsAdminContext()).rejects.toMatchObject({
      statusCode: 503,
    });

    state.readError = false;
    state.role = null;
    await expect(requireAnalyticsAdminContext()).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it("does not grant an org-member identity stored admin capabilities", async () => {
    state.requestContext = {
      userEmail: "owner@example.com",
      orgId: "org-1",
      a2aIdentityAssurance: "org-member",
    };
    state.role = "member";
    state.readOrgMemberRole.mockClear();
    const ctx = { userEmail: "owner@example.com", orgId: "org-1" };

    await expect(requireAnalyticsAdminContext()).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(resolveCredentialSaveScope(ctx, "org")).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(resolveCredentialSaveScope(ctx)).resolves.toBe("user");
    expect(state.readOrgMemberRole).toHaveBeenCalledWith(
      "org-1",
      "owner@example.com",
    );
  });

  it("does not resolve roles for an explicit identity or org mismatch", async () => {
    state.requestContext = {
      userEmail: "owner@example.com",
      orgId: "org-1",
      a2aIdentityAssurance: "org-member",
    };
    state.role = "admin";
    state.readOrgMemberRole.mockClear();

    for (const mismatch of [
      { userEmail: "other@example.com", orgId: "org-1" },
      { userEmail: "owner@example.com", orgId: "org-2" },
    ]) {
      await expect(
        requireAnalyticsAdminContext(mismatch),
      ).rejects.toMatchObject({ statusCode: 403 });
    }
    expect(state.readOrgMemberRole).not.toHaveBeenCalled();
  });
});
