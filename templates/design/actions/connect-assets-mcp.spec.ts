import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readOrgMemberRole: vi.fn(async () => "member"),
  getRequestOrgId: vi.fn(() => "org-1"),
  getRequestUserEmail: vi.fn(() => "owner@example.com"),
  fetchOrgAppsResult: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  readOrgMemberRole: mocks.readOrgMemberRole,
  refreshMcpManagerForPrincipal: vi.fn(),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestOrgId: mocks.getRequestOrgId,
  getRequestUserEmail: mocks.getRequestUserEmail,
}));

vi.mock("@agent-native/core/action", () => ({
  defineAction: (action: unknown) => action,
  NoWriteError: class NoWriteError extends Error {
    readonly noWrite = true;
    readonly errorCode: string;
    readonly statusCode: number;
    readonly details?: Record<string, unknown>;

    constructor(
      message: string,
      options: {
        errorCode?: string;
        statusCode?: number;
        details?: Record<string, unknown>;
      } = {},
    ) {
      super(message);
      this.name = "NoWriteError";
      this.errorCode = options.errorCode ?? "action_failed";
      this.statusCode = options.statusCode ?? 400;
      this.details = options.details;
    }
  },
}));

vi.mock("@agent-native/core/mcp", () => ({
  fetchOrgAppsResult: mocks.fetchOrgAppsResult,
}));

vi.mock("@agent-native/core/mcp-client", () => ({
  addFirstPartyRemoteServer: vi.fn(),
  isFirstPartyRemoteEndpointTrusted: vi.fn(),
  listRemoteServers: vi.fn(),
  removeRemoteServer: vi.fn(),
}));

import action from "./connect-assets-mcp.js";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readOrgMemberRole.mockResolvedValue("member");
  mocks.getRequestOrgId.mockReturnValue("org-1");
  mocks.getRequestUserEmail.mockReturnValue("owner@example.com");
});

describe("connect-assets-mcp org role gate", () => {
  it("denies an org-member assertion for a stored owner before changing MCP config", async () => {
    await expect(action.run({} as never)).rejects.toThrow(
      "Only organization owners and admins can connect org-scoped MCP servers.",
    );
    expect(mocks.readOrgMemberRole).toHaveBeenCalledWith(
      "org-1",
      "owner@example.com",
    );
  });

  it.each([
    { orgId: "org-1", userEmail: "other@example.com" },
    { orgId: "org-2", userEmail: "owner@example.com" },
  ])(
    "fails closed on a delegated identity mismatch when role resolution rejects it: %o",
    async (identity) => {
      mocks.getRequestOrgId.mockReturnValue(identity.orgId);
      mocks.getRequestUserEmail.mockReturnValue(identity.userEmail);
      mocks.readOrgMemberRole.mockResolvedValue(null);

      await expect(action.run({} as never)).rejects.toThrow(
        "Only organization owners and admins can connect org-scoped MCP servers.",
      );
      expect(mocks.readOrgMemberRole).toHaveBeenCalledWith(
        identity.orgId,
        identity.userEmail,
      );
    },
  );
});

describe("connect-assets-mcp directory boundary", () => {
  beforeEach(() => {
    mocks.readOrgMemberRole.mockResolvedValue("owner");
  });

  it("reports an unavailable directory separately from an absent Assets app", async () => {
    mocks.fetchOrgAppsResult.mockResolvedValue({
      status: "unavailable",
      reason: "unauthorized",
    });

    let error: unknown;
    try {
      await action.run({} as never);
    } catch (caught) {
      error = caught;
    }

    expect(error).toMatchObject({
      name: "NoWriteError",
      noWrite: true,
      errorCode: "org_app_directory_unavailable",
      statusCode: 503,
      details: { reason: "unauthorized" },
      message: expect.stringContaining(
        "directory is unavailable (unauthorized)",
      ),
    });
    expect((error as Error).message).not.toContain(
      "Could not find the Assets app",
    );
  });

  it("reports an absent Assets app only after an available directory lookup", async () => {
    mocks.fetchOrgAppsResult.mockResolvedValue({
      status: "available",
      apps: [],
    });

    await expect(action.run({} as never)).rejects.toMatchObject({
      name: "NoWriteError",
      noWrite: true,
      errorCode: "assets_app_not_available",
      statusCode: 404,
      message: "Assets is not listed in this organization.",
    });
  });
});
