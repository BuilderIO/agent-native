import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  let registeredResource: any;
  return {
    registerShareableResource: vi.fn((resource: any) => {
      registeredResource = resource;
    }),
    readOrgMemberRole: vi.fn(),
    getRegisteredResource: () => registeredResource,
  };
});

vi.mock("@agent-native/core/db", () => ({
  createGetDb: () => () => ({}),
}));

vi.mock("@agent-native/core/sharing", () => ({
  registerShareableResource: mocks.registerShareableResource,
}));

vi.mock("@agent-native/core/server", () => ({
  readOrgMemberRole: mocks.readOrgMemberRole,
}));

await import("./index.js");

describe("Dispatch workspace app share access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const canManageAccess = () =>
    mocks.getRegisteredResource().canManageAccess as (
      resource: { orgId?: string },
      ctx: { userEmail?: string; orgId?: string },
    ) => Promise<boolean>;

  it("uses the shared request-scoped role resolver for an admin", async () => {
    mocks.readOrgMemberRole.mockResolvedValue("admin");

    await expect(
      canManageAccess()(
        { orgId: "org-a" },
        { userEmail: "admin@example.com", orgId: "org-a" },
      ),
    ).resolves.toBe(true);
    expect(mocks.readOrgMemberRole).toHaveBeenCalledWith(
      "org-a",
      "admin@example.com",
    );
  });

  it("denies org-member assertions whose stored owner role is capped to member", async () => {
    mocks.readOrgMemberRole.mockResolvedValue("member");

    await expect(
      canManageAccess()(
        { orgId: "org-a" },
        { userEmail: "owner@example.com", orgId: "org-a" },
      ),
    ).resolves.toBe(false);
  });

  it("does not resolve a role for a resource outside the request org", async () => {
    await expect(
      canManageAccess()(
        { orgId: "org-b" },
        { userEmail: "member@example.com", orgId: "org-a" },
      ),
    ).resolves.toBe(false);
    expect(mocks.readOrgMemberRole).not.toHaveBeenCalled();
  });
});
