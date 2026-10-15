import type { WorkspaceConnection } from "@agent-native/core/workspace-connections";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  roles: [] as string[],
  orgRole: "member",
  member: true,
  pendingRemoval: false,
  execute: vi.fn(),
}));

vi.mock("../../../../packages/core/dist/db/client.js", () => ({
  getDbExec: () => ({ execute: state.execute }),
}));
vi.mock(
  "@agent-native/core/org",
  async () => import("@agent-native/core/org/app-roles"),
);

import {
  assertWorkspaceConnectionDeleteManager,
  assertWorkspaceConnectionGrantManager,
  assertWorkspaceConnectionManager,
} from "../../actions/connection-permissions.js";

const ctx = {
  caller: "tool" as const,
  appId: "dispatch",
  orgId: "org-1",
  userEmail: "member@example.test",
};

function connection(allowedApps: string[]): WorkspaceConnection {
  return {
    id: "connection-1",
    provider: "example",
    label: "Example workspace",
    accountId: null,
    accountLabel: null,
    status: "connected",
    scopes: [],
    config: {},
    allowedApps,
    allowedUsers: [],
    allowedUserGroups: [],
    credentialRefs: [],
    ownerEmail: "owner@example.test",
    orgId: "org-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    lastCheckedAt: null,
    lastError: null,
  };
}

function workspaceRoleLookups(): number {
  return state.execute.mock.calls.filter(([query]) =>
    String(query.sql).includes("SELECT role FROM org_members"),
  ).length;
}

beforeEach(() => {
  state.roles = [];
  state.orgRole = "member";
  state.member = true;
  state.pendingRemoval = false;
  state.execute.mockReset();
  state.execute.mockImplementation(async ({ sql }: { sql: string }) => {
    if (
      !state.member ||
      (state.pendingRemoval &&
        sql.includes("federation_removal_pending_at IS NULL")) ||
      sql.includes("app_permission_overrides")
    ) {
      return { rows: [] };
    }
    return {
      rows: sql.includes("app_member_roles")
        ? [{ roles: state.roles, orgRole: state.orgRole }]
        : [{ role: state.orgRole }],
    };
  });
});

describe("Dispatch connection administration", () => {
  it.each(["owner", "admin"])(
    "lets an organization %s manage Dispatch-only connections through the shared policy",
    async (role) => {
      state.orgRole = role;
      await expect(
        assertWorkspaceConnectionManager(ctx, ["dispatch"]),
      ).resolves.toBeUndefined();
      expect(workspaceRoleLookups()).toBe(0);
    },
  );

  it.each([[[]], [["dispatch", "mail"]]])(
    "lets an organization admin manage connections scoped to %j",
    async (allowedApps) => {
      state.orgRole = "admin";
      await expect(
        assertWorkspaceConnectionManager(ctx, allowedApps),
      ).resolves.toBeUndefined();
    },
  );

  it("lets a Dispatch admin manage Dispatch-only connections", async () => {
    state.roles = ["admin"];
    await expect(
      assertWorkspaceConnectionManager(ctx, ["dispatch"]),
    ).resolves.toBeUndefined();
    await expect(
      assertWorkspaceConnectionDeleteManager(ctx, connection(["dispatch"])),
    ).resolves.toBeUndefined();
  });

  it.each([[[]], [["mail"]], [["dispatch", "mail"]]])(
    "keeps connections scoped to %j organization-admin only",
    async (allowedApps) => {
      state.roles = ["admin"];
      await expect(
        assertWorkspaceConnectionManager(ctx, allowedApps),
      ).rejects.toThrow("Only workspace admins");
      await expect(
        assertWorkspaceConnectionDeleteManager(ctx, connection(allowedApps)),
      ).rejects.toThrow("Only workspace admins");
    },
  );

  it("lets a Dispatch admin change only Dispatch's grant on a shared connection", async () => {
    state.roles = ["admin"];
    const shared = connection(["dispatch", "mail"]);
    await expect(
      assertWorkspaceConnectionGrantManager(
        ctx,
        shared,
        "dispatch",
        false,
        undefined,
      ),
    ).resolves.toBeUndefined();
    await expect(
      assertWorkspaceConnectionGrantManager(
        ctx,
        shared,
        "mail",
        true,
        undefined,
      ),
    ).rejects.toThrow("Only workspace admins");
    await expect(
      assertWorkspaceConnectionGrantManager(
        ctx,
        shared,
        "dispatch",
        true,
        "all-apps",
      ),
    ).rejects.toThrow("Only workspace admins");
  });

  it("denies a member without Dispatch administration", async () => {
    await expect(
      assertWorkspaceConnectionManager(ctx, ["dispatch"]),
    ).rejects.toThrow("Only workspace admins");
  });

  it("denies a removed organization admin", async () => {
    state.orgRole = "admin";
    state.member = false;
    await expect(
      assertWorkspaceConnectionManager(ctx, ["dispatch"]),
    ).rejects.toThrow("Only workspace admins");
  });

  it("denies an organization admin whose removal is pending", async () => {
    state.orgRole = "admin";
    state.pendingRemoval = true;
    await expect(
      assertWorkspaceConnectionManager(ctx, ["dispatch"]),
    ).rejects.toThrow("Only workspace admins");
    expect(state.execute).toHaveBeenCalledTimes(2);
  });

  it("propagates a failed policy lookup", async () => {
    state.execute.mockRejectedValue(new Error("Policy database unavailable"));
    await expect(
      assertWorkspaceConnectionManager(ctx, ["dispatch"]),
    ).rejects.toThrow("Policy database unavailable");
  });
});
