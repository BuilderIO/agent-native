import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAny: vi.fn(),
  currentRequestUserIsOrgAdmin: vi.fn(),
  getRequestOrgId: vi.fn(),
  getRequestUserEmail: vi.fn(),
}));

vi.mock("@agent-native/core/org", () => ({
  defineAppRoles: () => ({ assertAny: mocks.assertAny }),
}));

vi.mock("@agent-native/core/server", () => ({
  currentRequestUserIsOrgAdmin: mocks.currentRequestUserIsOrgAdmin,
  getRequestOrgId: mocks.getRequestOrgId,
  getRequestUserEmail: mocks.getRequestUserEmail,
}));

import { ForbiddenError } from "@agent-native/core/sharing";

import { authorizeDispatchAdmin } from "./app-roles.js";

const context = {
  caller: "http" as const,
  orgId: "org-1",
  userEmail: "member@example.test",
};

describe("authorizeDispatchAdmin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.currentRequestUserIsOrgAdmin.mockResolvedValue(false);
    mocks.assertAny.mockResolvedValue("admin");
    mocks.getRequestOrgId.mockReturnValue(undefined);
    mocks.getRequestUserEmail.mockReturnValue(undefined);
  });

  it("denies an organization member without the Dispatch admin role", async () => {
    mocks.assertAny.mockRejectedValue(
      new ForbiddenError("Requires dispatch role admin"),
    );

    await expect(authorizeDispatchAdmin({}, context)).rejects.toThrow(
      "Requires dispatch role admin",
    );
    expect(mocks.assertAny).toHaveBeenCalledWith(["admin"], {
      orgId: "org-1",
      userEmail: "member@example.test",
    });
  });

  it("allows an organization admin without an app-role assignment", async () => {
    mocks.currentRequestUserIsOrgAdmin.mockResolvedValue(true);

    await expect(authorizeDispatchAdmin({}, context)).resolves.toBeUndefined();
    expect(mocks.assertAny).not.toHaveBeenCalled();
  });

  it("allows a member with the Dispatch admin role", async () => {
    await expect(authorizeDispatchAdmin({}, context)).resolves.toBeUndefined();
    expect(mocks.assertAny).toHaveBeenCalledWith(["admin"], {
      orgId: "org-1",
      userEmail: "member@example.test",
    });
  });

  it("allows authenticated personal-mode administration", async () => {
    await expect(
      authorizeDispatchAdmin({}, { ...context, orgId: null }),
    ).resolves.toBeUndefined();
    expect(mocks.currentRequestUserIsOrgAdmin).not.toHaveBeenCalled();
    expect(mocks.assertAny).not.toHaveBeenCalled();
  });

  it("denies an unauthenticated caller", async () => {
    await expect(
      authorizeDispatchAdmin({}, { ...context, userEmail: undefined }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
