import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  requestContext: undefined as
    | { userEmail?: string; orgId?: string; a2aIdentityAssurance?: string }
    | undefined,
  orgId: "org-1" as string | null,
  userEmail: "member@example.com" as string | null,
  role: "member" as string | null,
  readOrgMemberRole: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestContext: () => state.requestContext,
  getRequestOrgId: () => state.orgId,
  getRequestUserEmail: () => state.userEmail,
  readOrgMemberRole: state.readOrgMemberRole,
}));

state.readOrgMemberRole.mockImplementation(async () => state.role);

const { assertOrgAdmin, isOrgAdmin } = await import("./org-admin.js");

describe("org-admin delegated identity", () => {
  it("does not let an org-member assertion use stored admin authority", async () => {
    state.requestContext = {
      userEmail: "member@example.com",
      orgId: "org-1",
      a2aIdentityAssurance: "org-member",
    };
    state.orgId = "org-1";
    state.userEmail = "member@example.com";
    state.role = "member";
    state.readOrgMemberRole.mockClear();

    await expect(assertOrgAdmin()).rejects.toMatchObject({ statusCode: 403 });
    expect(state.readOrgMemberRole).toHaveBeenCalledWith(
      "org-1",
      "member@example.com",
    );
    await expect(isOrgAdmin()).resolves.toBe(false);
  });

  it("denies delegated identity and org mismatches before role lookup", async () => {
    state.requestContext = {
      userEmail: "member@example.com",
      orgId: "org-1",
      a2aIdentityAssurance: "org-member",
    };
    state.role = "admin";
    state.readOrgMemberRole.mockClear();

    for (const mismatch of [
      { orgId: "org-2", userEmail: "member@example.com" },
      { orgId: "org-1", userEmail: "other@example.com" },
    ]) {
      state.orgId = mismatch.orgId;
      state.userEmail = mismatch.userEmail;
      await expect(assertOrgAdmin()).rejects.toMatchObject({ statusCode: 403 });
    }
    expect(state.readOrgMemberRole).not.toHaveBeenCalled();
  });

  it("does not allow a delegated identity to fall back to personal audit scope", async () => {
    state.requestContext = {
      userEmail: "member@example.com",
      a2aIdentityAssurance: "org-member",
    };
    state.orgId = null;
    state.userEmail = "member@example.com";

    await expect(assertOrgAdmin()).rejects.toMatchObject({ statusCode: 403 });
    expect(state.readOrgMemberRole).not.toHaveBeenCalled();
  });
});
