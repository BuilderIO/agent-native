import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertManager: vi.fn(),
  assertAllowedGroups: vi.fn(),
  assertAllowedUsers: vi.fn(),
  getProvider: vi.fn(),
  getConnection: vi.fn(),
  upsertRun: vi.fn(),
}));

vi.mock("@agent-native/core/connections", () => ({
  getWorkspaceConnectionProvider: mocks.getProvider,
}));
vi.mock("@agent-native/core/workspace-connections", () => ({
  credentialKeyMatches: (provider: string, key: string, ref: string) =>
    provider === ref && key === ref,
  getWorkspaceConnection: mocks.getConnection,
}));
vi.mock("../../actions/connection-permissions.js", () => ({
  assertWorkspaceConnectionManager: mocks.assertManager,
}));
vi.mock("../../actions/upsert-workspace-connection.js", () => ({
  assertWorkspaceConnectionAllowedUserGroups: mocks.assertAllowedGroups,
  assertWorkspaceConnectionAllowedUsers: mocks.assertAllowedUsers,
  default: { run: mocks.upsertRun },
}));

import { ACTION_CHAT_UI_RECORD_CHANGE_RENDERER } from "@agent-native/core/action-ui";

import action from "../../actions/apply-workspace-connection-setup.js";

const context = {
  caller: "tool" as const,
  userEmail: "user@example.com",
  orgId: "org-1",
};

const change = {
  change: {
    verb: "created",
    kind: "workspace-connection",
    title: "Example workspace",
    url: "/integrations",
  },
};

describe("apply-workspace-connection-setup action cards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertManager.mockResolvedValue(undefined);
    mocks.assertAllowedGroups.mockResolvedValue([]);
    mocks.assertAllowedUsers.mockResolvedValue([]);
    mocks.getProvider.mockReturnValue({
      id: "example",
      label: "Example",
      credentialKeys: [],
    });
    mocks.getConnection.mockResolvedValue(null);
    mocks.upsertRun.mockResolvedValue(change);
  });

  it("forwards successful setup changes to the record-change card", async () => {
    const result = await action.run(
      {
        provider: "example",
        status: "connected",
        scopes: [],
        credentialRefs: [],
        grantMode: "selected-apps",
        selectedApps: ["mail"],
      },
      context,
    );

    expect(mocks.upsertRun).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "example", allowedApps: ["mail"] }),
      context,
    );
    expect(result).toEqual(change);
    expect(action.chatUI?.renderer).toBe(ACTION_CHAT_UI_RECORD_CHANGE_RENDERER);
    expect(action.chatUI?.when?.({}, result)).toBe(true);
    expect(action.chatUI?.projectResult?.({}, result)).toEqual(change);
  });

  it("does not show a widget when setup reports no change", async () => {
    mocks.upsertRun.mockResolvedValue({ id: "connection-1" });

    const result = await action.run(
      {
        provider: "example",
        status: "connected",
        scopes: [],
        credentialRefs: [],
        grantMode: "selected-apps",
        selectedApps: ["mail"],
      },
      context,
    );

    expect(action.chatUI?.when?.({}, result)).toBe(false);
  });
});
