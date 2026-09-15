import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAny: vi.fn(),
  getRequestOrgId: vi.fn(),
  getRequestUserEmail: vi.fn(),
  isStandaloneDispatchRuntime: vi.fn(),
  validateFederatedOrganizationMembershipForCurrentRequest: vi.fn(),
}));

vi.mock("@agent-native/core/org", () => ({
  defineAppRoles: () => ({ assertAny: mocks.assertAny }),
  isMissingOrganizationTableError: (error: unknown) =>
    /(?:organizations|org_members).*does not exist/i.test(String(error)),
  isStandaloneDispatchRuntime: mocks.isStandaloneDispatchRuntime,
  validateFederatedOrganizationMembershipForCurrentRequest:
    mocks.validateFederatedOrganizationMembershipForCurrentRequest,
}));

vi.mock("@agent-native/core/server", () => ({
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
    mocks.validateFederatedOrganizationMembershipForCurrentRequest.mockResolvedValue(
      { active: true, role: "member" },
    );
    mocks.assertAny.mockResolvedValue("admin");
    mocks.getRequestOrgId.mockReturnValue(undefined);
    mocks.getRequestUserEmail.mockReturnValue(undefined);
    mocks.isStandaloneDispatchRuntime.mockReturnValue(false);
  });

  it("denies an organization member without the Dispatch admin role", async () => {
    mocks.assertAny.mockRejectedValue(
      new ForbiddenError("Requires dispatch role admin"),
    );

    await expect(authorizeDispatchAdmin({}, context)).rejects.toThrow(
      "Requires dispatch role admin",
    );
    expect(
      mocks.validateFederatedOrganizationMembershipForCurrentRequest,
    ).toHaveBeenCalledWith({
      orgId: "org-1",
      email: "member@example.test",
    });
    expect(mocks.assertAny).toHaveBeenCalledWith(["admin"], {
      orgId: "org-1",
      userEmail: "member@example.test",
    });
  });

  it("allows an organization admin without an app-role assignment", async () => {
    mocks.validateFederatedOrganizationMembershipForCurrentRequest.mockResolvedValue(
      { active: true, role: "admin" },
    );

    await expect(authorizeDispatchAdmin({}, context)).resolves.toBeUndefined();
    expect(mocks.assertAny).not.toHaveBeenCalled();
  });

  it("denies a stale linked organization admin", async () => {
    mocks.validateFederatedOrganizationMembershipForCurrentRequest.mockResolvedValue(
      { active: false, role: null },
    );

    await expect(authorizeDispatchAdmin({}, context)).rejects.toThrow(
      "active organization membership",
    );
    expect(mocks.assertAny).not.toHaveBeenCalled();
  });

  it("allows standalone administration when the org schema is absent", async () => {
    mocks.isStandaloneDispatchRuntime.mockReturnValue(true);
    mocks.validateFederatedOrganizationMembershipForCurrentRequest.mockRejectedValue(
      new Error('relation "org_members" does not exist'),
    );

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
    expect(
      mocks.validateFederatedOrganizationMembershipForCurrentRequest,
    ).not.toHaveBeenCalled();
    expect(mocks.assertAny).not.toHaveBeenCalled();
  });

  it("denies an unauthenticated caller", async () => {
    await expect(
      authorizeDispatchAdmin({}, { ...context, userEmail: undefined }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
