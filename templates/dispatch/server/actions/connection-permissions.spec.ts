import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  roles: [] as string[],
  orgRole: "member",
  member: true,
  federated: false,
  active: true,
  execute: vi.fn(),
}));

vi.mock("../../../../packages/core/dist/db/client.js", () => ({
  getDbExec: () => ({ execute: state.execute }),
}));
vi.mock(
  "@agent-native/core/org",
  async () => import("@agent-native/core/org/app-roles"),
);
vi.mock("../../../../packages/core/dist/org/federation.js", () => ({
  validateFederatedOrganizationMembershipForCurrentRequest: async () => ({
    active: state.active,
    role: state.active ? state.orgRole : null,
  }),
}));

import { assertWorkspaceConnectionManager } from "../../actions/connection-permissions.js";

const ctx = {
  caller: "tool" as const,
  appId: "dispatch",
  orgId: "org-1",
  userEmail: "member@example.test",
};

beforeEach(() => {
  state.roles = [];
  state.orgRole = "member";
  state.member = true;
  state.federated = false;
  state.active = true;
  state.execute.mockReset();
  state.execute.mockImplementation(async ({ sql }: { sql: string }) => ({
    rows: sql.includes("app_permission_overrides")
      ? []
      : state.member
        ? [
            {
              roles: state.roles,
              orgRole: state.orgRole,
              identityAuthority: state.federated ? "dispatch" : null,
              identityId: state.federated ? "identity-1" : null,
            },
          ]
        : [],
  }));
});

describe("Dispatch connection administration", () => {
  it.each(["owner", "admin"])(
    "allows an organization %s without app roles through the shared policy",
    async (role) => {
      state.orgRole = role;
      await expect(
        assertWorkspaceConnectionManager(ctx),
      ).resolves.toBeUndefined();
      expect(state.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          args: ["dispatch", "org-1", "member@example.test"],
        }),
      );
    },
  );

  it("allows an explicitly assigned Dispatch admin", async () => {
    state.roles = ["admin"];
    await expect(
      assertWorkspaceConnectionManager(ctx),
    ).resolves.toBeUndefined();
  });

  it("denies a member without Dispatch administration permission", async () => {
    await expect(assertWorkspaceConnectionManager(ctx)).rejects.toThrow(
      "Requires dispatch permission administer",
    );
  });

  it("denies a removed organization admin", async () => {
    state.orgRole = "admin";
    state.member = false;
    await expect(assertWorkspaceConnectionManager(ctx)).rejects.toThrow(
      "Requires dispatch permission administer",
    );
  });

  it("denies a stale federated organization admin", async () => {
    state.orgRole = "admin";
    state.federated = true;
    state.active = false;
    await expect(assertWorkspaceConnectionManager(ctx)).rejects.toThrow(
      "Requires dispatch permission administer",
    );
  });

  it.each(["userEmail", "orgId"] as const)(
    "denies missing %s",
    async (field) => {
      await expect(
        assertWorkspaceConnectionManager({ ...ctx, [field]: null }),
      ).rejects.toThrow("Requires dispatch permission administer");
    },
  );

  it("propagates a failed policy lookup", async () => {
    state.execute.mockRejectedValue(new Error("Policy database unavailable"));
    await expect(assertWorkspaceConnectionManager(ctx)).rejects.toThrow(
      "Policy database unavailable",
    );
  });
});
