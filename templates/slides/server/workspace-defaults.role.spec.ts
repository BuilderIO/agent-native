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

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestContext: () => state.requestContext,
  getRequestOrgId: () => state.orgId,
  getRequestUserEmail: () => state.userEmail,
}));

vi.mock("@agent-native/core/server", () => ({
  readOrgMemberRole: state.readOrgMemberRole,
}));

state.readOrgMemberRole.mockImplementation(async () => state.role);

const { getCallerOrgRole } = await import("./workspace-defaults.js");

describe("getCallerOrgRole", () => {
  it("reads the exact delegated org membership role", async () => {
    state.requestContext = {
      userEmail: "member@example.com",
      orgId: "org-1",
      a2aIdentityAssurance: "org-member",
    };
    state.orgId = "org-1";
    state.userEmail = "member@example.com";
    state.role = "member";
    state.readOrgMemberRole.mockClear();

    await expect(getCallerOrgRole()).resolves.toBe("member");
    expect(state.readOrgMemberRole).toHaveBeenCalledWith(
      "org-1",
      "member@example.com",
    );
  });

  it("rejects an explicit request org or email mismatch", async () => {
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
      await expect(getCallerOrgRole()).resolves.toBeNull();
    }
    expect(state.readOrgMemberRole).not.toHaveBeenCalled();
  });
});
