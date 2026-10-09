import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  roles: [] as string[],
  orgRole: "member",
  member: true,
  overrides: [] as { permission: string; roles_json: string }[],
  execute: vi.fn(),
  getRequestOrgId: vi.fn(),
  getRequestUserEmail: vi.fn(),
  isStandaloneDispatchRuntime: vi.fn(),
  validateFederatedOrganizationMembershipForCurrentRequest: vi.fn(),
}));

vi.mock("../../../../core/src/db/client.js", () => ({
  getDbExec: () => ({ execute: mocks.execute }),
}));
vi.mock("@agent-native/core/org", async () => ({
  ...(await import("../../../../core/src/org/app-roles.js")),
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
    mocks.roles = [];
    mocks.orgRole = "member";
    mocks.member = true;
    mocks.overrides = [];
    mocks.execute.mockImplementation(async ({ sql }: { sql: string }) => ({
      rows: sql.includes("app_permission_overrides")
        ? mocks.overrides
        : mocks.member
          ? [{ roles: mocks.roles, orgRole: mocks.orgRole }]
          : [],
    }));
    mocks.validateFederatedOrganizationMembershipForCurrentRequest.mockResolvedValue(
      { active: true, role: "member" },
    );
    mocks.getRequestOrgId.mockReturnValue(undefined);
    mocks.getRequestUserEmail.mockReturnValue(undefined);
    mocks.isStandaloneDispatchRuntime.mockReturnValue(false);
  });

  it("denies an organization member without the Dispatch admin role", async () => {
    await expect(authorizeDispatchAdmin({}, context)).rejects.toThrow(
      "Requires dispatch permission administer",
    );
  });

  it.each(["owner", "admin"])(
    "allows an organization %s without app roles through the shared policy",
    async (role) => {
      mocks.orgRole = role;
      mocks.validateFederatedOrganizationMembershipForCurrentRequest.mockResolvedValue(
        { active: true, role },
      );
      await expect(
        authorizeDispatchAdmin({}, context),
      ).resolves.toBeUndefined();
      expect(mocks.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          args: ["dispatch", "org-1", "member@example.test"],
        }),
      );
    },
  );

  it("denies a stale linked organization admin", async () => {
    mocks.orgRole = "admin";
    mocks.validateFederatedOrganizationMembershipForCurrentRequest.mockResolvedValue(
      { active: false, role: null },
    );
    await expect(authorizeDispatchAdmin({}, context)).rejects.toThrow(
      "active organization membership",
    );
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("allows standalone administration when the org schema is absent", async () => {
    mocks.isStandaloneDispatchRuntime.mockReturnValue(true);
    mocks.validateFederatedOrganizationMembershipForCurrentRequest.mockRejectedValue(
      new Error('relation "org_members" does not exist'),
    );
    await expect(authorizeDispatchAdmin({}, context)).resolves.toBeUndefined();
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("allows a member with the Dispatch admin role", async () => {
    mocks.roles = ["admin"];
    await expect(authorizeDispatchAdmin({}, context)).resolves.toBeUndefined();
  });

  it("honors a permission override for an app admin", async () => {
    mocks.roles = ["admin"];
    mocks.overrides = [{ permission: "administer", roles_json: "[]" }];
    await expect(authorizeDispatchAdmin({}, context)).rejects.toThrow(
      "Requires dispatch permission administer",
    );
  });

  it("allows authenticated personal-mode administration", async () => {
    await expect(
      authorizeDispatchAdmin({}, { ...context, orgId: null }),
    ).resolves.toBeUndefined();
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("denies an unauthenticated caller", async () => {
    await expect(
      authorizeDispatchAdmin({}, { ...context, userEmail: undefined }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
